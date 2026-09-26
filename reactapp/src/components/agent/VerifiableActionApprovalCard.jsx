import React from 'react';

export function VerifiableActionApprovalCard({
  mandate, onApprove, onReject, onExecute, onEnroll, busy = false,
  needsEnrollment = false, statusMessage = null, errorMessage = null, receiptId = null,
}) {
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
        <div><dt>Status</dt><dd>{mandate.status}</dd></div>
      </dl>
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {receiptId ? <p role="status">Execution receipt: <code>{receiptId}</code></p> : null}
      <div>
        {mandate.status === 'DRAFT' || mandate.status === 'PENDING_USER_VERIFICATION' ? (
          <>
            <button type="button" onClick={() => onApprove?.(mandate)} disabled={busy}>
              {busy ? 'Waiting for passkey…' : mandate.approvalMethod === 'WEBAUTHN' ? 'Verify with passkey' : 'Approve (development only)'}
            </button>
            {needsEnrollment && mandate.approvalMethod === 'WEBAUTHN' ? (
              <button type="button" onClick={() => onEnroll?.()} disabled={busy}>Enroll a passkey</button>
            ) : null}
            <button type="button" onClick={() => onReject?.(mandate)} disabled={busy}>Reject</button>
          </>
        ) : null}
        {mandate.status === 'AUTHORIZED' ? (
          <button type="button" onClick={() => onExecute?.(mandate)} disabled={busy}>
            {busy ? 'Executing…' : 'Execute approved recompute'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default VerifiableActionApprovalCard;
