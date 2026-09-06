"""
WealthGenie SHAP Explainability Layer
Uses TreeExplainer for fast, exact SHAP values on RandomForest/GradientBoosting.
"""

import numpy as np
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_DISPLAY

class ModelExplainer:
    """Wraps the trained pipeline with SHAP TreeExplainer."""

    def __init__(self, pipeline, label_encoder):
        self.pipeline = pipeline
        self.label_encoder = label_encoder

        # Extract steps
        self.rf_model = pipeline.named_steps['clf']
        self.scaler = pipeline.named_steps['scaler']
        self.class_names = label_encoder.classes_

        try:
            import shap
            self.explainer = shap.TreeExplainer(self.rf_model)
            self._shap_available = True
            print("[OK] SHAP TreeExplainer initialized successfully")
        except ImportError:
            print("[WARN] shap library not installed, using fallback explainers")
            self._shap_available = False
            self.explainer = None
        except Exception as e:
            print(f"[WARN] SHAP TreeExplainer init failed ({e}), using fallback")
            self._shap_available = False
            self.explainer = None

    def explain(self, raw_features):
        """
        Generate human-readable explanation for a prediction.
        raw_features: numpy array of shape (1, 19)
        """
        scaled = self.scaler.transform(raw_features)

        # Get probabilities
        proba = self.rf_model.predict_proba(scaled)[0]
        pred_class_idx = int(np.argmax(proba))
        predicted_class = self.class_names[pred_class_idx]
        confidence = round(float(proba[pred_class_idx]), 4)

        if self._shap_available and self.explainer is not None:
            try:
                contributions = self._shap_explain(scaled, pred_class_idx, raw_features)
            except Exception as e:
                print(f"[WARN] SHAP explain failed ({e}), falling back to heuristic")
                contributions = self._fallback_explain(raw_features)
        else:
            contributions = self._fallback_explain(raw_features)

        # Sort by magnitude descending
        contributions.sort(key=lambda x: x['magnitude'], reverse=True)

        top = contributions[0]
        top_reason = (
            f"Your {FEATURE_DISPLAY.get(top['feature'], top['feature'])} "
            f"{top['direction']} the likelihood of "
            f"{predicted_class.replace('_', ' ')} being recommended."
        )

        return {
            'predicted_class': predicted_class,
            'confidence': confidence,
            'feature_contributions': contributions,
            'top_reason': top_reason,
        }

    def _shap_explain(self, scaled_features, pred_class_idx, raw_features):
        """
        Use TreeExplainer for exact contributions.
        Handles list formats (legacy) and single ndarrays (modern).
        """
        if self.explainer is None:
            raise RuntimeError("SHAP explainer is not initialized")

        raw = self.explainer.shap_values(scaled_features)

        if isinstance(raw, list):
            class_shap = raw[pred_class_idx][0]
        elif len(raw.shape) == 3:
            class_shap = raw[0, :, pred_class_idx]
        else:
            class_shap = raw[0]

        contributions = []
        for i, feat_name in enumerate(FEATURE_NAMES):
            val = float(class_shap[i])
            contributions.append({
                'feature': feat_name,
                'display_name': FEATURE_DISPLAY.get(feat_name, feat_name),
                'shap_value': round(val, 4),
                'direction': 'increased' if val > 0 else 'decreased',
                'magnitude': abs(round(val, 4)),
                'raw_value': float(raw_features[0][i]),
            })

        return contributions

    def _fallback_explain(self, raw_features):
        """
        Fallback using feature_importances_ and population mean comparison.
        """
        importances = self.rf_model.feature_importances_

        FEATURE_MEANS = {
            'age': 40.0,
            'monthly_take_home': 100000.0,
            'monthly_savings': 25000.0,
            'investment_horizon_years': 15.0,
            'liquid_savings': 500000.0,
            'emi_burden_pct': 20.0,
            'financial_dependents': 2.0,
            'emergency_fund_months': 6.0,
            'deployable_lump_sum': 0.0,
            'risk_capacity_score': 50.0,
            'risk_tolerance_encoded': 3.0,
            'final_suitability_risk_encoded': 3.0,
            'savings_rate': 0.25,
            'liquidity_months': 5.0,
            'goal_retirement': 0.0,
            'goal_wealth_growth': 1.0,
            'goal_tax_saving': 0.0,
            'goal_emergency_fund': 0.0,
            'emergency_fund_gap_months': 0.0,
        }

        contributions = []
        for i, feat_name in enumerate(FEATURE_NAMES):
            imp = float(importances[i])
            raw_val = float(raw_features[0][i])
            mean_val = FEATURE_MEANS.get(feat_name, 0.0)
            
            # For penalty/risk factors, direction is inverted
            if feat_name in ['emi_burden_pct', 'financial_dependents', 'emergency_fund_gap_months']:
                direction = 'decreased' if raw_val > mean_val else 'increased'
            else:
                direction = 'increased' if raw_val > mean_val else 'decreased'
                
            contributions.append({
                'feature': feat_name,
                'display_name': FEATURE_DISPLAY.get(feat_name, feat_name),
                'shap_value': round(imp, 4),
                'direction': direction,
                'magnitude': abs(round(imp, 4)),
                'raw_value': raw_val,
            })

        return contributions
