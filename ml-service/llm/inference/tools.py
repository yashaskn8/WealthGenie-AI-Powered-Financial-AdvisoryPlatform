"""
WealthGenie Open-Weight LLM Platform - Financial Tool Calling Engine
Provides built-in financial calculation tools (SIP, CAGR, Tax) with structured execution.
"""

import math
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("wealthgenie.llm.tools")

# ═══════════════════════════════════════════════════════════════════════════
# TAX SLAB DATA — Mirrored from server/services/taxEngine.js L18-L46
# MAINTENANCE: When Union Budget updates slabs, update BOTH this file AND
# server/services/taxEngine.js. Golden vector parity tests in
# tests/test_llm_inference.py will catch any drift immediately.
# ═══════════════════════════════════════════════════════════════════════════
CESS_RATE = 0.04  # 4% Health & Education Cess — FY2025-26

_STANDARD_NEW_SLABS = (
    {"min": 0,       "max": 400_000,       "rate": 0.00},
    {"min": 400_000, "max": 800_000,       "rate": 0.05},
    {"min": 800_000, "max": 1_200_000,     "rate": 0.10},
    {"min": 1_200_000, "max": 1_600_000,   "rate": 0.15},
    {"min": 1_600_000, "max": 2_000_000,   "rate": 0.20},
    {"min": 2_000_000, "max": 2_400_000,   "rate": 0.25},
    {"min": 2_400_000, "max": float("inf"), "rate": 0.30},
)

_STANDARD_OLD_SLABS = (
    {"min": 0,         "max": 250_000,       "rate": 0.00},
    {"min": 250_000,   "max": 500_000,       "rate": 0.05},
    {"min": 500_000,   "max": 1_000_000,     "rate": 0.20},
    {"min": 1_000_000, "max": float("inf"),   "rate": 0.30},
)

TAX_SLABS_BY_FY = {
    "FY2025-26": {"verified": True, "new": _STANDARD_NEW_SLABS, "old": _STANDARD_OLD_SLABS},
    "FY2026-27": {"verified": True, "new": _STANDARD_NEW_SLABS, "old": _STANDARD_OLD_SLABS},
}


def _get_current_fiscal_year() -> str:
    """Dynamically compute India's current fiscal year (April–March)."""
    now = datetime.now()
    start_year = now.year if now.month >= 4 else now.year - 1
    end_year = start_year + 1
    return f"FY{start_year}-{str(end_year)[-2:]}"


CURRENT_FY = _get_current_fiscal_year()


def _get_regime_slabs(regime: str, fiscal_year: str = CURRENT_FY):
    entry = TAX_SLABS_BY_FY.get(fiscal_year)
    if entry is None or entry.get("verified") is not True:
        raise ValueError(f"Tax slabs for {fiscal_year} are not verified")
    return entry["old"] if regime == "old" else entry["new"]


def _first_present(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


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


def _deduction_number(deductions: Dict[str, Any], name: str, *aliases: str) -> float:
    value = _first_present(deductions, name, *aliases)
    return 0.0 if value is None else _non_negative_number(value, name)


def _explicit_boolean(deductions: Dict[str, Any], name: str, *aliases: str) -> Optional[bool]:
    value = _first_present(deductions, name, *aliases)
    if value is None:
        return None
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be an explicit boolean")
    return value


def _calculate_from_slabs(taxable_income: float, slabs) -> float:
    """Calculate tax from slab structure — mirrors taxEngine.js calculateFromSlabs()."""
    tax = 0.0
    for slab in slabs:
        if taxable_income <= slab["min"]:
            break
        taxable_in_slab = min(taxable_income, slab["max"]) - slab["min"]
        tax += taxable_in_slab * slab["rate"]
    return tax


def _calculate_taxable_income(
    annual_income: float,
    regime: str,
    deductions: Optional[Dict[str, Any]] = None,
    income_source: str = "",
) -> Dict[str, Any]:
    """
    Compute allowed deductions and taxable income.
    Mirrors server/services/taxEngine.js calculateTaxableIncome() L145-197.
    """
    annual_income = _non_negative_number(annual_income, "annual_income")
    if regime not in ("new", "old"):
        raise ValueError("regime must be explicitly provided as 'new' or 'old'")
    if income_source not in ("salary", "pension", "family_pension", "business", "other"):
        raise ValueError("income_source must be explicitly provided")
    if deductions is None:
        deductions = {}
    if not isinstance(deductions, dict):
        raise ValueError("deductions must be an object")

    # Standard deduction
    standard_deduction: float = 0.0
    if income_source in ("salary", "pension"):
        standard_deduction = 75_000.0 if regime == "new" else 50_000.0
    elif income_source == "family_pension":
        standard_deduction = min(float(annual_income) / 3.0, 15_000.0)

    # Section 80CCD(2) — Employer NPS Contribution (available under BOTH regimes)
    requested_nps_80ccd2 = _deduction_number(deductions, "nps_80ccd2", "nps80CCD2")
    nps_80ccd2 = 0.0
    if requested_nps_80ccd2 > 0:
        basic_salary_raw = _first_present(deductions, "basic_salary", "basicSalary")
        if basic_salary_raw is None:
            raise ValueError("basic_salary and is_govt_employee are required for an nps_80ccd2 claim")
        basic_salary = _non_negative_number(basic_salary_raw, "basic_salary")
        is_govt_employee = _explicit_boolean(deductions, "is_govt_employee", "isGovtEmployee")
        if is_govt_employee is None:
            raise ValueError("basic_salary and is_govt_employee are required for an nps_80ccd2 claim")
        nps_80ccd2_limit_pct = 0.14 if is_govt_employee else 0.10
        nps_80ccd2 = min(requested_nps_80ccd2, basic_salary * nps_80ccd2_limit_pct)

    # Old-regime-only deductions
    section_80c: float = min(_deduction_number(deductions, "section_80c", "section80C"), 150_000.0)
    nps_80ccd1b: float = min(
        _deduction_number(
            deductions, "nps_80ccd1b", "nps80CCD1B", "section_80ccd", "section80CCD"
        ),
        50_000.0,
    )

    # Section 80D — Granular self vs parents
    section_80d = _deduction_number(deductions, "section_80d", "section80D")
    section_80d_self = _deduction_number(deductions, "section_80d_self", "section80D_self")
    section_80d_parents = _deduction_number(deductions, "section_80d_parents", "section80D_parents")
    savings_interest = _deduction_number(deductions, "savings_interest", "savingsInterest")
    section_80tta = _deduction_number(deductions, "section_80tta", "section80TTA")
    section_80ttb = _deduction_number(deductions, "section_80ttb", "section80TTB")
    age_dependent_facts = section_80d + section_80d_self + section_80d_parents + savings_interest + section_80tta + section_80ttb
    age_raw = deductions.get("age")
    if age_dependent_facts > 0 and age_raw is None:
        raise ValueError("age is required for age-dependent deductions")
    age = 0 if age_raw is None else int(_non_negative_number(age_raw, "age"))
    if age_raw is not None and float(age) != float(age_raw):
        raise ValueError("age must be an integer")
    if age > 120:
        raise ValueError("age must not exceed 120")
    self_senior_fact = _explicit_boolean(deductions, "self_senior")
    parents_senior_fact = _explicit_boolean(deductions, "parents_senior", "parentsSenior")
    if section_80d_parents > 0 and parents_senior_fact is None:
        raise ValueError("parents_senior is required for a parents Section 80D deduction")
    self_senior: bool = age >= 60 or self_senior_fact is True
    parents_senior: bool = parents_senior_fact is True
    max_80d_self: float = 50_000.0 if self_senior else 25_000.0
    max_80d_parents: float = 50_000.0 if parents_senior else 25_000.0

    if "section80D_self" in deductions or "section_80d_self" in deductions or \
       "section80D_parents" in deductions or "section_80d_parents" in deductions:
        allowed_80d_self: float = min(
            section_80d_self, max_80d_self)
        allowed_80d_parents: float = min(
            section_80d_parents, max_80d_parents)
        allowed_80d: float = allowed_80d_self + allowed_80d_parents
    else:
        allowed_80d: float = min(section_80d, 100_000)

    hra: float = _deduction_number(deductions, "hra")
    home_loan_interest: float = min(_deduction_number(deductions, "home_loan_interest", "homeLoanInterest"), 200_000)
    section_80eea: float = min(_deduction_number(deductions, "section_80eea", "section80EEA"), 150_000)
    other_deductions: float = _deduction_number(deductions, "other")

    if savings_interest > 0:
        if age >= 60:
            section_80ttb = max(section_80ttb, savings_interest)
        else:
            section_80tta = max(section_80tta, savings_interest)
    allowed_80tta: float = min(section_80tta, 10_000) if age < 60 else 0.0
    allowed_80ttb: float = min(section_80ttb, 50_000) if age >= 60 else 0.0

    old_regime_deductions = 0.0
    if regime == "old":
        old_regime_deductions = (
            section_80c + nps_80ccd1b + allowed_80d + hra +
            home_loan_interest + section_80eea +
            allowed_80tta + allowed_80ttb + other_deductions
        )

    taxable_income = max(0.0, annual_income - standard_deduction - nps_80ccd2 - old_regime_deductions)
    return {
        "standard_deduction": standard_deduction,
        "old_regime_deductions": old_regime_deductions,
        "taxable_income": taxable_income,
        "nps_80ccd2": nps_80ccd2,
        "allowed_80d": allowed_80d,
    }


def _compute_surcharge(tax_before_surcharge: float, taxable_income: float, regime: str) -> float:
    """Mirrors taxEngine.js computeSurcharge() L78-102."""
    if taxable_income <= 5_000_000:
        return 0.0
    surcharge_rate = 0.0
    if regime == "new":
        if taxable_income <= 10_000_000:
            surcharge_rate = 0.10
        elif taxable_income <= 20_000_000:
            surcharge_rate = 0.15
        else:
            surcharge_rate = 0.25
    else:  # old regime
        if taxable_income <= 10_000_000:
            surcharge_rate = 0.10
        elif taxable_income <= 20_000_000:
            surcharge_rate = 0.15
        elif taxable_income <= 50_000_000:
            surcharge_rate = 0.25
        else:
            surcharge_rate = 0.37
    return tax_before_surcharge * surcharge_rate


def _compute_marginal_relief(
    base_tax: float, surcharge: float, taxable_income: float,
    regime: str, fiscal_year: str = CURRENT_FY,
) -> float:
    """Mirrors taxEngine.js computeMarginalRelief() L106-141."""
    if taxable_income <= 5_000_000:
        return 0.0

    surcharge_thresholds = (
        [5_000_000, 10_000_000, 20_000_000] if regime == "new"
        else [5_000_000, 10_000_000, 20_000_000, 50_000_000]
    )
    threshold = 5_000_000
    for t in surcharge_thresholds:
        if taxable_income > t:
            threshold = t

    slabs = _get_regime_slabs(regime, fiscal_year)
    base_tax_at_threshold = _calculate_from_slabs(threshold, slabs)

    threshold_surcharge_rate = 0.0
    if threshold == 10_000_000:
        threshold_surcharge_rate = 0.10
    elif threshold == 20_000_000:
        threshold_surcharge_rate = 0.15
    elif threshold == 50_000_000 and regime == "old":
        threshold_surcharge_rate = 0.25

    tax_at_threshold = base_tax_at_threshold * (1 + threshold_surcharge_rate)
    total_actual = base_tax + surcharge
    income_gain = taxable_income - threshold
    max_allowed_tax = tax_at_threshold + income_gain
    marginal_relief = total_actual - max_allowed_tax if total_actual > max_allowed_tax else 0.0
    return round(marginal_relief)


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

    @staticmethod
    def calculate_tax_rebate(
        taxable_income: Optional[float] = None,
        regime: Optional[str] = None,
        annual_income: Optional[float] = None,
        deductions: Optional[Dict[str, Any]] = None,
        income_source: Optional[str] = None,
        fiscal_year: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Compute full Indian income tax liability with Section 87A rebate,
        surcharge, marginal relief, and 4% Health & Education cess.

        Mirrors server/services/taxEngine.js computeTax() exactly.

        Parameters:
        - taxable_income: Pre-computed net taxable income (used directly if
          annual_income is not provided).
        - regime: 'new' or 'old'.
        - annual_income: Gross annual income. If provided, taxable_income is
          computed from this using standard deduction and deductions.
        - deductions: Optional dict of deduction amounts (section_80c, section_80d,
          hra, home_loan_interest, nps_80ccd1b, nps_80ccd2, etc.)
        - income_source: 'salary', 'pension', 'family_pension', or 'other'.
        - fiscal_year: e.g. 'FY2025-26'. Defaults to current FY.
        """
        if regime not in ("new", "old"):
            raise ValueError("regime must be explicitly provided as 'new' or 'old'")
        regime_clean = regime
        fy = fiscal_year or CURRENT_FY
        _get_regime_slabs(regime_clean, fy)

        if (annual_income is None) == (taxable_income is None):
            raise ValueError("provide exactly one of annual_income or taxable_income")

        # Determine taxable income
        safe_annual = 0.0
        standard_deduction = 0.0
        old_regime_deductions = 0.0
        nps_80ccd2_applied = 0.0

        if annual_income is not None:
            # Compute taxable income from gross using canonical deduction logic
            safe_annual = _non_negative_number(annual_income, "annual_income")
            ti_result = _calculate_taxable_income(
                safe_annual, regime_clean, deductions, income_source
            )
            effective_taxable = ti_result["taxable_income"]
            standard_deduction = ti_result["standard_deduction"]
            old_regime_deductions = ti_result["old_regime_deductions"]
            nps_80ccd2_applied = ti_result["nps_80ccd2"]
        else:
            if deductions:
                raise ValueError("deductions cannot be applied to an already-taxable income")
            if income_source is not None:
                raise ValueError("income_source is only valid with annual_income")
            effective_taxable = _non_negative_number(taxable_income, "taxable_income")
            safe_annual = effective_taxable  # For effective rate computation

        slabs = _get_regime_slabs(regime_clean, fy)
        tax_before_cess = _calculate_from_slabs(effective_taxable, slabs)

        # Section 87A Rebate
        rebate_applied = False
        marginal_relief_applied = False
        marginal_relief_amount_87a = 0.0
        rebate_limit = 1_200_000 if regime_clean == "new" else 500_000

        if effective_taxable <= rebate_limit:
            tax_before_cess = 0.0
            rebate_applied = True
        elif regime_clean == "new":
            # Section 87A Proviso (Section 115BAC marginal relief):
            # Tax shall not exceed excess over rebate limit
            excess_over_limit = effective_taxable - rebate_limit
            if tax_before_cess > excess_over_limit:
                marginal_relief_amount_87a = tax_before_cess - excess_over_limit
                tax_before_cess = excess_over_limit
                marginal_relief_applied = True

        # Surcharge
        surcharge = _compute_surcharge(tax_before_cess, effective_taxable, regime_clean)
        relief = _compute_marginal_relief(
            tax_before_cess, surcharge, effective_taxable, regime_clean, fy
        )
        tax_after_surcharge = tax_before_cess + surcharge - relief

        # 4% Health & Education Cess
        cess = tax_after_surcharge * CESS_RATE
        tax_amount = tax_after_surcharge + cess

        effective_rate = 0.0
        if safe_annual and safe_annual > 0:
            effective_rate = round((tax_amount / safe_annual) * 100, 2)

        return {
            "taxable_income": effective_taxable,
            "regime": regime_clean,
            "tax_before_cess": round(tax_before_cess),
            "section_87a_rebate": round(marginal_relief_amount_87a) if marginal_relief_applied else (
                round(_calculate_from_slabs(effective_taxable, slabs)) if rebate_applied else 0
            ),
            "rebate_applied": rebate_applied,
            "marginal_relief_applied": marginal_relief_applied or relief > 0,
            "marginal_relief_amount": round(relief + marginal_relief_amount_87a),
            "surcharge_applied": surcharge > 0,
            "surcharge_amount": round(surcharge),
            "cess": round(cess),
            "net_tax_liability": round(tax_amount),
            "effective_rate": effective_rate,
            "standard_deduction": standard_deduction,
            "old_regime_deductions": old_regime_deductions,
            "nps_80ccd2": nps_80ccd2_applied,
            "fiscal_year": fy,
            "classification": "SEPARATE_TAX_WHAT_IF",
        }

    def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolCallResult:
        """Executes named tool with dictionary arguments."""
        try:
            if tool_name == "calculate_sip":
                res = self.calculate_sip(**arguments)
            elif tool_name == "calculate_cagr":
                res = self.calculate_cagr(**arguments)
            elif tool_name == "calculate_tax_rebate":
                res = self.calculate_tax_rebate(**arguments)
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
            {
                "name": "calculate_tax_rebate",
                "description": (
                    "Computes full Indian income tax liability including Section 87A rebate, "
                    "surcharge with marginal relief, and 4% cess as a separate tax what-if. "
                    "Requires exactly one of taxable_income or annual_income; gross-income "
                    "calculations also require explicit income_source and dependent facts."
                ),
                "parameters": [
                    "taxable_income", "regime", "annual_income",
                    "deductions", "income_source", "fiscal_year",
                ],
            },
        ]
