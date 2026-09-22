"""GEPA feedback adapter. Feedback is structured, bounded, and privacy checked."""

from dataclasses import dataclass
import hashlib
import re


@dataclass(frozen=True)
class GepaFeedback:
    score: float
    feedback: str
    objective_scores: dict[str, float]

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.feedback.encode('utf-8')).hexdigest()


def build_feedback(*, candidate_id: str, score: float, objectives: dict[str, float], failures: list[str]) -> GepaFeedback:
    text = '\n'.join([
        f'Candidate: {candidate_id[:120]}',
        f'Result: {score:.3f}',
        'Feedback:',
        *[f'- {name}: {float(value):.3f}' for name, value in sorted(objectives.items())],
        *[f'- failure: {str(failure)[:300]}' for failure in failures[:12]],
    ])
    if re.search(r'email|phone|income|jwt|password|monthlyTakeHome|userId', text, re.I):
        raise ValueError('GEPA feedback contains private data')
    return GepaFeedback(score=float(score), feedback=text[:6000], objective_scores=dict(objectives))
