import { validateA2UIMessage } from '../a2ui/a2uiSchemas.js';

export function buildVerifiableActionApprovalA2UI(mandate) {
  if (!mandate?.mandateId || mandate.action !== 'APPROVE_RECOMPUTE') throw new TypeError('A valid recompute mandate is required.');
  const message = {
    version: 'a2ui-inspired-internal-1.0.0',
    surface: 'plan-review',
    components: [{
      id: 'a2ui_verifiable_recompute',
      type: 'verifiable_action_approval',
      intent: 'verifiable_action_approval',
      state: mandate.status,
      label: 'Approve securely',
      text: 'Recompute the current financial plan using the exact reviewed snapshot.',
      mandateId: mandate.mandateId,
      expiresAt: mandate.expiresAt,
      snapshotPrefix: `${mandate.financialSnapshotHash.slice(0, 6)}…${mandate.financialSnapshotHash.slice(-4)}`,
      approvalMethod: mandate.approvalMethod,
      action: { action: 'APPROVE_RECOMPUTE', mandateId: mandate.mandateId, requiresStepUp: true, mutationPerformed: false },
    }],
  };
  validateA2UIMessage(message);
  return message;
}
