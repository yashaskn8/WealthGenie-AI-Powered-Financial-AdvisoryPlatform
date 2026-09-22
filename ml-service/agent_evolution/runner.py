"""Offline/live GEPA run boundary. It accepts sanitized fixtures only."""

import os
import hashlib
from typing import Any

from .gepa_optimizer import DspyGepaOptimizer, GEPA_VERSION, extract_prompt_instructions
from .schemas import validate_gepa_input, validate_optimizer_dataset, validate_proposal_output


def run_gepa(*, optimizer, student, trainset, valset, metric):
    validate_optimizer_dataset(trainset)
    validate_optimizer_dataset(valset)
    return optimizer.optimize(student, trainset, valset, metric)


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
    task_lm = dspy.LM(task_model, api_key=api_key)
    reflection_lm = dspy.LM(reflection_model, api_key=api_key)
    dspy.configure(lm=task_lm)
    return dspy, reflection_lm


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
