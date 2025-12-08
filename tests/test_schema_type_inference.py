import json
import numpy as np
import pytest

from lightrag.lightrag import LightRAG
from lightrag.utils import EmbeddingFunc


@pytest.mark.asyncio
async def test_derive_schema_types_from_contents(tmp_path):
    async def fake_llm(prompt, system_prompt=None, hashing_kv=None, **kwargs):
        payload = {
            "entity_types": [
                {"name": "THERAPY", "description": "Medical interventions."},
                {"name": "SYMPTOM", "description": "Observable patient conditions."},
            ],
            "relation_types": [
                {"name": "TREATS", "description": "Therapy resolves symptom."},
                {"name": "CAUSES", "description": "Symptom caused by condition."},
            ],
        }
        return json.dumps(payload)

    async def fake_embed(texts, **kwargs):
        return np.zeros((len(texts), 1), dtype=float)

    rag = LightRAG(
        working_dir=str(tmp_path / "schema-store"),
        llm_model_func=fake_llm,
        graph_storage="NetworkXStorage",
        embedding_func=EmbeddingFunc(embedding_dim=1, func=fake_embed),
    )

    await rag.initialize_storages()
    schema = await rag.aderive_schema_types(
        contents=["Therapy A treats Symptom B and addresses complications."],
        max_entity_types=3,
        max_relation_types=2,
    )

    assert schema["entity_types"][:2] == ["THERAPY", "SYMPTOM"]
    assert schema["relation_types"][:2] == ["TREATS", "CAUSES"]
    assert rag.addon_params["entity_types"][0] == "THERAPY"
    assert rag.addon_params["relation_types"][0] == "TREATS"
