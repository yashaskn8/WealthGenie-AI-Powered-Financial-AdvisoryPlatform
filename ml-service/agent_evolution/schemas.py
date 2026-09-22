"""Strict optimizer-side schemas. Holdout and private user data never enter this module."""

from dataclasses import dataclass, field
import re
from typing import Any

HARD_BUDGETS = {
    'max_generations': 3,
    'max_candidates': 12,
    'max_reflection_calls': 12,
    'max_metric_calls': 1000,
    'max_sandbox_runs': 20,
    'max_sandbox_minutes': 60,
    'max_total_tokens': 15000,
}

PRIVATE_KEYS = frozenset({
    'email', 'phone', 'userId', 'user_id', 'income', 'monthlyTakeHome',
    'bankAccount', 'password', 'jwt', 'token', 'rawProfile', 'profile',
    'holdout', 'answerKey',
})


def _normalized_key(key: Any) -> str:
    return ''.join(character for character in str(key) if character.isalnum()).lower()


PRIVATE_KEY_FRAGMENTS = frozenset({
    'email', 'phone', 'income', 'monthlytakehome', 'monthlyincome', 'salary',
    'bankaccount', 'password', 'jwt', 'token', 'rawprofile', 'profile',
    'userid', 'holdout', 'answerkey', 'secret', 'privatekey',
})

ALLOWED_EVOLUTION_SURFACES = frozenset({
    'promptBundle.plannerInstruction',
    'promptBundle.synthesisInstruction',
    'evidenceOrderingPolicy',
    'contextCompressionPolicy',
    'safeModelRoleRouting',
})
GEPA_INPUT_KEYS = frozenset({
    'schemaVersion', 'basePromptBundle', 'allowedMutationSurfaces',
    'trainCases', 'validationCases', 'failureFeedback', 'budget', 'optimizer',
})
GEPA_PROPOSAL_KEYS = frozenset({
    'proposalId', 'parentPromptBundleHash', 'mutationSurface', 'mutationReason',
    'plannerInstruction', 'synthesisInstruction', 'evidenceOrderingPolicy',
    'contextCompressionPolicy', 'safeModelRoleRouting', 'reflectionMetadata',
    'optimizerVersion',
})
FORBIDDEN_ARTIFACT_KEYS = re.compile(
    r'^(?:sourceCode|shellCommand|evaluator|holdout|promotionPolicy|'
    r'reliabilityHardGate|financialEngine|taxRules|allocation|authorization|'
    r'deployment|sandboxPolicy|script|executable|code)$', re.I,
)


@dataclass(frozen=True)
class EvolutionBudget:
    max_generations: int = 3
    max_candidates: int = 12
    max_reflection_calls: int = 12
    max_metric_calls: int = 1000
    max_sandbox_runs: int = 20
    max_sandbox_minutes: int = 60
    max_total_tokens: int = 15000

    def __post_init__(self) -> None:
        for name, maximum in HARD_BUDGETS.items():
            value = getattr(self, name)
            if not isinstance(value, int) or value < 0 or value > maximum:
                raise ValueError(f'{name} exceeds its immutable hard maximum')


@dataclass(frozen=True)
class SanitizedTrajectory:
    trajectory_id: str
    events: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    failure_codes: tuple[str, ...] = field(default_factory=tuple)
    feedback: str = ''


def _assert_private_free(value: Any, path: str = 'root') -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = _normalized_key(key)
            if str(key) in PRIVATE_KEYS or normalized in PRIVATE_KEY_FRAGMENTS:
                raise ValueError(f'private or sealed field rejected at {path}.{key}')
            _assert_private_free(child, f'{path}.{key}')
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_private_free(child, f'{path}[{index}]')


def validate_optimizer_dataset(dataset: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(dataset, list):
        raise TypeError('optimizer dataset must be a list')
    _assert_private_free(dataset)
    if any(item.get('partition') == 'holdout' for item in dataset):
        raise ValueError('holdout rows are sealed from GEPA')
    return dataset


def _assert_keys(value: dict[str, Any], allowed: frozenset[str], label: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f'{label} contains unknown fields: {sorted(unknown)}')


def _assert_prompt_text(value: Any, label: str, maximum: int = 12000) -> None:
    if not isinstance(value, str) or not value or len(value) > maximum or '\x00' in value:
        raise ValueError(f'{label} is not a bounded UTF-8 prompt string')
    if re.search(r'(?:sk-|AIza|Bearer\s+[A-Za-z0-9._-]+|BEGIN\s+(?:RSA|EC|OPENSSH)\s+PRIVATE KEY)', value, re.I):
        raise ValueError(f'{label} appears to contain a credential')


def validate_gepa_input(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TypeError('GEPA bridge input must be an object')
    _assert_keys(data, GEPA_INPUT_KEYS, 'GEPA input')
    if data.get('schemaVersion') != 'gepa-bridge-input-1.0.0':
        raise ValueError('unsupported GEPA bridge input schema')
    _assert_private_free(data)
    bundle = data.get('basePromptBundle')
    if not isinstance(bundle, dict):
        raise ValueError('basePromptBundle is required')
    _assert_keys(bundle, frozenset({'bundleId', 'version', 'plannerInstruction', 'synthesisInstruction', 'metadata', 'contentHash'}), 'basePromptBundle')
    _assert_prompt_text(bundle.get('plannerInstruction'), 'basePromptBundle.plannerInstruction')
    _assert_prompt_text(bundle.get('synthesisInstruction'), 'basePromptBundle.synthesisInstruction')
    if not re.fullmatch(r'[a-f0-9]{64}', str(bundle.get('contentHash', ''))):
        raise ValueError('basePromptBundle contentHash is invalid')
    surfaces = data.get('allowedMutationSurfaces')
    if not isinstance(surfaces, list) or not surfaces or any(surface not in ALLOWED_EVOLUTION_SURFACES for surface in surfaces):
        raise ValueError('GEPA input contains an unapproved mutation surface')
    validate_optimizer_dataset(data.get('trainCases', []))
    validate_optimizer_dataset(data.get('validationCases', []))
    for item in data.get('trainCases', []) + data.get('validationCases', []):
        if item.get('partition') not in {'train', 'validation'}:
            raise ValueError('holdout cases are sealed from GEPA')
    if not isinstance(data.get('failureFeedback', []), list) or any(not isinstance(item, str) or len(item) > 4000 for item in data['failureFeedback']):
        raise ValueError('failureFeedback must be bounded text')
    budget = data.get('budget')
    if not isinstance(budget, dict):
        raise ValueError('GEPA budget is required')
    EvolutionBudget(**budget)
    optimizer = data.get('optimizer')
    if not isinstance(optimizer, dict):
        raise ValueError('GEPA optimizer configuration is required')
    _assert_keys(optimizer, frozenset({'provider', 'reflectionModel', 'taskModel'}), 'optimizer')
    if optimizer.get('provider') not in {'fixture', 'dspy'}:
        raise ValueError('unsupported GEPA provider')
    for key in ('reflectionModel', 'taskModel'):
        if optimizer.get(key) is not None and (not isinstance(optimizer[key], str) or len(optimizer[key]) > 160):
            raise ValueError(f'optimizer.{key} is invalid')
    return data


def _reject_forbidden_keys(value: Any, path: str = 'proposal') -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_ARTIFACT_KEYS.match(str(key)):
                raise ValueError(f'forbidden GEPA proposal field at {path}.{key}')
            _reject_forbidden_keys(child, f'{path}.{key}')
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_keys(child, f'{path}[{index}]')


def validate_proposal_output(proposals: list[dict[str, Any]], input_data: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(proposals, list):
        raise TypeError('GEPA output must be a proposal list')
    if len(proposals) > int(input_data['budget']['max_candidates']):
        raise ValueError('GEPA output exceeds the candidate budget')
    _assert_private_free(proposals)
    _reject_forbidden_keys(proposals)
    base_hash = input_data['basePromptBundle']['contentHash']
    allowed = set(input_data['allowedMutationSurfaces'])
    for proposal in proposals:
        if not isinstance(proposal, dict):
            raise ValueError('GEPA proposal must be an object')
        _assert_keys(proposal, GEPA_PROPOSAL_KEYS, 'GEPA proposal')
        if proposal.get('parentPromptBundleHash') != base_hash:
            raise ValueError('GEPA proposal parent hash mismatch')
        surfaces = proposal.get('mutationSurface')
        if not isinstance(surfaces, list) or not surfaces or any(surface not in allowed for surface in surfaces):
            raise ValueError('GEPA proposal exceeds its mutation surface')
        for key in ('plannerInstruction', 'synthesisInstruction'):
            if proposal.get(key) is not None:
                _assert_prompt_text(proposal[key], f'proposal.{key}')
        if not isinstance(proposal.get('proposalId'), str) or not proposal['proposalId']:
            raise ValueError('GEPA proposalId is required')
        if not isinstance(proposal.get('mutationReason'), str) or len(proposal['mutationReason']) > 500:
            raise ValueError('GEPA mutationReason is invalid')
    return proposals
