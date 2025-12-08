import json
import numpy as np
import pytest

from lightrag.constants import DEFAULT_ENTITY_TYPES
from lightrag.lightrag import LightRAG
from lightrag.utils import EmbeddingFunc


@pytest.mark.asyncio
async def test_derive_schema_types_from_contents(tmp_path):
    async def fake_llm(prompt, system_prompt=None, hashing_kv=None, **kwargs):
        if "CLINIC_B" in prompt:
            payload = {
                "entity_types": [
                    {"name": "POLICY", "description": "Compliance policy."},
                    {"name": "CLAUSE", "description": "Policy clause."},
                ],
                "relation_types": [
                    {"name": "GOVERNS", "description": "Policy governs clause."},
                    {"name": "REFERENCES", "description": "Clause references policy."},
                ],
            }
        else:
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
    schema_a = await rag.aderive_schema_types(
        contents=["CLINIC_A: Therapy A treats Symptom B and addresses complications."],
        max_entity_types=3,
        max_relation_types=2,
        graph_tag="clinic-a",
    )

    schema_b = await rag.aderive_schema_types(
        contents=["CLINIC_B: policy text regulating Clause C."],
        max_entity_types=3,
        max_relation_types=2,
        graph_tag="clinic-b",
    )

    schema_default = rag.get_schema_for_graph_tag(None)

    assert schema_a["graph_tag"] == "clinic-a"
    assert schema_a["entity_types"][:2] == ["THERAPY", "SYMPTOM"]
    assert schema_a["relation_types"][:2] == ["TREATS", "CAUSES"]

    assert schema_b["graph_tag"] == "clinic-b"
    assert schema_b["entity_types"][:2] == ["POLICY", "CLAUSE"]
    assert schema_b["relation_types"][:2] == ["GOVERNS", "REFERENCES"]

    clinic_a_schema = rag.get_schema_for_graph_tag("clinic-a")
    clinic_b_schema = rag.get_schema_for_graph_tag("clinic-b")

    assert clinic_a_schema["entity_types"][0] == "THERAPY"
    assert clinic_b_schema["entity_types"][0] == "POLICY"
    assert clinic_b_schema["relation_types"][0] == "GOVERNS"

    assert schema_default["entity_types"][0] == DEFAULT_ENTITY_TYPES[0]
    assert rag.addon_params["entity_types"][0] == DEFAULT_ENTITY_TYPES[0]
