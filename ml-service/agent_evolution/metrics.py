"""Multi-objective metric helpers for DSPy GEPA."""

from .feedback import GepaFeedback


def to_dspy_metric_result(feedback: GepaFeedback):
    try:
        import dspy
    except ImportError as exc:  # pragma: no cover - exercised only in live mode
        raise RuntimeError('DSPy GEPA is not installed; live optimization is unavailable') from exc
    return dspy.Prediction(
        score=feedback.score,
        feedback=feedback.feedback,
        objective_scores=feedback.objective_scores,
    )
