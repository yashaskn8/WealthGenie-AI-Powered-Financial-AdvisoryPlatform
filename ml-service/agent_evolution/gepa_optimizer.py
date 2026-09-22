"""Real DSPy GEPA adapter; imports are lazy so default CI remains deterministic/offline."""

from dataclasses import dataclass
from typing import Any, Callable

GEPA_VERSION = 'dspy-3.3.1-gepa-0.1.4'


@dataclass(frozen=True)
class DspyGepaOptimizer:
    max_metric_calls: int = 12
    reflection_lm: Any = None
    seed: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.max_metric_calls, int) or self.max_metric_calls < 0 or self.max_metric_calls > 12:
            raise ValueError('max_metric_calls exceeds the immutable GEPA maximum')

    def optimize(self, student: Any, trainset: list[Any], valset: list[Any], metric: Callable[..., Any]) -> Any:
        try:
            import dspy
        except ImportError as exc:  # pragma: no cover - live workflow only
            error = RuntimeError('DSPy 3.3.1 is required for live GEPA optimization')
            error.code = 'GEPA_UNAVAILABLE'
            raise error from exc
        optimizer = dspy.GEPA(
            metric=metric,
            max_metric_calls=self.max_metric_calls,
            reflection_lm=self.reflection_lm,
            candidate_selection_strategy='pareto',
            track_stats=True,
            seed=self.seed,
        )
        return optimizer.compile(student, trainset=trainset, valset=valset)


def extract_prompt_instructions(compiled_program: Any) -> dict[str, str]:
    """Extract only predictor instructions; never extracts source code or private state."""
    result: dict[str, str] = {}
    for name, predictor in getattr(compiled_program, 'named_predictors', lambda: [])():
        instruction = getattr(getattr(predictor, 'signature', None), 'instructions', None)
        if isinstance(instruction, str) and instruction:
            result[str(name)] = instruction[:12000]
    return result
