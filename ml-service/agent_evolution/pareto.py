"""Deterministic Pareto selection used by the host-side registry and GEPA reports."""


def dominates(left: dict, right: dict, objectives: tuple[str, ...]) -> bool:
    if left.get('hard_gate_passed') is not True or right.get('hard_gate_passed') is not True:
        return False
    values = [(float(left.get(key)), float(right.get(key))) for key in objectives]
    return all(a >= b for a, b in values) and any(a > b for a, b in values)


def pareto_frontier(candidates: list[dict], objectives: tuple[str, ...] = ('correctness', 'grounding', 'reliability')) -> list[dict]:
    return [
        candidate for candidate in candidates
        if not any(other is not candidate and dominates(other, candidate, objectives) for other in candidates)
    ]
