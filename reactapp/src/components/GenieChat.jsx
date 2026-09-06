import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Send, Trash2, X } from 'lucide-react';
import * as api from '../services/api';
import { MessageBubble, GenieFAB, PortfolioSnapshot } from './GenieChatSubcomponents';
import './GenieChat.css';

const ACTION_TARGETS = Object.freeze({
  '/rebalancer': 'rebalancer',
  '/stepup': 'sip-planner',
  '/tax': 'tax-optimizer',
  '/goals': 'goals',
  '/comparison': 'compare',
  '/recommendations': 'dashboard',
  '/profile': 'profile',
  '/allocation': 'allocation',
});

function newSessionId() {
  const id = crypto.randomUUID();
  sessionStorage.setItem('genie_session_id', id);
  return id;
}

export default function GenieChat({ profile, onNavigate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('genie_session_id') || newSessionId());
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => {
    if (!isOpen || messages.length) return undefined;
    const controller = new AbortController();
    api.getChatHistory(sessionId, { signal: controller.signal }).then(data => {
      const history = data.conversations?.[0]?.messages || [];
      setMessages(history.map(message => ({
        role: message.role === 'model' ? 'assistant' : 'user',
        content: message.content,
        timestamp: message.timestamp || new Date().toISOString(),
        citations: message.metadata?.citations || [],
        _streamed: true,
      })));
    }).catch(() => {});
    return () => controller.abort();
  }, [isOpen, messages.length, sessionId]);

  const navigate = useCallback(action => {
    const page = ACTION_TARGETS[action?.target || action?.url];
    if (!page) return;
    onNavigate?.(page);
    setIsOpen(false);
  }, [onNavigate]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || loading) return;
    setInput('');
    setError('');
    setMessages(current => [...current, { role: 'user', content: message, timestamp: new Date().toISOString() }]);
    setLoading(true);
    try {
      const data = await api.sendChatMessage(message, sessionId);
      setMessages(current => [...current, {
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        latency_ms: data.latency_ms,
        citations: data.citations || [],
      }]);
    } catch (requestError) {
      setError(requestError.message || 'Genie is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId]);

  const clear = async () => {
    try { await api.clearChatSession(sessionId); } catch { /* Local reset still protects this surface. */ }
    setMessages([]);
    setError('');
    setSessionId(newSessionId());
  };

  if (!isOpen) return <GenieFAB onClick={() => setIsOpen(true)} hasNudge={false} />;
  return <aside className={`genie-panel ${expanded ? 'genie-panel--expanded' : ''}`} aria-label="Genie financial assistant">
    <div className="genie-panel-chat-pane">
      <header className="genie-panel-header"><div><strong>Genie</strong><small style={{ display: 'block' }}>Explains server-authoritative recommendations</small></div><div className="genie-header-actions">
        <button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Restore compact size' : 'Expand size'}>{expanded ? <Minimize2 /> : <Maximize2 />}</button>
        <button type="button" onClick={clear} aria-label="Clear chat"><Trash2 /></button>
        <button type="button" onClick={() => setIsOpen(false)} aria-label="Close Genie"><X /></button>
      </div></header>
      <PortfolioSnapshot profile={profile} />
      <div className="genie-messages">
        {!messages.length && <p style={{ color: '#94a3b8', padding: 16 }}>Ask why an instrument passed, how your canonical profile affects suitability, or request a clearly labelled calculation. Memory cannot override your Financial Profile.</p>}
        {messages.map((message, index) => <MessageBubble key={`${message.timestamp}:${index}`} msg={message} onAction={navigate} isLatest={index === messages.length - 1} />)}
        {loading && <div role="status" className="chat-bubble chat-bubble--genie">Checking approved tools and recommendation evidence…</div>}
        {error && <div role="alert" style={{ color: '#fecdd3', padding: 12 }}>{error}</div>}
        <div ref={endRef} />
      </div>
      <div className="genie-input-row"><textarea aria-label="Message Genie" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} /><button type="button" onClick={send} disabled={loading || !input.trim()} aria-label="Send"><Send /></button></div>
    </div>
  </aside>;
}
