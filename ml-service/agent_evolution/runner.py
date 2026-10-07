"""Offline/live GEPA run boundary. It accepts sanitized fixtures only."""

import os
import hashlib
import json
import threading
from typing import Any

from .gepa_optimizer import DspyGepaOptimizer, GEPA_VERSION, extract_prompt_instructions
from .schemas import validate_gepa_input, validate_optimizer_dataset, validate_proposal_output


def run_gepa(*, optimizer, student, trainset, valset, metric):
    validate_optimizer_dataset(trainset)
    validate_optimizer_dataset(valset)
    return optimizer.optimize(student, trainset, valset, metric)


def _configure_gepa_cache(dspy) -> None:
    """Keep GEPA response caching in memory only; disk cache uses pickle."""
    configure_cache = getattr(dspy, 'configure_cache', None)
    if not callable(configure_cache):
        error = RuntimeError('DSPy does not expose the required safe cache configuration API')
        error.code = 'GEPA_CACHE_CONFIGURATION_UNAVAILABLE'
        raise error
    try:
        configure_cache(
            enable_disk_cache=False,
            enable_memory_cache=True,
            restrict_pickle=True,
        )
    except Exception as exc:
        error = RuntimeError('DSPy GEPA cache could not be restricted to safe in-memory storage')
        error.code = 'GEPA_CACHE_CONFIGURATION_FAILED'
        raise error from exc


class _GepaTokenBudget:
    """Shared, fail-closed aggregate budget for task and reflection LM calls."""

    prompt_overhead_tokens = 2048
    default_output_tokens = 512

    def __init__(self, max_total_tokens: int, max_task_calls: int, max_reflection_calls: int):
        self.max_total_tokens = max_total_tokens
        self.max_task_calls = max_task_calls
        self.max_reflection_calls = max_reflection_calls
        self.used_tokens = 0
        self.reserved_tokens = 0
        self.task_calls = 0
        self.reflection_calls = 0
        self.lock = threading.Lock()
        self.provider_call_lock = threading.Lock()

    def reserve(self, role: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[int, int]:
        try:
            prompt_bytes = len(json.dumps({'args': args, 'kwargs': kwargs}, default=str, ensure_ascii=False).encode('utf-8'))
        except Exception as exc:
            error = RuntimeError('GEPA prompt size could not be bounded before a model request.')
            error.code = 'GEPA_TOKEN_BUDGET_PROMPT_UNBOUNDED'
            raise error from exc
        with self.lock:
            current_calls = self.task_calls if role == 'task' else self.reflection_calls
            call_limit = self.max_task_calls if role == 'task' else self.max_reflection_calls
            if current_calls >= call_limit:
                error = RuntimeError(f'GEPA {role} model-call budget was exhausted.')
                error.code = 'GEPA_MODEL_CALL_BUDGET_EXCEEDED'
                raise error
            available = self.max_total_tokens - self.used_tokens - self.reserved_tokens
            prompt_bound = prompt_bytes + self.prompt_overhead_tokens
            output_limit = min(self.default_output_tokens, available - prompt_bound)
            if output_limit < 1:
                error = RuntimeError('GEPA aggregate token budget cannot safely cover another bounded model call.')
                error.code = 'GEPA_TOKEN_BUDGET_EXCEEDED'
                raise error
            reservation = prompt_bound + output_limit
            self.reserved_tokens += reservation
            if role == 'task':
                self.task_calls += 1
            else:
                self.reflection_calls += 1
            return reservation, output_limit

    def settle(self, reservation: int, actual_tokens: int | None) -> None:
        with self.lock:
            self.reserved_tokens -= reservation
            self.used_tokens += reservation if actual_tokens is None else actual_tokens
            if actual_tokens is None:
                error = RuntimeError('GEPA provider did not return token usage; the reserved budget was charged and optimization stopped.')
                error.code = 'GEPA_TOKEN_USAGE_UNAVAILABLE'
                raise error
            if actual_tokens > reservation or self.used_tokens > self.max_total_tokens:
                error = RuntimeError('GEPA provider usage exceeded its reserved aggregate token budget.')
                error.code = 'GEPA_TOKEN_BUDGET_EXCEEDED'
                raise error


def _usage_token_count(history: list[Any]) -> int | None:
    total = 0
    for entry in history:
        usage = entry.get('usage') if isinstance(entry, dict) else None
        if usage is None:
            return None
        if isinstance(usage, dict):
            count = usage.get('total_tokens')
            if count is None:
                prompt = usage.get('prompt_tokens')
                completion = usage.get('completion_tokens')
                count = prompt + completion if isinstance(prompt, int) and isinstance(completion, int) else None
        else:
            count = getattr(usage, 'total_tokens', None)
            if count is None:
                prompt = getattr(usage, 'prompt_tokens', None)
                completion = getattr(usage, 'completion_tokens', None)
                count = prompt + completion if isinstance(prompt, int) and isinstance(completion, int) else None
        if not isinstance(count, int) or count < 0:
            return None
        total += count
    return total if history else None


class _BudgetedDspyLM:
    """DSPy LM proxy that reserves aggregate tokens before each provider call."""

    def __init__(self, lm: Any, budget: _GepaTokenBudget, role: str):
        self.wrapped_lm = lm
        self.budget = budget
        self.role = role

    def __getattr__(self, name: str) -> Any:
        return getattr(self.wrapped_lm, name)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        reservation, output_limit = self.budget.reserve(self.role, args, kwargs)
        kwargs['max_tokens'] = min(int(kwargs.get('max_tokens') or output_limit), output_limit)
        with self.budget.provider_call_lock:
            history = getattr(self.wrapped_lm, 'history', None)
            start = len(history) if isinstance(history, list) else 0
            try:
                result = self.wrapped_lm(*args, **kwargs)
            except Exception:
                self.budget.settle(reservation, reservation)
                raise
            new_history = history[start:] if isinstance(history, list) else []
            actual_tokens = _usage_token_count(new_history)
            self.budget.settle(reservation, actual_tokens)
            return result

    def copy(self, **overrides: Any) -> '_BudgetedDspyLM':
        copy = getattr(self.wrapped_lm, 'copy', None)
        return _BudgetedDspyLM(copy(**overrides) if callable(copy) else self.wrapped_lm, self.budget, self.role)


class FixtureGepaProposalProvider:
    """Deterministic contract provider used by tests and offline CI only."""

    def propose(self, document: dict[str, Any]) -> list[dict[str, Any]]:
        validate_gepa_input(document)
        base = document['basePromptBundle']
        return [{
            'proposalId': 'fixture-gepa-proposal-1',
            'parentPromptBundleHash': base['contentHash'],
            'mutationSurface': ['promptBundle.plannerInstruction'],
            'mutationReason': 'fixture deterministic proposal for contract validation',
            'plannerInstruction': 'Prefer the minimum safe read-only check set and preserve evidence limitations.',
            'reflectionMetadata': {'provider': 'fixture', 'liveExecuted': False},
            'optimizerVersion': 'fixture-gepa-contract-1.0.0',
        }]


def _load_live_dspy(document: dict[str, Any]):
    try:
        import dspy
    except ImportError as exc:  # pragma: no cover - live environment only
        error = RuntimeError('DSPy 3.3.1 is required for the live GEPA provider')
        error.code = 'GEPA_UNAVAILABLE'
        raise error from exc
    optimizer_config = document['optimizer']
    task_model = optimizer_config.get('taskModel') or os.environ.get('AGENT_EVOLUTION_TASK_MODEL') or os.environ.get('DSPY_LM_MODEL')
    reflection_model = optimizer_config.get('reflectionModel') or os.environ.get('AGENT_EVOLUTION_REFLECTION_MODEL') or task_model
    api_key = os.environ.get('AGENT_EVOLUTION_MODEL_API_KEY') or os.environ.get('DSPY_LM_API_KEY')
    if not task_model or not reflection_model or not api_key:
        error = RuntimeError('Live GEPA requires task/reflection model identifiers and AGENT_EVOLUTION_MODEL_API_KEY or DSPY_LM_API_KEY.')
        error.code = 'LIVE_GEPA_CREDENTIAL_REQUIRED'
        raise error
    _configure_gepa_cache(dspy)
    configured_budget = document.get('budget', {})
    total_token_budget = int(configured_budget.get('max_total_tokens', 15000))
    token_budget = _GepaTokenBudget(
        max_total_tokens=total_token_budget,
        max_task_calls=int(configured_budget.get('max_metric_calls', 12)),
        max_reflection_calls=int(configured_budget.get('max_reflection_calls', 12)),
    )
    task_lm = dspy.LM(task_model, api_key=api_key, cache=False, max_tokens=512)
    reflection_lm = dspy.LM(reflection_model, api_key=api_key, cache=False, max_tokens=512)
    dspy.configure(lm=_BudgetedDspyLM(task_lm, token_budget, 'task'))
    return dspy, _BudgetedDspyLM(reflection_lm, token_budget, 'reflection')


def build_proposal_from_compiled(*, compiled_program: Any, base_prompt_bundle: dict[str, Any], reflection_model: str | None, feedback_hash: str | None = None) -> dict[str, Any]:
    instructions = extract_prompt_instructions(compiled_program)
    instruction = instructions.get('planner') or next(iter(instructions.values()), None)
    if not instruction:
        raise RuntimeError('GEPA compiled program did not expose a bounded prompt instruction')
    return {
        'proposalId': 'dspy-gepa-proposal-1',
        'parentPromptBundleHash': base_prompt_bundle['contentHash'],
        'mutationSurface': ['promptBundle.plannerInstruction'],
        'mutationReason': 'DSPy GEPA reflection produced a planner instruction candidate',
        'plannerInstruction': instruction[:12000],
        'reflectionMetadata': {
            'provider': 'dspy',
            'liveExecuted': True,
            'reflectionModel': reflection_model or 'configured',
            'feedbackHash': feedback_hash,
        },
        'optimizerVersion': GEPA_VERSION,
    }


class DspyGepaProposalProvider:
    def propose(self, document: dict[str, Any]) -> list[dict[str, Any]]:
        validate_gepa_input(document)
        dspy, reflection_lm = _load_live_dspy(document)

        class PromptStudent(dspy.Module):
            def __init__(self):
                super().__init__()
                self.planner = dspy.Predict('question -> answer')

            def forward(self, question):
                return self.planner(question=question)

        def make_example(item: dict[str, Any]):
            question = item.get('question') or item.get('safeSummary') or 'Produce a bounded read-only plan review routing decision.'
            return dspy.Example(question=question, answer=item.get('expectedAction') or 'bounded').with_inputs('question')

        trainset = [make_example(item) for item in document['trainCases']]
        valset = [make_example(item) for item in document['validationCases']]
        if not trainset or not valset:
            raise ValueError('Live GEPA requires sanitized train and validation cases')

        feedback_context = '\n'.join(document.get('failureFeedback', [])[:12])[:4000]

        def metric(example, prediction, trace=None):
            answer = str(getattr(prediction, 'answer', '')).strip()
            expected = str(getattr(example, 'answer', '')).strip()
            score = 1.0 if answer and expected and answer == expected else 0.0
            outcome_feedback = 'bounded answer matched the sanitized expected action' if score else 'candidate answer did not match the sanitized expected action'
            feedback = f'{outcome_feedback}. Structured failure-corpus feedback:\n{feedback_context}'[:4000]
            return dspy.Prediction(score=score, feedback=feedback)

        optimizer = DspyGepaOptimizer(
            max_metric_calls=document['budget']['max_metric_calls'],
            max_total_tokens=document['budget']['max_total_tokens'],
            max_reflection_calls=document['budget']['max_reflection_calls'],
            reflection_lm=reflection_lm,
            seed=0,
        )
        compiled = optimizer.optimize(PromptStudent(), trainset, valset, metric)
        return [build_proposal_from_compiled(
            compiled_program=compiled,
            base_prompt_bundle=document['basePromptBundle'],
            reflection_model=document['optimizer'].get('reflectionModel'),
            feedback_hash=hashlib.sha256(feedback_context.encode('utf-8')).hexdigest(),
        )]


def create_proposal_provider(provider: str):
    if provider == 'fixture':
        return FixtureGepaProposalProvider()
    if provider == 'dspy':
        return DspyGepaProposalProvider()
    raise ValueError('unsupported GEPA provider')
