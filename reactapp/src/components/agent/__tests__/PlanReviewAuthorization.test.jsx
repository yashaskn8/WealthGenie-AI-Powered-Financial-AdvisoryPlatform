import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '../../../services/api';
import PlanReviewAuthorization from '../PlanReviewAuthorization';

vi.mock('../../../services/api', () => ({
  default: {
    actOnPlanReview: vi.fn(),
    getMandateApprovalOptions: vi.fn(),
    verifyMandateApproval: vi.fn(),
    getAuthorizedMandate: vi.fn(),
    executeAuthorizedMandate: vi.fn(),
    revokeAuthorizedMandate: vi.fn(),
    getPasskeyRegistrationOptions: vi.fn(),
    verifyPasskeyRegistration: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mandate = {
  mandateId: '4f4f4f4f-1111-4111-8111-111111111111',
  mandateHash: 'a'.repeat(64),
  financialSnapshotHash: 'b'.repeat(64),
  action: 'APPROVE_RECOMPUTE',
  approvalMethod: 'WEBAUTHN',
  status: 'DRAFT',
  expiresAt: '2026-09-25T10:00:00.000Z',
};

function assertionCredential() {
  const bytes = value => Uint8Array.from(value, character => character.charCodeAt(0)).buffer;
  return {
    id: 'AQID', rawId: bytes('\u0001\u0002\u0003'), type: 'public-key', authenticatorAttachment: 'platform',
    response: {
      authenticatorData: bytes('\u0004'), clientDataJSON: bytes('\u0005'), signature: bytes('\u0006'), userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}

describe('PlanReviewAuthorization', () => {
  it('requires a verified passkey before explicit execution and reconciles the response', async () => {
    const response = { response_state: 'CURRENT', recommendationId: 'rec-2' };
    const onExecutionComplete = vi.fn();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: vi.fn().mockResolvedValue(assertionCredential()), create: vi.fn() },
    });
    api.actOnPlanReview.mockResolvedValue({ authorization: { enabled: true }, mandate });
    api.getMandateApprovalOptions.mockResolvedValue({
      provider: 'WEBAUTHN',
      options: { challenge: 'AQID', allowCredentials: [], userVerification: 'required' },
    });
    api.verifyMandateApproval.mockResolvedValue({ status: 'AUTHORIZED' });
    api.getAuthorizedMandate.mockResolvedValue({ ...mandate, status: 'AUTHORIZED' });
    api.executeAuthorizedMandate.mockResolvedValue({ receipt: { receiptId: 'receipt-1' }, response });

    render(<PlanReviewAuthorization run={{ runId: mandate.mandateId }} onExecutionComplete={onExecutionComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /Request step-up approval/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify with passkey' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Verify with passkey' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute approved recompute' })).toBeInTheDocument());
    expect(api.verifyMandateApproval).toHaveBeenCalledWith(mandate.mandateId, expect.objectContaining({
      method: 'WEBAUTHN', mandateHash: mandate.mandateHash, credentialId: 'AQID',
      response: expect.objectContaining({ type: 'public-key', rawId: 'AQID' }),
    }));
    expect(api.executeAuthorizedMandate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Execute approved recompute' }));
    await waitFor(() => expect(api.executeAuthorizedMandate).toHaveBeenCalledWith(mandate.mandateId));
    expect(onExecutionComplete).toHaveBeenCalledWith(response);
    expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  });

  it('does not execute when the user cancels or the passkey ceremony fails', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' })), create: vi.fn() },
    });
    api.actOnPlanReview.mockResolvedValue({ authorization: { enabled: true }, mandate });
    api.getMandateApprovalOptions.mockResolvedValue({
      provider: 'WEBAUTHN', options: { challenge: 'AQID', allowCredentials: [], userVerification: 'required' },
    });

    render(<PlanReviewAuthorization run={{ runId: mandate.mandateId }} />);
    fireEvent.click(screen.getByRole('button', { name: /Request step-up approval/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verify with passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled or timed out/i);
    expect(api.verifyMandateApproval).not.toHaveBeenCalled();
    expect(api.executeAuthorizedMandate).not.toHaveBeenCalled();
  });
});
