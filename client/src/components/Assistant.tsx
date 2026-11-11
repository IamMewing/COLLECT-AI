import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, ArrowUp } from 'lucide-react';

interface Turn {
  role: 'you' | 'agent';
  text: string;
}

const SUGGESTIONS = [
  'Who owes me the most right now?',
  'What has the agent sent today?',
  'Which accounts are at risk of not paying?',
];

/**
 * The floating assistant. Read-only by design — it answers questions about
 * the portfolio from real data and explicitly cannot act, which is why it
 * can sit on every page without needing its own confirmation gate the way
 * the approval gate does.
 *
 * Conversation state is deliberately local and ephemeral: it's a lookup
 * tool ("who owes me the most"), not a thread anyone needs to come back to,
 * and the server holds no per-user session to anchor one to anyway.
 */
export const Assistant: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, thinking]);

  // Escape closes it, like any other overlay on the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setQuestion('');
    setTurns((t) => [...t, { role: 'you', text: q }]);
    setThinking(true);
    try {
      const res = await fetch('/api/agent/assistant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setTurns((t) => [...t, {
        role: 'agent',
        text: res.ok
          ? (data.answer || 'No answer came back.')
          // 429 is the shared rate limit, which has its own human-readable
          // message — show that rather than a generic failure.
          : (data.details || data.error || 'Something went wrong.'),
      }]);
    } catch {
      setTurns((t) => [...t, { role: 'agent', text: 'Couldn’t reach the server. Check it’s running and try again.' }]);
    } finally {
      setThinking(false);
    }
  };

  if (!open) {
    return (
      <button
        className="assistant-fab"
        onClick={() => setOpen(true)}
        aria-label="Ask about your accounts"
      >
        <Sparkles size={19} />
      </button>
    );
  }

  return (
    <aside className="assistant" role="dialog" aria-label="Assistant">
      <header className="assistant-head">
        <span className="marker" style={{ marginBottom: 0 }}>Ask about your accounts</span>
        <button onClick={() => setOpen(false)} aria-label="Close" className="assistant-x">
          <X size={16} />
        </button>
      </header>

      <div className="assistant-scroll" ref={scrollerRef}>
        {turns.length === 0 && (
          <>
            <p className="body body--sm assistant-intro">
              I can read your ledger, what the agent has sent, and any live
              negotiation threads. I can’t send anything or change anything —
              that stays with you.
            </p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="pill pill--sm" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </>
        )}

        {turns.map((t, i) => (
          <p key={i} className={`assistant-turn assistant-turn--${t.role}`}>{t.text}</p>
        ))}

        {thinking && <p className="assistant-turn assistant-turn--agent assistant-thinking">Reading your ledger…</p>}
      </div>

      <form
        className="assistant-form"
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
      >
        <input
          ref={inputRef}
          className="assistant-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Who owes me the most?"
          maxLength={1000}
          disabled={thinking}
        />
        <button className="pill pill--sm pill--icon pill--solid" disabled={thinking || !question.trim()} aria-label="Send">
          <ArrowUp size={15} />
        </button>
      </form>
    </aside>
  );
};

export default Assistant;
