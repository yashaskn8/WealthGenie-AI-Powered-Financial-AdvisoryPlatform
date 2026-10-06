"""
WealthGenie Open-Weight LLM Platform - Financial Tool Calling Engine
Provides non-authoritative SIP and historical CAGR calculations with structured execution.
"""

import math
import logging
from typing import Dict, Any, List
from pydantic import BaseModel, Field

logger = logging.getLogger("wealthgenie.llm.tools")

def _non_negative_number(value: Any, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a non-negative finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a non-negative finite number") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name} must be a non-negative finite number")
    return number


class ToolCallResult(BaseModel):
    """Result of a tool invocation."""
    tool_name: str = Field(..., description="Name of invoked tool")
    arguments: Dict[str, Any] = Field(..., description="Arguments passed to tool")
    result: Dict[str, Any] = Field(..., description="Structured computation output")
    success: bool = Field(True, description="Whether tool execution succeeded")


class ToolCallingEngine:
    """Registry and execution engine for LLM financial tool calls."""

    @staticmethod
    def calculate_sip(monthly_investment: float, rate_pct: float, years: int) -> Dict[str, Any]:
        """Calculates Systematic Investment Plan (SIP) future wealth accumulation."""
        monthly_investment = _non_negative_number(monthly_investment, "monthly_investment")
        rate_pct = _non_negative_number(rate_pct, "rate_pct")
        if monthly_investment <= 0 or rate_pct <= 0:
            raise ValueError("monthly_investment and rate_pct must be positive")
        if isinstance(years, bool) or not isinstance(years, int) or years < 1 or years > 50:
            raise ValueError("years must be an integer from 1 to 50")
        i = (rate_pct / 100.0) / 12.0
        n = years * 12
        future_value = monthly_investment * (((1 + i) ** n - 1) / i) * (1 + i)
        total_invested = monthly_investment * n
        wealth_gained = future_value - total_invested
        return {
            "monthly_investment": monthly_investment,
            "annual_return_pct": rate_pct,
            "duration_years": years,
            "total_invested": round(total_invested, 2),
            "estimated_future_value": round(future_value, 2),
            "wealth_gained": round(wealth_gained, 2),
            "classification": "NON_RECOMMENDATION_WHAT_IF",
            "return_basis": "USER_SUPPLIED_NOMINAL_ASSUMPTION",
        }

    @staticmethod
    def calculate_cagr(initial_value: float, final_value: float, years: float) -> Dict[str, Any]:
        """Calculates Compound Annual Growth Rate (CAGR)."""
        initial_value = _non_negative_number(initial_value, "initial_value")
        final_value = _non_negative_number(final_value, "final_value")
        years = _non_negative_number(years, "years")
        if initial_value <= 0 or final_value <= 0 or years <= 0:
            raise ValueError("initial_value, final_value, and years must be positive")
        cagr = ((final_value / initial_value) ** (1.0 / years) - 1.0) * 100.0
        return {
            "initial_value": initial_value,
            "final_value": final_value,
            "years": years,
            "cagr_percent": round(cagr, 2),
            "classification": "HISTORICAL_RETURN_CALCULATION",
        }

    def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolCallResult:
        """Executes named tool with dictionary arguments."""
        try:
            if tool_name == "calculate_sip":
                res = self.calculate_sip(**arguments)
            elif tool_name == "calculate_cagr":
                res = self.calculate_cagr(**arguments)
            else:
                raise ValueError(f"Unknown tool name: '{tool_name}'")

            return ToolCallResult(tool_name=tool_name, arguments=arguments, result=res, success=True)
        except Exception as e:
            logger.error(f"Tool execution failed for '{tool_name}': {e}")
            return ToolCallResult(
                tool_name=tool_name,
                arguments=arguments,
                result={"error": str(e)},
                success=False,
            )

    def list_tools(self) -> List[Dict[str, Any]]:
        """Returns schemas for registered tools."""
        return [
            {
                "name": "calculate_sip",
                "description": "Non-recommendation SIP projection using explicit user-supplied assumptions",
                "parameters": ["monthly_investment", "rate_pct", "years"],
            },
            {
                "name": "calculate_cagr",
                "description": "Historical-return calculation from explicit values",
                "parameters": ["initial_value", "final_value", "years"],
            },

        ]
