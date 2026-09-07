"""
WealthGenie Open-Weight LLM Platform - Production Inference Test Suite (Phase 3.5)
Tests conversation management, financial tool calling, batch inference, and RAG+LLM endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from llm.inference.conversation import ConversationHistory
from llm.inference.tools import ToolCallingEngine


def test_conversation_history_management():
    conv = ConversationHistory(session_id="session-001")
    assert conv.session_id == "session-001"
    assert len(conv.messages) == 0

    conv.add_message("user", "What is Section 87A?")
    conv.add_message("assistant", "Section 87A provides a tax rebate.")
    assert len(conv.messages) == 2

    payload = conv.get_messages_payload()
    assert payload[0]["role"] == "user"
    assert payload[1]["content"] == "Section 87A provides a tax rebate."

    conv.clear()
    assert len(conv.messages) == 0


def test_conversation_sliding_window_truncation():
    conv = ConversationHistory(session_id="session-002", max_history_turns=3)
    for i in range(10):
        conv.add_message("user", f"Question {i}")
        conv.add_message("assistant", f"Answer {i}")
    # Should retain only the last max_history_turns * 2 = 6 messages
    assert len(conv.messages) <= 6


def test_tool_calling_engine_sip():
    engine = ToolCallingEngine()
    result = engine.execute_tool("calculate_sip", {
        "monthly_investment": 10000, "rate_pct": 12.0, "years": 10,
    })
    assert result.success
    assert result.result["estimated_future_value"] > 0
    assert result.result["total_invested"] == 1200000.0


def test_tool_calling_engine_cagr():
    engine = ToolCallingEngine()
    result = engine.execute_tool("calculate_cagr", {
        "initial_value": 100000, "final_value": 200000, "years": 5,
    })
    assert result.success
    assert 14.0 <= result.result["cagr_percent"] <= 15.0


def test_tool_calling_engine_tax_rebate():
    engine = ToolCallingEngine()
    result = engine.execute_tool("calculate_tax_rebate", {
        "taxable_income": 600000, "regime": "new",
    })
    assert result.success
    assert result.result["net_tax_liability"] == 0
    assert result.result["rebate_applied"] is True


def test_tax_tool_high_income_nonzero():
    """Prove Task 1 fix: High income (₹25L new) must calculate non-zero tax, NOT 0."""
    engine = ToolCallingEngine()
    result = engine.execute_tool("calculate_tax_rebate", {
        "annual_income": 2500000, "regime": "new", "income_source": "salary",
    })
    assert result.success
    assert result.result["net_tax_liability"] == 319800
    assert result.result["taxable_income"] == 2425000
    assert result.result["standard_deduction"] == 75000


def test_tax_tool_golden_vector_parity():
    """Parity test across all 11 machine-generated golden vectors from taxEngine.js."""
    engine = ToolCallingEngine()
    vectors = [
        {"id": "GV-1", "income": 1275000, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 0, "expected_taxable": 1200000},
        {"id": "GV-2", "income": 1275100, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 104, "expected_taxable": 1200100},
        {"id": "GV-3", "income": 1500000, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 97500, "expected_taxable": 1425000},
        {"id": "GV-4", "income": 2500000, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 319800, "expected_taxable": 2425000},
        {"id": "GV-5", "income": 550000, "regime": "old", "deductions": {}, "source": "salary", "expected_tax": 0, "expected_taxable": 500000},
        {"id": "GV-6", "income": 550100, "regime": "old", "deductions": {}, "source": "salary", "expected_tax": 13021, "expected_taxable": 500100},
        {"id": "GV-7", "income": 2500000, "regime": "old", "deductions": {"section80C": 150000, "section80D_self": 25000, "section80D_parents": 25000, "parents_senior": False, "age": 40, "nps80CCD1B": 50000, "homeLoanInterest": 200000}, "source": "salary", "expected_tax": 429000, "expected_taxable": 2000000},
        {"id": "GV-8", "income": 8000000, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 2239380, "expected_taxable": 7925000},
        {"id": "GV-9", "income": 5100000, "regime": "new", "deductions": {}, "source": "salary", "expected_tax": 1149200, "expected_taxable": 5025000},
        {"id": "GV-10", "income": 60000000, "regime": "old", "deductions": {}, "source": "salary", "expected_tax": 25357878, "expected_taxable": 59950000},
        {"id": "GV-11", "income": 1800000, "regime": "new", "deductions": {"basicSalary": 900000, "isGovtEmployee": False, "nps80CCD2": 90000, "section80D_parents": 50000, "parents_senior": True, "age": 40}, "source": "salary", "expected_tax": 132080, "expected_taxable": 1635000},
    ]

    for v in vectors:
        res = engine.execute_tool("calculate_tax_rebate", {
            "annual_income": v["income"],
            "regime": v["regime"],
            "deductions": v["deductions"],
            "income_source": v["source"],
        })
        assert res.success, f"Failed on {v['id']}: {res.result}"
        assert res.result["taxable_income"] == v["expected_taxable"], f"{v['id']} taxable income mismatch: {res.result['taxable_income']} vs {v['expected_taxable']}"
        assert res.result["net_tax_liability"] == v["expected_tax"], f"{v['id']} tax liability mismatch: {res.result['net_tax_liability']} vs {v['expected_tax']}"


@pytest.mark.parametrize("arguments, expected_error", [
    ({"annual_income": 1800000, "regime": "new"}, "income_source"),
    ({"annual_income": 1800000, "income_source": "salary"}, "regime"),
    ({"annual_income": 1800000, "taxable_income": 1725000, "regime": "new", "income_source": "salary"}, "exactly one"),
    ({"annual_income": 1800000, "regime": "new", "income_source": "salary", "deductions": {"nps80CCD2": 90000}}, "basic_salary"),
    ({"annual_income": 1800000, "regime": "old", "income_source": "salary", "deductions": {"section80D_self": 25000}}, "age"),
    ({"taxable_income": 1200000, "regime": "new", "fiscal_year": "FY2099-00"}, "not verified"),
])
def test_tax_tool_rejects_hidden_or_conflicting_assumptions(arguments, expected_error):
    result = ToolCallingEngine().execute_tool("calculate_tax_rebate", arguments)
    assert result.success is False
    assert expected_error in result.result["error"]


def test_financial_tools_are_explicitly_non_recommendation_calculations():
    engine = ToolCallingEngine()
    sip = engine.execute_tool("calculate_sip", {
        "monthly_investment": 10000, "rate_pct": 12.0, "years": 10,
    })
    tax = engine.execute_tool("calculate_tax_rebate", {
        "taxable_income": 600000, "regime": "new",
    })
    assert sip.result["classification"] == "NON_RECOMMENDATION_WHAT_IF"
    assert tax.result["classification"] == "SEPARATE_TAX_WHAT_IF"


def test_tool_calling_engine_unknown_tool():
    engine = ToolCallingEngine()
    result = engine.execute_tool("nonexistent_tool", {})
    assert not result.success
    assert "error" in result.result


def test_tool_calling_engine_list_tools():
    engine = ToolCallingEngine()
    tools = engine.list_tools()
    assert len(tools) == 3
    names = [t["name"] for t in tools]
    assert "calculate_sip" in names
    assert "calculate_cagr" in names
    assert "calculate_tax_rebate" in names


def test_llm_router_batch_generate_and_tool_endpoints():
    import os
    from main import app
    api_key = os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026")
    client = TestClient(app, headers={"X-API-Key": api_key, "X-Verified-User-Id": "test-user-id"})

    # Batch generate
    batch_res = client.post("/llm/batch-generate", json=[
        {"prompt": "What is ELSS?"},
        {"prompt": "Explain PPF."},
    ])
    assert batch_res.status_code == 200
    data = batch_res.json()
    assert data["batch_count"] == 2
    assert len(data["responses"]) == 2

    # Tool query
    tool_res = client.post("/llm/tool-query", json={
        "tool_name": "calculate_sip",
        "arguments": {"monthly_investment": 5000, "rate_pct": 10.0, "years": 5},
    })
    assert tool_res.status_code == 200
    assert tool_res.json()["success"]

    # List tools
    tools_res = client.get("/llm/tools")
    assert tools_res.status_code == 200
    assert len(tools_res.json()["tools"]) == 3
