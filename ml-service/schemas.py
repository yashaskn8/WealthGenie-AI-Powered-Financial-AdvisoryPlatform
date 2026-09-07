from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


FEATURE_SCHEMA_VERSION = "recommendation-features-4.0.0"
RISK_LEVELS = {
    "Conservative": 1,
    "Conservative-Moderate": 2,
    "Moderate": 3,
    "Moderate-Aggressive": 4,
    "Aggressive": 5,
}
PREFERENCE_CEILINGS = {"Conservative": 1, "Moderate": 3, "Aggressive": 5}
SUPPORTED_GOALS = {"Retirement", "Wealth Growth", "Tax Saving", "Emergency Fund"}
MODEL_TARGET_CLASSES = {"Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"}


class PredictRequest(BaseModel):
    """Closed ML transport contract produced by the recommendation-profile boundary."""

    model_config = ConfigDict(extra="forbid")

    feature_schema_version: Literal[FEATURE_SCHEMA_VERSION]
    age: int = Field(..., ge=18, le=80)
    monthly_take_home: float = Field(..., gt=0, le=100_000_000)
    monthly_savings: float = Field(..., gt=0, le=100_000_000)
    liquid_savings: float = Field(..., ge=0, le=1_000_000_000)
    emi_burden_pct: float = Field(..., ge=0, le=100)
    financial_dependents: int = Field(..., ge=0, le=15)
    emergency_fund_months: float = Field(..., ge=0, le=120)
    risk_tolerance: Literal["Conservative", "Moderate", "Aggressive"]
    investment_goals: List[Literal["Retirement", "Wealth Growth", "Tax Saving", "Emergency Fund"]] = Field(
        ..., min_length=1
    )
    investment_horizon_years: int = Field(..., ge=1, le=30)
    deployable_lump_sum: float = Field(..., ge=0, le=10_000_000_000)
    risk_capacity_score: int = Field(..., ge=0, le=100)
    final_suitability_risk: Literal[
        "Conservative", "Conservative-Moderate", "Moderate", "Moderate-Aggressive", "Aggressive"
    ]

    @model_validator(mode="after")
    def validate_profile_relationships(self):
        if self.monthly_savings >= self.monthly_take_home:
            raise ValueError("monthly_savings must be less than monthly_take_home")
        if len(set(self.investment_goals)) != len(self.investment_goals):
            raise ValueError("investment_goals must not contain duplicates")
        if not set(self.investment_goals).issubset(SUPPORTED_GOALS):
            raise ValueError("investment_goals contains an unsupported goal")

        capacity_level = min(5, self.risk_capacity_score // 20 + 1)
        expected_final = min(capacity_level, PREFERENCE_CEILINGS[self.risk_tolerance])
        if RISK_LEVELS[self.final_suitability_risk] != expected_final:
            raise ValueError("final_suitability_risk is inconsistent with capacity and preference ceiling")
        return self


class FeatureContribution(BaseModel):
    feature: str
    display_name: str
    shap_value: float
    direction: str
    magnitude: float
    raw_value: float


class Explanation(BaseModel):
    predicted_class: str
    confidence: float
    feature_contributions: List[FeatureContribution]
    top_reason: str


class PredictResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    primary: str
    secondary: str
    tertiary: str
    confidence_scores: Dict[str, float]
    decision_path: List[str]
    feature_schema_version: Literal[FEATURE_SCHEMA_VERSION]
    model_used: Optional[str] = "RandomForest"
    low_confidence: Optional[bool] = False
    confidence_threshold: Optional[float] = 0.55
    model_version: str
    dataset_version: str
    git_commit_hash: Optional[str] = None
    explanation: Optional[Explanation] = None

    @model_validator(mode="after")
    def validate_model_output_contract(self):
        ranked = [self.primary, self.secondary, self.tertiary]
        if len(set(ranked)) != 3 or not set(ranked).issubset(MODEL_TARGET_CLASSES):
            raise ValueError("ranked predictions must be three distinct declared model classes")
        if set(self.confidence_scores) != MODEL_TARGET_CLASSES:
            raise ValueError("confidence_scores must contain exactly the declared model classes")
        values = list(self.confidence_scores.values())
        if any(not 0 <= score <= 1 for score in values):
            raise ValueError("confidence_scores values must be between 0 and 1")
        if abs(sum(values) - 1.0) > 0.01:
            raise ValueError("confidence_scores must sum to 1")
        if not self.model_version.strip() or not self.dataset_version.strip():
            raise ValueError("model and dataset versions must be non-empty")
        return self


class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: str
    model_version: str
    feature_schema_version: Literal[FEATURE_SCHEMA_VERSION]
    model_accuracy: Optional[float] = None
    explainer_loaded: Optional[bool] = None
