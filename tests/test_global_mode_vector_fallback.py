import pytest


@pytest.mark.asyncio
async def test_build_query_context_allows_vector_only_context_in_global_mode(monkeypatch):
    """
    Regression test:
    - global mode used to early-return None when entities/relations were empty,
      even if vector chunks existed (or could exist via fallback).
    - this caused PROMPTS["fail_response"] -> [no-context] in the UI.
    """
    import lightrag.operate as op
    from lightrag.base import QueryParam

    class DummyTextChunksDB:
        def __init__(self):
            self.global_config = {}

    async def fake_perform_kg_search(*args, **kwargs):
        return {
            "final_entities": [],
            "final_relations": [],
            "vector_chunks": [
                {"chunk_id": "c1", "content": "甘草是一种中药材。", "file_path": "doc.md"}
            ],
            "chunk_tracking": {"c1": {"source": "C", "frequency": 1, "order": 1}},
            "query_embedding": None,
        }

    async def fake_apply_token_truncation(*args, **kwargs):
        return {
            "entities_context": [],
            "relations_context": [],
            "filtered_entities": [],
            "filtered_relations": [],
            "entity_id_to_original": {},
            "relation_id_to_original": {},
        }

    async def fake_merge_all_chunks(*args, **kwargs):
        return [{"chunk_id": "c1", "content": "甘草是一种中药材。", "file_path": "doc.md"}]

    async def fake_build_context_str(*args, **kwargs):
        return (
            "CTX",
            {
                "status": "success",
                "message": "ok",
                "data": {"entities": [], "relationships": [], "chunks": [], "references": []},
                "metadata": {"query_mode": "global"},
            },
        )

    monkeypatch.setattr(op, "_perform_kg_search", fake_perform_kg_search)
    monkeypatch.setattr(op, "_apply_token_truncation", fake_apply_token_truncation)
    monkeypatch.setattr(op, "_merge_all_chunks", fake_merge_all_chunks)
    monkeypatch.setattr(op, "_build_context_str", fake_build_context_str)

    # storages are unused due to monkeypatching; pass None placeholders
    result = await op._build_query_context(
        query="甘草是什么",
        ll_keywords="",
        hl_keywords="甘草",
        knowledge_graph_inst=None,  # type: ignore[arg-type]
        entities_vdb=None,  # type: ignore[arg-type]
        relationships_vdb=None,  # type: ignore[arg-type]
        text_chunks_db=DummyTextChunksDB(),  # type: ignore[arg-type]
        query_param=QueryParam(mode="global"),
        chunks_vdb=None,  # type: ignore[arg-type]
    )

    assert result is not None
    assert result.context == "CTX"


@pytest.mark.asyncio
async def test_perform_kg_search_global_mode_falls_back_to_vector_chunks(monkeypatch):
    """
    Ensure global mode tries chunk vector retrieval when relationship search yields no relations.
    """
    import lightrag.operate as op
    from lightrag.base import QueryParam

    called = {"vector": 0}

    async def fake_get_edge_data(*args, **kwargs):
        return [], []

    async def fake_get_vector_context(*args, **kwargs):
        called["vector"] += 1
        return [{"chunk_id": "c1", "content": "x", "file_path": "doc.md"}]

    class DummyTextChunksDB:
        def __init__(self):
            self.global_config = {"kg_chunk_pick_method": "WEIGHT"}
            self.embedding_func = None

    monkeypatch.setattr(op, "_get_edge_data", fake_get_edge_data)
    monkeypatch.setattr(op, "_get_vector_context", fake_get_vector_context)

    res = await op._perform_kg_search(
        query="甘草是什么",
        ll_keywords="",
        hl_keywords="甘草",
        knowledge_graph_inst=None,  # type: ignore[arg-type]
        entities_vdb=None,  # type: ignore[arg-type]
        relationships_vdb=None,  # type: ignore[arg-type]
        text_chunks_db=DummyTextChunksDB(),  # type: ignore[arg-type]
        query_param=QueryParam(mode="global"),
        chunks_vdb=object(),  # non-None to enable fallback
    )

    assert called["vector"] == 1
    assert len(res["vector_chunks"]) == 1
    assert res["vector_chunks"][0]["chunk_id"] == "c1"

