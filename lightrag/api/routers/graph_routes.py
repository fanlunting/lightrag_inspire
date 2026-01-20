"""
This module contains all graph-related routes for the LightRAG API.
"""

from typing import Optional, Dict, Any, List
import traceback
import json
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from lightrag.utils import logger
from lightrag.kg.shared_storage import get_graph_db_lock
from lightrag.constants import GRAPH_FIELD_SEP
from lightrag.utils_graph import aupsert_entity, aupsert_relation
from ..utils_api import get_combined_auth_dependency

router = APIRouter(tags=["graph"])


class EntityUpdateRequest(BaseModel):
    entity_name: str
    updated_data: Dict[str, Any]
    allow_rename: bool = False
    allow_merge: bool = False


class RelationUpdateRequest(BaseModel):
    source_id: str
    target_id: str
    updated_data: Dict[str, Any]


class EntityMergeRequest(BaseModel):
    entities_to_change: list[str] = Field(
        ...,
        description="List of entity names to be merged and deleted. These are typically duplicate or misspelled entities.",
        min_length=1,
        examples=[["Elon Msk", "Ellon Musk"]],
    )
    entity_to_change_into: str = Field(
        ...,
        description="Target entity name that will receive all relationships from the source entities. This entity will be preserved.",
        min_length=1,
        examples=["Elon Musk"],
    )


class EntityCreateRequest(BaseModel):
    entity_name: str = Field(
        ...,
        description="Unique name for the new entity",
        min_length=1,
        examples=["Tesla"],
    )
    entity_data: Dict[str, Any] = Field(
        ...,
        description="Dictionary containing entity properties. Common fields include 'description' and 'entity_type'.",
        examples=[
            {
                "description": "Electric vehicle manufacturer",
                "entity_type": "ORGANIZATION",
            }
        ],
    )


class RelationCreateRequest(BaseModel):
    source_entity: str = Field(
        ...,
        description="Name of the source entity. This entity must already exist in the knowledge graph.",
        min_length=1,
        examples=["Elon Musk"],
    )
    target_entity: str = Field(
        ...,
        description="Name of the target entity. This entity must already exist in the knowledge graph.",
        min_length=1,
        examples=["Tesla"],
    )
    relation_data: Dict[str, Any] = Field(
        ...,
        description="Dictionary containing relationship properties. Common fields include 'description', 'keywords', and 'weight'.",
        examples=[
            {
                "description": "Elon Musk is the CEO of Tesla",
                "keywords": "CEO, founder",
                "weight": 1.0,
            }
        ],
    )

class GraphTagListResponse(BaseModel):
    tags: List[str]


class GraphTagsMergeRequest(BaseModel):
    graph_tags: List[str] = Field(
        ...,
        description="List of graph_tag values to participate in in-place fusion.",
        min_length=1,
        examples=[["standard_cure", "standard_decease"]],
    )
    similarity_threshold: float = Field(
        0.85, description="Cosine similarity threshold for SIMILAR edges", ge=0.0, le=1.0
    )
    top_k: int = Field(8, description="Vector neighbor top_k per entity", ge=1, le=100)
    llm_confirm: bool = Field(
        True, description="If true, use LLM YES/NO confirmation for SIMILAR edges."
    )


def create_graph_routes(rag, api_key: Optional[str] = None):
    combined_auth = get_combined_auth_dependency(api_key)

    # Backward compatible path (legacy clients)
    @router.get(
        "/graph//node/list",
        dependencies=[Depends(combined_auth)],
        include_in_schema=False,
    )
    @router.get("/graph/label/list", dependencies=[Depends(combined_auth)])
    async def get_graph_labels(
        graph_tags: Optional[List[str]] = Query(
            None,
            description="Optional graph_tag filters. Repeated query param allowed. Empty/omitted means no filtering.",
        ),
    ):
        """
        Get all graph labels

        Returns:
            List[str]: List of graph labels
        """
        try:
            return await rag.get_graph_labels(graph_tags=graph_tags)
        except Exception as e:
            logger.error(f"Error getting graph labels: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting graph labels: {str(e)}"
            )

    @router.get("/graph/label/popular", dependencies=[Depends(combined_auth)])
    async def get_popular_labels(
        limit: int = Query(
            300, description="Maximum number of popular labels to return", ge=1, le=1000
        ),
        graph_tags: Optional[List[str]] = Query(
            None,
            description="Optional graph_tag filters. Repeated query param allowed. Empty/omitted means no filtering.",
        ),
    ):
        """
        Get popular labels by node degree (most connected entities)

        Args:
            limit (int): Maximum number of labels to return (default: 300, max: 1000)

        Returns:
            List[str]: List of popular labels sorted by degree (highest first)
        """
        try:
            return await rag.chunk_entity_relation_graph.get_popular_labels(
                limit, graph_tags=graph_tags
            )
        except Exception as e:
            logger.error(f"Error getting popular labels: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting popular labels: {str(e)}"
            )

    @router.get("/graph/label/search", dependencies=[Depends(combined_auth)])
    async def search_labels(
        q: str = Query(..., description="Search query string"),
        limit: int = Query(
            50, description="Maximum number of search results to return", ge=1, le=100
        ),
        graph_tags: Optional[List[str]] = Query(
            None,
            description="Optional graph_tag filters. Repeated query param allowed. Empty/omitted means no filtering.",
        ),
    ):
        """
        Search labels with fuzzy matching

        Args:
            q (str): Search query string
            limit (int): Maximum number of results to return (default: 50, max: 100)

        Returns:
            List[str]: List of matching labels sorted by relevance
        """
        try:
            return await rag.chunk_entity_relation_graph.search_labels(
                q, limit, graph_tags=graph_tags
            )
        except Exception as e:
            logger.error(f"Error searching labels with query '{q}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error searching labels: {str(e)}"
            )

    @router.get("/graph/tag/list", dependencies=[Depends(combined_auth)])
    async def list_graph_tags(
        q: str = Query("", description="Optional search query (case-insensitive)"),
        limit: int = Query(
            300, description="Maximum number of tags to return", ge=1, le=5000
        ),
        include_default: bool = Query(
            True, description="If true, include 'default' when graph_tag is missing."
        ),
    ) -> List[str]:
        """
        List distinct `graph_tag` values currently present in the graph storage.

        Notes:
        - This scans all nodes and extracts `graph_tag` values.
        - `graph_tag` may contain multiple tags separated by GRAPH_FIELD_SEP.
        """
        try:
            graph_db_lock = get_graph_db_lock(enable_logging=False)
            async with graph_db_lock:
                nodes = await rag.chunk_entity_relation_graph.get_all_nodes()

            tags: set[str] = set()
            for node in nodes:
                raw = node.get("graph_tag")
                if not raw:
                    if include_default:
                        tags.add("default")
                    continue

                parts: list[str]
                if isinstance(raw, str):
                    parts = [p for p in raw.split(GRAPH_FIELD_SEP) if p]
                elif isinstance(raw, list):
                    parts = [str(v) for v in raw if str(v)]
                else:
                    parts = [str(raw)]

                for t in parts:
                    t = t.strip()
                    if t:
                        tags.add(t)

            query = (q or "").strip().lower()
            result = sorted(tags)
            if query:
                result = [t for t in result if query in t.lower()]
            return result[:limit]
        except Exception as e:
            logger.error(f"Error listing graph tags: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error listing graph tags: {str(e)}"
            )

    @router.post("/graph/tags/merge", dependencies=[Depends(combined_auth)])
    async def merge_graphs_by_tags(request: GraphTagsMergeRequest):
        """
        In-place graph-tag fusion via `rag.amerge_graph`.

        This does NOT create a new fused graph_tag. It only adds new edges:
        - SAME_AS
        - SIMILAR
        Each new edge is annotated with `fusion_tag`.
        """
        try:
            result = await rag.amerge_graph(
                graph_tags=request.graph_tags,
                similarity_threshold=request.similarity_threshold,
                top_k=request.top_k,
                llm_confirm=request.llm_confirm,
            )
            return {
                "status": "success",
                "message": "Graph tags merged (in-place) successfully",
                "data": result,
            }
        except ValueError as ve:
            logger.error(f"Validation error merging graph tags {request.graph_tags}: {str(ve)}")
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(f"Error merging graph tags {request.graph_tags}: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error merging graph tags: {str(e)}"
            )

    @router.post("/graph/import/jsonl", dependencies=[Depends(combined_auth)])
    async def import_graph_from_jsonl(
        file: UploadFile = File(..., description="A .jsonl file containing KG triples"),
        graph_tag: str = Form(
            "default", description="graph_tag for isolating this imported graph"
        ),
        file_path: str = Form(
            "jsonl_import",
            description="A logical file_path recorded into node/edge metadata",
        ),
    ):
        """
        Import KG triples from a JSONL file.

        Each line is a JSON object with keys:
        - h: str | {name: str, ...props}
        - t: str | {name: str, ...props}
        - r: {type: str, ...props} | str
        """

        def _entity_from_value(v: Any) -> tuple[str, dict[str, Any]]:
            if isinstance(v, str):
                name = v.strip()
                if not name:
                    raise ValueError("entity name cannot be empty")
                return name, {}
            if isinstance(v, dict):
                raw_name = v.get("name")
                if not isinstance(raw_name, str) or not raw_name.strip():
                    raise ValueError("entity object must have non-empty 'name'")
                name = raw_name.strip()
                props = {k: vv for k, vv in v.items() if k != "name"}
                return name, props
            raise ValueError("entity must be a string or an object with {name: ...}")

        def _relation_from_value(v: Any) -> tuple[str, dict[str, Any]]:
            if isinstance(v, str):
                t = v.strip()
                if not t:
                    t = "RELATED_TO"
                return t, {}
            if isinstance(v, dict):
                raw_t = v.get("type")
                rel_type = raw_t.strip() if isinstance(raw_t, str) and raw_t.strip() else "RELATED_TO"
                props = {k: vv for k, vv in v.items() if k != "type"}
                return rel_type, props
            raise ValueError("relation must be a string or an object with {type: ...}")

        normalized_tag = (graph_tag or "").strip() or "default"

        entities_created_or_updated = 0
        relations_created_or_updated = 0
        lines_ok = 0
        errors: list[dict[str, Any]] = []

        # Stream-read to avoid loading big files into memory.
        line_no = 0
        while True:
            raw = await file.readline()
            if not raw:
                break
            line_no += 1

            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
                if not isinstance(obj, dict):
                    raise ValueError("each line must be a JSON object")

                h_name, h_props = _entity_from_value(obj.get("h"))
                t_name, t_props = _entity_from_value(obj.get("t"))
                r_type, r_props = _relation_from_value(obj.get("r"))

                # Build descriptions for embeddings from properties (best-effort).
                # Prefer human-readable fields and avoid mixing structural fields like entity_type into description.
                def _desc_from_props(name: str, props: dict[str, Any]) -> str:
                    for key in ("description", "介绍", "简介", "intro", "summary"):
                        v = props.get(key)
                        if isinstance(v, str) and v.strip():
                            return v.strip()
                    if not props:
                        return ""
                    skip_keys = {
                        "entity_type",
                        "graph_tag",
                        "file_path",
                        "source_id",
                    }
                    parts = []
                    for k, v in props.items():
                        if k in skip_keys or v is None:
                            continue
                        parts.append(f"{k}: {v}")
                    return "；".join(parts)

                h_desc = _desc_from_props(h_name, h_props)
                t_desc = _desc_from_props(t_name, t_props)

                await aupsert_entity(
                    rag.chunk_entity_relation_graph,
                    rag.entities_vdb,
                    rag.relationships_vdb,
                    h_name,
                    {
                        **h_props,
                        "description": h_desc,
                        "file_path": file_path,
                        "source_id": "jsonl_import",
                        "graph_tag": normalized_tag,
                    },
                )
                entities_created_or_updated += 1

                await aupsert_entity(
                    rag.chunk_entity_relation_graph,
                    rag.entities_vdb,
                    rag.relationships_vdb,
                    t_name,
                    {
                        **t_props,
                        "description": t_desc,
                        "file_path": file_path,
                        "source_id": "jsonl_import",
                        "graph_tag": normalized_tag,
                    },
                )
                entities_created_or_updated += 1

                rel_keywords = r_type
                rel_desc_parts = [f"type: {r_type}"]
                for k, v in r_props.items():
                    if v is None:
                        continue
                    rel_desc_parts.append(f"{k}: {v}")
                rel_desc = "；".join(rel_desc_parts)

                await aupsert_relation(
                    rag.chunk_entity_relation_graph,
                    rag.entities_vdb,
                    rag.relationships_vdb,
                    h_name,
                    t_name,
                    {
                        "keywords": rel_keywords,
                        "description": rel_desc,
                        "file_path": file_path,
                        "source_id": "jsonl_import",
                        "graph_tag": normalized_tag,
                        **r_props,
                    },
                )
                relations_created_or_updated += 1

                lines_ok += 1
            except Exception as e:
                errors.append(
                    {
                        "line": line_no,
                        "error": str(e),
                        "raw": line[:5000],
                    }
                )

        return {
            "status": "success" if not errors else "partial_success",
            "graph_tag": normalized_tag,
            "lines_ok": lines_ok,
            "entities_upserted": entities_created_or_updated,
            "relations_upserted": relations_created_or_updated,
            "errors": errors[:50],
            "errors_count": len(errors),
        }

    @router.get("/graphs", dependencies=[Depends(combined_auth)])
    async def get_knowledge_graph(
        label: str = Query(..., description="Label to get knowledge graph for"),
        max_depth: int = Query(3, description="Maximum depth of graph", ge=1),
        max_nodes: int = Query(1000, description="Maximum nodes to return", ge=1),
        graph_tags: Optional[List[str]] = Query(
            None,
            description="Optional graph_tag filters. Repeated query param allowed. Empty/omitted means no filtering.",
        ),
    ):
        """
        Retrieve a connected subgraph of nodes where the label includes the specified label.
        When reducing the number of nodes, the prioritization criteria are as follows:
            1. Hops(path) to the staring node take precedence
            2. Followed by the degree of the nodes

        Args:
            label (str): Label of the starting node
            max_depth (int, optional): Maximum depth of the subgraph,Defaults to 3
            max_nodes: Maxiumu nodes to return

        Returns:
            Dict[str, List[str]]: Knowledge graph for label
        """
        try:
            # Log the label parameter to check for leading spaces
            logger.debug(
                f"get_knowledge_graph called with label: '{label}' (length: {len(label)}, repr: {repr(label)})"
            )

            return await rag.get_knowledge_graph(
                node_label=label,
                max_depth=max_depth,
                max_nodes=max_nodes,
                graph_tags=graph_tags,
            )
        except Exception as e:
            logger.error(f"Error getting knowledge graph for label '{label}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting knowledge graph: {str(e)}"
            )

    @router.get("/graph/entity/exists", dependencies=[Depends(combined_auth)])
    async def check_entity_exists(
        name: str = Query(..., description="Entity name to check"),
    ):
        """
        Check if an entity with the given name exists in the knowledge graph

        Args:
            name (str): Name of the entity to check

        Returns:
            Dict[str, bool]: Dictionary with 'exists' key indicating if entity exists
        """
        try:
            exists = await rag.chunk_entity_relation_graph.has_node(name)
            return {"exists": exists}
        except Exception as e:
            logger.error(f"Error checking entity existence for '{name}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error checking entity existence: {str(e)}"
            )

    @router.post("/graph/entity/edit", dependencies=[Depends(combined_auth)])
    async def update_entity(request: EntityUpdateRequest):
        """
        Update an entity's properties in the knowledge graph

        This endpoint allows updating entity properties, including renaming entities.
        When renaming to an existing entity name, the behavior depends on allow_merge:

        Args:
            request (EntityUpdateRequest): Request containing:
                - entity_name (str): Name of the entity to update
                - updated_data (Dict[str, Any]): Dictionary of properties to update
                - allow_rename (bool): Whether to allow entity renaming (default: False)
                - allow_merge (bool): Whether to merge into existing entity when renaming
                                     causes name conflict (default: False)

        Returns:
            Dict with the following structure:
            {
                "status": "success",
                "message": "Entity updated successfully" | "Entity merged successfully into 'target_name'",
                "data": {
                    "entity_name": str,        # Final entity name
                    "description": str,        # Entity description
                    "entity_type": str,        # Entity type
                    "source_id": str,         # Source chunk IDs
                    ...                       # Other entity properties
                },
                "operation_summary": {
                    "merged": bool,           # Whether entity was merged into another
                    "merge_status": str,      # "success" | "failed" | "not_attempted"
                    "merge_error": str | None, # Error message if merge failed
                    "operation_status": str,  # "success" | "partial_success" | "failure"
                    "target_entity": str | None, # Target entity name if renaming/merging
                    "final_entity": str,      # Final entity name after operation
                    "renamed": bool           # Whether entity was renamed
                }
            }

        operation_status values explained:
            - "success": All operations completed successfully
                * For simple updates: entity properties updated
                * For renames: entity renamed successfully
                * For merges: non-name updates applied AND merge completed

            - "partial_success": Update succeeded but merge failed
                * Non-name property updates were applied successfully
                * Merge operation failed (entity not merged)
                * Original entity still exists with updated properties
                * Use merge_error for failure details

            - "failure": Operation failed completely
                * If merge_status == "failed": Merge attempted but both update and merge failed
                * If merge_status == "not_attempted": Regular update failed
                * No changes were applied to the entity

        merge_status values explained:
            - "success": Entity successfully merged into target entity
            - "failed": Merge operation was attempted but failed
            - "not_attempted": No merge was attempted (normal update/rename)

        Behavior when renaming to an existing entity:
            - If allow_merge=False: Raises ValueError with 400 status (default behavior)
            - If allow_merge=True: Automatically merges the source entity into the existing target entity,
                                  preserving all relationships and applying non-name updates first

        Example Request (simple update):
            POST /graph/entity/edit
            {
                "entity_name": "Tesla",
                "updated_data": {"description": "Updated description"},
                "allow_rename": false,
                "allow_merge": false
            }

        Example Response (simple update success):
            {
                "status": "success",
                "message": "Entity updated successfully",
                "data": { ... },
                "operation_summary": {
                    "merged": false,
                    "merge_status": "not_attempted",
                    "merge_error": null,
                    "operation_status": "success",
                    "target_entity": null,
                    "final_entity": "Tesla",
                    "renamed": false
                }
            }

        Example Request (rename with auto-merge):
            POST /graph/entity/edit
            {
                "entity_name": "Elon Msk",
                "updated_data": {
                    "entity_name": "Elon Musk",
                    "description": "Corrected description"
                },
                "allow_rename": true,
                "allow_merge": true
            }

        Example Response (merge success):
            {
                "status": "success",
                "message": "Entity merged successfully into 'Elon Musk'",
                "data": { ... },
                "operation_summary": {
                    "merged": true,
                    "merge_status": "success",
                    "merge_error": null,
                    "operation_status": "success",
                    "target_entity": "Elon Musk",
                    "final_entity": "Elon Musk",
                    "renamed": true
                }
            }

        Example Response (partial success - update succeeded but merge failed):
            {
                "status": "success",
                "message": "Entity updated successfully",
                "data": { ... },  # Data reflects updated "Elon Msk" entity
                "operation_summary": {
                    "merged": false,
                    "merge_status": "failed",
                    "merge_error": "Target entity locked by another operation",
                    "operation_status": "partial_success",
                    "target_entity": "Elon Musk",
                    "final_entity": "Elon Msk",  # Original entity still exists
                    "renamed": true
                }
            }
        """
        try:
            result = await rag.aedit_entity(
                entity_name=request.entity_name,
                updated_data=request.updated_data,
                allow_rename=request.allow_rename,
                allow_merge=request.allow_merge,
            )

            # Extract operation_summary from result, with fallback for backward compatibility
            operation_summary = result.get(
                "operation_summary",
                {
                    "merged": False,
                    "merge_status": "not_attempted",
                    "merge_error": None,
                    "operation_status": "success",
                    "target_entity": None,
                    "final_entity": request.updated_data.get(
                        "entity_name", request.entity_name
                    ),
                    "renamed": request.updated_data.get(
                        "entity_name", request.entity_name
                    )
                    != request.entity_name,
                },
            )

            # Separate entity data from operation_summary for clean response
            entity_data = dict(result)
            entity_data.pop("operation_summary", None)

            # Generate appropriate response message based on merge status
            response_message = (
                f"Entity merged successfully into '{operation_summary['final_entity']}'"
                if operation_summary.get("merged")
                else "Entity updated successfully"
            )
            return {
                "status": "success",
                "message": response_message,
                "data": entity_data,
                "operation_summary": operation_summary,
            }
        except ValueError as ve:
            logger.error(
                f"Validation error updating entity '{request.entity_name}': {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(f"Error updating entity '{request.entity_name}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error updating entity: {str(e)}"
            )

    @router.post("/graph/relation/edit", dependencies=[Depends(combined_auth)])
    async def update_relation(request: RelationUpdateRequest):
        """Update a relation's properties in the knowledge graph

        Args:
            request (RelationUpdateRequest): Request containing source ID, target ID and updated data

        Returns:
            Dict: Updated relation information
        """
        try:
            result = await rag.aedit_relation(
                source_entity=request.source_id,
                target_entity=request.target_id,
                updated_data=request.updated_data,
            )
            return {
                "status": "success",
                "message": "Relation updated successfully",
                "data": result,
            }
        except ValueError as ve:
            logger.error(
                f"Validation error updating relation between '{request.source_id}' and '{request.target_id}': {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(
                f"Error updating relation between '{request.source_id}' and '{request.target_id}': {str(e)}"
            )
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error updating relation: {str(e)}"
            )

    @router.post("/graph/entity/create", dependencies=[Depends(combined_auth)])
    async def create_entity(request: EntityCreateRequest):
        """
        Create a new entity in the knowledge graph

        This endpoint creates a new entity node in the knowledge graph with the specified
        properties. The system automatically generates vector embeddings for the entity
        to enable semantic search and retrieval.

        Request Body:
            entity_name (str): Unique name identifier for the entity
            entity_data (dict): Entity properties including:
                - description (str): Textual description of the entity
                - entity_type (str): Category/type of the entity (e.g., PERSON, ORGANIZATION, LOCATION)
                - source_id (str): Related chunk_id from which the description originates
                - Additional custom properties as needed

        Response Schema:
            {
                "status": "success",
                "message": "Entity 'Tesla' created successfully",
                "data": {
                    "entity_name": "Tesla",
                    "description": "Electric vehicle manufacturer",
                    "entity_type": "ORGANIZATION",
                    "source_id": "chunk-123<SEP>chunk-456"
                    ... (other entity properties)
                }
            }

        HTTP Status Codes:
            200: Entity created successfully
            400: Invalid request (e.g., missing required fields, duplicate entity)
            500: Internal server error

        Example Request:
            POST /graph/entity/create
            {
                "entity_name": "Tesla",
                "entity_data": {
                    "description": "Electric vehicle manufacturer",
                    "entity_type": "ORGANIZATION"
                }
            }
        """
        try:
            # Use the proper acreate_entity method which handles:
            # - Graph lock for concurrency
            # - Vector embedding creation in entities_vdb
            # - Metadata population and defaults
            # - Index consistency via _edit_entity_done
            result = await rag.acreate_entity(
                entity_name=request.entity_name,
                entity_data=request.entity_data,
            )

            return {
                "status": "success",
                "message": f"Entity '{request.entity_name}' created successfully",
                "data": result,
            }
        except ValueError as ve:
            logger.error(
                f"Validation error creating entity '{request.entity_name}': {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(f"Error creating entity '{request.entity_name}': {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error creating entity: {str(e)}"
            )

    @router.post("/graph/relation/create", dependencies=[Depends(combined_auth)])
    async def create_relation(request: RelationCreateRequest):
        """
        Create a new relationship between two entities in the knowledge graph

        This endpoint establishes an undirected relationship between two existing entities.
        The provided source/target order is accepted for convenience, but the backend
        stored edge is undirected and may be returned with the entities swapped.
        Both entities must already exist in the knowledge graph. The system automatically
        generates vector embeddings for the relationship to enable semantic search and graph traversal.

        Prerequisites:
            - Both source_entity and target_entity must exist in the knowledge graph
            - Use /graph/entity/create to create entities first if they don't exist

        Request Body:
            source_entity (str): Name of the source entity (relationship origin)
            target_entity (str): Name of the target entity (relationship destination)
            relation_data (dict): Relationship properties including:
                - description (str): Textual description of the relationship
                - keywords (str): Comma-separated keywords describing the relationship type
                - source_id (str): Related chunk_id from which the description originates
                - weight (float): Relationship strength/importance (default: 1.0)
                - Additional custom properties as needed

        Response Schema:
            {
                "status": "success",
                "message": "Relation created successfully between 'Elon Musk' and 'Tesla'",
                "data": {
                    "src_id": "Elon Musk",
                    "tgt_id": "Tesla",
                    "description": "Elon Musk is the CEO of Tesla",
                    "keywords": "CEO, founder",
                    "source_id": "chunk-123<SEP>chunk-456"
                    "weight": 1.0,
                    ... (other relationship properties)
                }
            }

        HTTP Status Codes:
            200: Relationship created successfully
            400: Invalid request (e.g., missing entities, invalid data, duplicate relationship)
            500: Internal server error

        Example Request:
            POST /graph/relation/create
            {
                "source_entity": "Elon Musk",
                "target_entity": "Tesla",
                "relation_data": {
                    "description": "Elon Musk is the CEO of Tesla",
                    "keywords": "CEO, founder",
                    "weight": 1.0
                }
            }
        """
        try:
            # Use the proper acreate_relation method which handles:
            # - Graph lock for concurrency
            # - Entity existence validation
            # - Duplicate relation checks
            # - Vector embedding creation in relationships_vdb
            # - Index consistency via _edit_relation_done
            result = await rag.acreate_relation(
                source_entity=request.source_entity,
                target_entity=request.target_entity,
                relation_data=request.relation_data,
            )

            return {
                "status": "success",
                "message": f"Relation created successfully between '{request.source_entity}' and '{request.target_entity}'",
                "data": result,
            }
        except ValueError as ve:
            logger.error(
                f"Validation error creating relation between '{request.source_entity}' and '{request.target_entity}': {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(
                f"Error creating relation between '{request.source_entity}' and '{request.target_entity}': {str(e)}"
            )
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error creating relation: {str(e)}"
            )

    @router.post("/graph/entities/merge", dependencies=[Depends(combined_auth)])
    async def merge_entities(request: EntityMergeRequest):
        """
        Merge multiple entities into a single entity, preserving all relationships

        This endpoint consolidates duplicate or misspelled entities while preserving the entire
        graph structure. It's particularly useful for cleaning up knowledge graphs after document
        processing or correcting entity name variations.

        What the Merge Operation Does:
            1. Deletes the specified source entities from the knowledge graph
            2. Transfers all relationships from source entities to the target entity
            3. Intelligently merges duplicate relationships (if multiple sources have the same relationship)
            4. Updates vector embeddings for accurate retrieval and search
            5. Preserves the complete graph structure and connectivity
            6. Maintains relationship properties and metadata

        Use Cases:
            - Fixing spelling errors in entity names (e.g., "Elon Msk" -> "Elon Musk")
            - Consolidating duplicate entities discovered after document processing
            - Merging name variations (e.g., "NY", "New York", "New York City")
            - Cleaning up the knowledge graph for better query performance
            - Standardizing entity names across the knowledge base

        Request Body:
            entities_to_change (list[str]): List of entity names to be merged and deleted
            entity_to_change_into (str): Target entity that will receive all relationships

        Response Schema:
            {
                "status": "success",
                "message": "Successfully merged 2 entities into 'Elon Musk'",
                "data": {
                    "merged_entity": "Elon Musk",
                    "deleted_entities": ["Elon Msk", "Ellon Musk"],
                    "relationships_transferred": 15,
                    ... (merge operation details)
                }
            }

        HTTP Status Codes:
            200: Entities merged successfully
            400: Invalid request (e.g., empty entity list, target entity doesn't exist)
            500: Internal server error

        Example Request:
            POST /graph/entities/merge
            {
                "entities_to_change": ["Elon Msk", "Ellon Musk"],
                "entity_to_change_into": "Elon Musk"
            }

        Note:
            - The target entity (entity_to_change_into) must exist in the knowledge graph
            - Source entities will be permanently deleted after the merge
            - This operation cannot be undone, so verify entity names before merging
        """
        try:
            result = await rag.amerge_entities(
                source_entities=request.entities_to_change,
                target_entity=request.entity_to_change_into,
            )
            return {
                "status": "success",
                "message": f"Successfully merged {len(request.entities_to_change)} entities into '{request.entity_to_change_into}'",
                "data": result,
            }
        except ValueError as ve:
            logger.error(
                f"Validation error merging entities {request.entities_to_change} into '{request.entity_to_change_into}': {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            logger.error(
                f"Error merging entities {request.entities_to_change} into '{request.entity_to_change_into}': {str(e)}"
            )
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error merging entities: {str(e)}"
            )

    return router