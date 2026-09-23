/**
 * WealthGenie — GenieChat Helper Utilities & Hooks
 * ────────────────────────────────────────────────
 * Extracted from GenieChat.jsx for maintainability.
 */
import { useState, useEffect } from 'react';

// Set of messages that have already completed streaming/typewriter effect
export const streamedMessages = new WeakSet();

// Presentation-only helpers retained from the immutable main-branch chat UI.
export function formatFullINR(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(number);
}

export function getSuggestedQuestions() {
  return [
    'Explain portfolio balancing in simple terms',
    'How do I start my first investment?',
    'Which tax regime is best for a beginner?',
    'How does compound growth build wealth?',
  ];
}

export function generateContextualPills(lastQuestion) {
  if (!lastQuestion) return [];
  const question = lastQuestion.toLowerCase();
  if (question.includes('rebalance') || question.includes('allocation')) return ['Show ideal asset allocation', 'Explain portfolio risk', 'Compare balanced options'];
  if (question.includes('tax')) return ['Which regime saves more?', 'Eligible deduction breakdown', 'Post-tax return'];
  if (question.includes('sip') || question.includes('invest') || question.includes('step')) return ['Show a SIP projection', 'Explain yearly step-up', 'Review my savings capacity'];
  if (question.includes('retire') || question.includes('goal')) return ['Am I on track?', 'Review my goal horizon', 'Explain goal funding'];
  if (question.includes('crash') || question.includes('market')) return ['Explain crash risk', 'How does diversification help?', 'Review portfolio risk'];
  return ['Review my portfolio', 'Explain tax assumptions'];
}

// ── Parse ACTION_CARD blocks from AI response ─────────────────────
export function parseActionCards(text) {
  const cards = [];
  const regex = /<<<ACTION_CARD>>>\s*([\s\S]*?)\s*<<<END_ACTION_CARD>>>/g;
  let match;
  let cleanText = text;
  while ((match = regex.exec(text)) !== null) {
    try {
      let jsonStr = match[1].replace(/^```json?\s*/gm, '').replace(/^```\s*$/gm, '').trim();
      jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
      jsonStr = jsonStr.replace(/,[ \t\r\n]*([}\]])/g, '$1');
      const card = JSON.parse(jsonStr);
      cards.push(card);
      cleanText = cleanText.replace(match[0], '');
    } catch (e) {
      console.warn('[GenieChat] Failed to parse action card:', e.message);
    }
  }
  return { cleanText: cleanText.trim(), cards };
}

// ── Streamed Typing Effect ────────────────────────────────────────
export function useStreamedText(text, speed = 8) {
  const [prevText, setPrevText] = useState(text);
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  if (text !== prevText) {
    setPrevText(text);
    setDisplayed('');
    setDone(false);
  }

  useEffect(() => {
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      if (i >= text.length) { setDisplayed(text); setDone(true); clearInterval(id); }
      else setDisplayed(text.slice(0, i));
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { displayed, done };
}
