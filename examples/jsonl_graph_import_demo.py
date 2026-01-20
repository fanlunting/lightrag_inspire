import argparse
import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from lightrag import LightRAG
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc, logger, set_verbose_debug
from lightrag.kg.shared_storage import initialize_pipeline_status
from lightrag.utils_graph import aupsert_entity, aupsert_relation


def _load_env():
    # Keep behavior consistent with other examples (load repo root .env).
    load_dotenv(
        dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        override=True,
    )


async def llm_model_func(
    prompt, system_prompt=None, history_messages=None, keyword_extraction=False, **kwargs
) -> str:
    history_messages = history_messages or []
    return await openai_complete_if_cache(
        os.getenv("LLM_MODEL", "deepseek-chat"),
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key=os.getenv("LLM_BINDING_API_KEY", ""),
        base_url=os.getenv("LLM_BINDING_HOST", "https://api.deepseek.com"),
        **kwargs,
    )


async def initialize_rag(working_dir: str, graph_storage: str) -> LightRAG:
    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_model_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=int(os.getenv("EMBEDDING_DIM", "1024")),
            max_token_size=int(os.getenv("MAX_EMBED_TOKENS", "8192")),
            func=lambda texts: openai_embed(
                texts,
                model=os.getenv("EMBEDDING_MODEL", "BAAI/bge-large-zh-v1.5"),
                base_url=os.getenv("EMBEDDING_BINDING_HOST", ""),
                api_key=os.getenv("EMBEDDING_BINDING_API_KEY", ""),
            ),
        ),
        graph_storage=graph_storage,
    )

    await rag.initialize_storages()
    await initialize_pipeline_status()
    return rag


def _entity_from_value(v):
    if isinstance(v, str):
        name = v.strip()
        if not name:
            raise ValueError("entity name cannot be empty")
        return name, None, {}
    if isinstance(v, dict):
        raw_name = v.get("name")
        if not isinstance(raw_name, str) or not raw_name.strip():
            raise ValueError("entity object must have non-empty 'name'")
        name = raw_name.strip()
        raw_type = v.get("entity_type") or v.get("enity_type")
        entity_type = raw_type.strip() if isinstance(raw_type, str) and raw_type.strip() else None
        props = {
            k: vv for k, vv in v.items() if k not in {"name", "entity_type", "enity_type"}
        }
        return name, entity_type, props
    raise ValueError("entity must be a string or an object with {name: ...}")


def _relation_from_value(v):
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


def _desc_from_props(props: dict) -> str:
    for key in ("description", "介绍", "简介", "intro", "summary"):
        v = props.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    if not props:
        return ""
    skip_keys = {"entity_type", "graph_tag", "file_path", "source_id"}
    parts = []
    for k, v in props.items():
        if k in skip_keys or v is None:
            continue
        parts.append(f"{k}: {v}")
    return "；".join(parts)


async def import_jsonl_to_graph(rag: LightRAG, jsonl_path: str, graph_tag: str, file_path: str):
    graph_tag = (graph_tag or "").strip() or "default"
    file_path = file_path or Path(jsonl_path).name

    lines_ok = 0
    errors = 0

    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
                if not isinstance(obj, dict):
                    raise ValueError("each line must be a JSON object")

                h_name, h_type, h_props = _entity_from_value(obj.get("h"))
                t_name, t_type, t_props = _entity_from_value(obj.get("t"))
                r_type, r_props = _relation_from_value(obj.get("r"))

                h_desc = _desc_from_props(h_props)
                t_desc = _desc_from_props(t_props)

                await aupsert_entity(
                    rag.chunk_entity_relation_graph,
                    rag.entities_vdb,
                    rag.relationships_vdb,
                    h_name,
                    {
                        **h_props,
                        "description": h_desc,
                        "entity_type": h_type or "UNKNOWN",
                        "file_path": file_path,
                        "source_id": "jsonl_import",
                        "graph_tag": graph_tag,
                    },
                )

                await aupsert_entity(
                    rag.chunk_entity_relation_graph,
                    rag.entities_vdb,
                    rag.relationships_vdb,
                    t_name,
                    {
                        **t_props,
                        "description": t_desc,
                        "entity_type": t_type or "UNKNOWN",
                        "file_path": file_path,
                        "source_id": "jsonl_import",
                        "graph_tag": graph_tag,
                    },
                )

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
                        "graph_tag": graph_tag,
                        **r_props,
                    },
                )

                lines_ok += 1
                if lines_ok % 200 == 0:
                    logger.info(f"Imported {lines_ok} lines...")
            except Exception as e:
                errors += 1
                logger.warning(f"Line {line_no} skipped: {e}")

    logger.info(
        f"Import finished. graph_tag={graph_tag}, file_path={file_path}, lines_ok={lines_ok}, errors={errors}"
    )


async def main():
    _load_env()
    set_verbose_debug(os.getenv("VERBOSE_DEBUG", "false").lower() == "true")

    parser = argparse.ArgumentParser(
        description="Import a .jsonl KG file into LightRAG graph + embeddings (graph_tag isolated)."
    )
    parser.add_argument("--jsonl", required=True, help="Path to the .jsonl file")
    parser.add_argument("--graph-tag", default="default", help="graph_tag to isolate this KG")
    parser.add_argument(
        "--file-path",
        default="",
        help="Logical file_path stored in KG metadata (default: jsonl filename)",
    )
    parser.add_argument(
        "--working-dir",
        default="./jsonl_import_demo",
        help="LightRAG working_dir (default: ./jsonl_import_demo)",
    )
    parser.add_argument(
        "--graph-storage",
        default=os.getenv("LIGHTRAG_GRAPH_STORAGE", "Neo4JStorage"),
        help="Graph storage implementation (default: Neo4JStorage or LIGHTRAG_GRAPH_STORAGE)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.working_dir):
        os.makedirs(args.working_dir, exist_ok=True)

    rag: LightRAG | None = None
    try:
        rag = await initialize_rag(args.working_dir, args.graph_storage)
        await import_jsonl_to_graph(
            rag,
            jsonl_path=args.jsonl,
            graph_tag=args.graph_tag,
            file_path=args.file_path,
        )
    finally:
        if rag:
            await rag.finalize_storages()


if __name__ == "__main__":
    asyncio.run(main())

