import asyncio
import json
import tempfile

import numpy as np

from lightrag.utils import EmbeddingFunc, compute_mdhash_id
from lightrag.kg.shared_storage import initialize_share_data
from lightrag.kg.networkx_impl import NetworkXStorage
from lightrag.kg.nano_vector_db_impl import NanoVectorDBStorage
from lightrag.utils_graph import aupsert_entity, aupsert_relation, _tagged_entity_vdb_id


async def _mock_embed(texts, **kwargs):
    # Deterministic embeddings for tests
    dim = 4
    arr = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        arr[i, 0] = float(len(str(t)))
        arr[i, 1] = 1.0
    return arr


def test_jsonl_import_writes_graph_tag_and_embeddings():
    initialize_share_data()
    emb = EmbeddingFunc(embedding_dim=4, func=_mock_embed)

    with tempfile.TemporaryDirectory() as td:
        global_config = {
            "working_dir": td,
            "embedding_batch_num": 8,
            "vector_db_storage_cls_kwargs": {"cosine_better_than_threshold": 0.0},
            "workspace": "test_ws",
        }

        graph = NetworkXStorage(
            namespace="graph",
            workspace="test_ws",
            global_config=global_config,
            embedding_func=emb,
        )
        entities_vdb = NanoVectorDBStorage(
            namespace="entities_vdb",
            workspace="test_ws",
            global_config=global_config,
            embedding_func=emb,
            meta_fields={
                "entity_name",
                "entity_type",
                "description",
                "source_id",
                "file_path",
                "graph_tag",
                "embedding_scope",
            },
        )
        relations_vdb = NanoVectorDBStorage(
            namespace="relationships_vdb",
            workspace="test_ws",
            global_config=global_config,
            embedding_func=emb,
            meta_fields={
                "src_id",
                "tgt_id",
                "keywords",
                "description",
                "source_id",
                "file_path",
                "graph_tag",
                "embedding_scope",
            },
        )

        async def _run():
            await graph.initialize()
            await entities_vdb.initialize()
            await relations_vdb.initialize()

            graph_tag = "西游记"

            await aupsert_entity(
                graph,
                entities_vdb,
                relations_vdb,
                "孙悟空",
                {
                    "title": "齐天大圣",
                    "weapon": "如意金箍棒",
                    "description": "title: 齐天大圣；weapon: 如意金箍棒",
                    "graph_tag": graph_tag,
                    "file_path": "unit_test",
                },
            )

            await aupsert_entity(
                graph,
                entities_vdb,
                relations_vdb,
                "唐僧",
                {"species": "人", "description": "species: 人", "graph_tag": graph_tag},
            )

            await aupsert_relation(
                graph,
                entities_vdb,
                relations_vdb,
                "孙悟空",
                "唐僧",
                {
                    "keywords": "徒弟",
                    "description": "type: 徒弟；order: 1",
                    "order": 1,
                    "graph_tag": graph_tag,
                },
            )

            node = await graph.get_node("孙悟空")
            assert node is not None
            assert node.get("graph_tag") == graph_tag
            assert node.get("title") == "齐天大圣"
            assert node.get("weapon") == "如意金箍棒"

            legacy_id = compute_mdhash_id("孙悟空", prefix="ent-")
            tagged_id = _tagged_entity_vdb_id("孙悟空", graph_tag=graph_tag)
            legacy = await entities_vdb.get_by_id(legacy_id)
            tagged = await entities_vdb.get_by_id(tagged_id)
            assert legacy is not None
            assert tagged is not None
            assert legacy.get("entity_name") == "孙悟空"
            assert legacy.get("graph_tag") == graph_tag
            assert tagged.get("embedding_scope") == "graph_tag"

        asyncio.run(_run())

