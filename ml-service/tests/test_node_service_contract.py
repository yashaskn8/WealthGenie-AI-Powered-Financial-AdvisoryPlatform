"""Consumer-contract evidence shared by Express and FastAPI."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rag.schema import RAGQueryRequest, RAGQueryResponse
from schemas import PredictRequest, PredictResponse


FIXTURES = json.loads(
    (Path(__file__).parents[2] / "server" / "contracts" / "ml-service-contract.fixtures.json").read_text(encoding="utf-8")
)


def test_express_prediction_request_is_accepted_by_fastapi_schema():
    request = PredictRequest.model_validate(FIXTURES["prediction_request"])
    assert request.emi_burden_pct == 12
    assert request.investment_goals == ["Wealth Growth"]
    assert request.feature_schema_version == "recommendation-features-4.0.0"


def test_prediction_success_response_matches_fastapi_schema():
    response = PredictResponse.model_validate(FIXTURES["prediction_response"])
    assert response.primary == "ETF"
    assert response.model_version == "4.0.0"
    assert response.explanation is not None


def test_prediction_response_rejects_class_probability_and_version_drift():
    response = FIXTURES["prediction_response"]
    with pytest.raises(ValidationError):
        PredictResponse.model_validate({**response, "tertiary": "SGB"})
    with pytest.raises(ValidationError):
        PredictResponse.model_validate({**response, "confidence_scores": {"ETF": 1.0}})
    with pytest.raises(ValidationError):
        PredictResponse.model_validate({**response, "dataset_version": ""})


def test_prediction_request_rejects_unknown_casing_or_duplicate_fields():
    with pytest.raises(ValidationError):
        PredictRequest.model_validate({**FIXTURES["prediction_request"], "annual_income": 1800000})
    with pytest.raises(ValidationError):
        PredictRequest.model_validate({**FIXTURES["prediction_request"], "existing_debt_emi_ratio_pct": 12})


def test_express_rag_request_and_both_response_states_match_pydantic():
    request = RAGQueryRequest.model_validate(FIXTURES["rag_request"])
    grounded = RAGQueryResponse.model_validate(FIXTURES["rag_grounded_response"])
    abstention = RAGQueryResponse.model_validate(FIXTURES["rag_abstention_response"])
    assert request.top_k == 4
    assert grounded.grounded is True and grounded.citations[0].chunk_id == "tax-80c#1"
    assert abstention.grounded is False and abstention.citations == []


def test_rag_request_rejects_silent_node_python_field_drift():
    with pytest.raises(ValidationError):
        RAGQueryRequest.model_validate({**FIXTURES["rag_request"], "threshold": 0.2})
    with pytest.raises(ValidationError):
        RAGQueryRequest.model_validate({**FIXTURES["rag_request"], "topK": 4})
