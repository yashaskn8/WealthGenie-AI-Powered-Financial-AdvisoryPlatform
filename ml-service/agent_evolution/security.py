"""Reject prompt/code-evolution requests outside the initial safe surface."""

import re

UNSAFE = (
    re.compile(r'ignore\s+(?:all|any|the)\s+previous', re.I),
    re.compile(r'disable|bypass.*(?:policy|guard|holdout|verifier|approval)', re.I),
    re.compile(r'process\.env|child_process|rm\s+-rf|git\s+(?:push|commit)', re.I),
    re.compile(r'financial\s+(?:engine|authority)|allocation\s+weights|tax\s+rules', re.I),
)


def assert_prompt_candidate_safe(prompt_fields: dict[str, str]) -> None:
    for field, value in prompt_fields.items():
        for pattern in UNSAFE:
            if pattern.search(str(value)):
                raise ValueError(f'unsafe prompt candidate in {field}')


def assert_evolution_surface(surface: str) -> None:
    allowed = {
        'promptBundle.plannerInstruction',
        'promptBundle.synthesisInstruction',
        'evidenceOrderingPolicy',
        'contextCompressionPolicy',
        'safeModelRoleRouting',
    }
    if surface not in allowed:
        raise ValueError(f'forbidden evolution surface: {surface}')
