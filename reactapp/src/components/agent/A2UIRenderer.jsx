import React from 'react';

const SUPPORTED_TYPES = new Set(['status', 'finding', 'evidence', 'action_descriptor', 'verifiable_action_approval']);

export function A2UIRenderer({ message, onAction }) {
  if (!message || message.version !== 'a2ui-inspired-internal-1.0.0' || message.surface !== 'plan-review') return null;
  return (
    <section aria-label="Plan review details" data-a2ui-surface="plan-review">
      {(message.components || []).filter(component => SUPPORTED_TYPES.has(component.type)).map(component => (
        <article key={component.id} data-a2ui-type={component.type}>
          <span>{component.label}</span>
          {component.text ? <p>{component.text}</p> : null}
          {component.type === 'verifiable_action_approval' ? (
            <small>Passkey required · Snapshot {component.snapshotPrefix || 'unavailable'} · Valid until {component.expiresAt ? new Date(component.expiresAt).toLocaleTimeString('en-IN') : 'unavailable'}</small>
          ) : null}
          {component.action ? (
            <button type="button" onClick={() => onAction?.(component.action.action)}>
              {component.label}
            </button>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export default A2UIRenderer;
