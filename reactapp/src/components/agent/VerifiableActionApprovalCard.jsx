import React from 'react';

export function VerifiableActionApprovalCard({ mandate, onApprove, onReject }) {
  if (!mandate || mandate.action !== 'APPROVE_RECOMPUTE') return null;
  return (
    <article className="agent-approval-card" aria-labelledby="agent-approval-title">
      <p className="agent-approval-kicker">SECURE ACTION REQUEST</p>
      <h3 id="agent-approval-title">Recompute current financial plan</h3>
      <p>Requested by Plan Review Agent. This approval is bound to your current profile snapshot and expires shortly.</p>
      <dl>
        <div><dt>Snapshot</dt><dd>{`${mandate.financialSnapshotHash?.slice(0, 8) || 'unavailable'}…`}</dd></div>
        <div><dt>Valid until</dt><dd>{mandate.expiresAt ? new Date(mandate.expiresAt).toLocaleTimeString('en-IN') : 'unavailable'}</dd></div>
        <div><dt>Requires</dt><dd>{mandate.approvalMethod === 'WEBAUTHN' ? 'Passkey verification' : 'Development approval only'}</dd></div>
      </dl>
      <div>
        <button type="button" onClick={() => onApprove?.(mandate)} disabled={mandate.status !== 'DRAFT' && mandate.status !== 'PENDING_USER_VERIFICATION'}>Approve securely</button>
        <button type="button" onClick={() => onReject?.(mandate)}>Reject</button>
      </div>
    </article>
  );
}

export default VerifiableActionApprovalCard;

