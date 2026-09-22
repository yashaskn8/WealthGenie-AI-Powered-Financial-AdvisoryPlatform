import React, { useEffect, useState } from 'react';
import api from '../../services/api';

export function AuthorizedActionsPanel() {
  const [mandates, setMandates] = useState([]);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState(null);
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listAuthorizedMandates().then(result => {
      if (!cancelled) setMandates(result?.mandates || []);
    }).catch(() => {
      if (!cancelled) setError('Authorized action history is temporarily unavailable.');
    });
    return () => { cancelled = true; };
  }, []);

  async function verifyReceipt(receiptId) {
    setReceiptError(null);
    try {
      const result = await api.verifyExecutionReceipt(receiptId);
      setVerification(result);
      setReceipt(result);
    } catch {
      setReceiptError('Receipt verification is temporarily unavailable.');
    }
  }

  return (
    <section aria-labelledby="authorized-actions-title">
      <h2 id="authorized-actions-title">Authorized actions</h2>
      <p>Read-only record of agent proposals, step-up approvals, and execution receipts.</p>
      {error ? <p role="alert">{error}</p> : null}
      {!error && mandates.length === 0 ? <p>No agent actions have been authorized.</p> : null}
      <div>
        {mandates.map(mandate => (
          <article key={mandate.mandateId}>
            <strong>{mandate.action === 'APPROVE_RECOMPUTE' ? 'Recompute current financial plan' : mandate.action}</strong>
            <span>{mandate.agentType === 'PLAN_REVIEW' ? 'Plan Review Agent' : mandate.agentType}</span>
            <span>{mandate.approvalMethod === 'WEBAUTHN' ? 'Passkey verified' : 'Development approval'}</span>
            <span>{mandate.status}</span>
            <time dateTime={mandate.expiresAt}>Valid until {mandate.expiresAt ? new Date(mandate.expiresAt).toLocaleString('en-IN') : 'unavailable'}</time>
            {mandate.receiptId ? <button type="button" onClick={() => verifyReceipt(mandate.receiptId)}>Verify receipt</button> : null}
          </article>
        ))}
      </div>
      {receiptError ? <p role="alert">{receiptError}</p> : null}
      {receipt ? <p role="status">Receipt {receipt.receiptId} {verification?.verified ? 'verified by the server.' : 'could not be verified.'}</p> : null}
    </section>
  );
}

export default AuthorizedActionsPanel;
