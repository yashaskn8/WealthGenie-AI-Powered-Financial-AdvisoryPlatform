export const A2UI_VERSION = 'a2ui-inspired-internal-1.0.0';
const COMPONENT_TYPES = new Set(['status', 'finding', 'evidence', 'action_descriptor', 'verifiable_action_approval']);
const INTENTS = new Set(['plan_review_status', 'plan_review_finding', 'plan_review_evidence', 'plan_review_action', 'verifiable_action_approval']);

function strictKeys(value, allowed, label) {
  const unknown = Object.keys(value || {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

export function validateA2UIMessage(message) {
  strictKeys(message, ['version', 'surface', 'components'], 'A2UI message');
  if (message.version !== A2UI_VERSION || message.surface !== 'plan-review') throw new Error('Unsupported A2UI surface or version.');
  if (!Array.isArray(message.components) || message.components.length > 24) throw new Error('A2UI components must be a bounded array.');
  message.components.forEach(component => {
    strictKeys(component, ['id', 'type', 'intent', 'state', 'label', 'text', 'evidenceIds', 'action', 'mandateId', 'expiresAt', 'snapshotPrefix', 'approvalMethod'], 'A2UI component');
    if (!COMPONENT_TYPES.has(component.type) || !INTENTS.has(component.intent)) throw new Error('Unsupported A2UI component or intent.');
    if (!/^a2ui_[a-z0-9_:-]{1,80}$/.test(component.id)) throw new Error('Invalid A2UI component ID.');
    if (component.evidenceIds && (!Array.isArray(component.evidenceIds) || component.evidenceIds.some(id => !/^E_[A-Z0-9_:-]+$/.test(id)))) {
      throw new Error('A2UI evidence IDs must be evidence references.');
    }
    if (component.action) {
      strictKeys(component.action, ['action', 'mutationPerformed', 'mandateId', 'requiresStepUp'], 'A2UI action');
      if (component.action.mutationPerformed !== false) throw new Error('A2UI actions cannot claim mutation.');
      if (component.action.action !== 'APPROVE_RECOMPUTE' && component.type === 'verifiable_action_approval') throw new Error('Unsupported verifiable action.');
    }
    if (component.type === 'verifiable_action_approval') {
      if (component.intent !== 'verifiable_action_approval' || typeof component.mandateId !== 'string' || component.action?.requiresStepUp !== true) throw new Error('Invalid verifiable approval component.');
    }
  });
  return true;
}

export function buildPlanReviewA2UI(review = null) {
  const components = [{
    id: 'a2ui_status',
    type: 'status',
    intent: 'plan_review_status',
    state: review?.status || 'UNAVAILABLE',
    label: 'Plan review status',
  }];
  for (const [index, finding] of (review?.findings || []).slice(0, 8).entries()) {
    components.push({
      id: `a2ui_finding_${index}`,
      type: 'finding',
      intent: 'plan_review_finding',
      state: finding?.severity || 'INFO',
      label: String(finding?.code || 'PLAN_REVIEW_FINDING').slice(0, 80),
      text: String(finding?.message || '').slice(0, 240),
      evidenceIds: Array.isArray(finding?.evidenceIds) ? finding.evidenceIds.slice(0, 8) : [],
    });
  }
  const action = review?.recommendedAction;
  if (action) components.push({
    id: 'a2ui_action',
    type: 'action_descriptor',
    intent: 'plan_review_action',
    state: action,
    label: 'Available plan review action',
    action: { action, mutationPerformed: false },
  });
  const message = { version: A2UI_VERSION, surface: 'plan-review', components };
  validateA2UIMessage(message);
  return message;
}
