import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAgentStore } from '../store/agentStore';
import { useStore } from '../store/useStore';
import type { AgentMessage, ExecutionStep } from '../store/agentStore';
import gsap from 'gsap';

// ────────────────────────────────────────────────
// Execution Step Visualization
// ────────────────────────────────────────────────
const ExecutionStepRow: React.FC<{ step: ExecutionStep; index: number }> = ({ step, index }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && step.status === 'executing') {
      gsap.fromTo(ref.current, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3, delay: index * 0.1 });
    }
  }, [step.status, index]);

  const statusIcon = step.status === 'done' ? '✓'
    : step.status === 'executing' ? '◉'
    : step.status === 'error' ? '✗'
    : '○';

  const statusColor = step.status === 'done' ? 'var(--mint)'
    : step.status === 'executing' ? 'var(--yellow)'
    : step.status === 'error' ? 'var(--red)'
    : 'var(--border)';

  return (
    <div ref={ref} style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '4px 0',
      fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
      color: step.status === 'done' ? 'var(--muted)' : 'var(--ink)',
      opacity: step.status === 'pending' ? 0.4 : 1,
      transition: 'opacity 0.3s, color 0.3s'
    }}>
      <span style={{
        width: '14px', height: '14px', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.6rem', fontWeight: 700,
        background: step.status === 'executing' ? 'var(--yellow)' : 'transparent',
        border: `1.5px solid ${statusColor}`,
        color: step.status === 'executing' ? 'var(--ink)' : statusColor,
        animation: step.status === 'executing' ? 'pulse 1.2s ease infinite' : 'none',
        flexShrink: 0
      }}>
        {statusIcon}
      </span>
      <span style={{ fontWeight: step.status === 'executing' ? 600 : 400 }}>
        {step.label}
      </span>
    </div>
  );
};

// ────────────────────────────────────────────────
// Tool Execution Badge
// ────────────────────────────────────────────────
const ToolBadge: React.FC<{ toolName: string; success: boolean }> = ({ toolName, success }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      gsap.fromTo(ref.current,
        { opacity: 0, scale: 0.8, y: -4 },
        { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.7)' }
      );
    }
  }, []);

  return (
    <div ref={ref} style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 700,
      color: success ? 'var(--ink)' : '#fff',
      background: success ? 'var(--yellow)' : 'var(--red)',
      padding: '3px 10px', borderRadius: '2px', marginBottom: '6px',
      letterSpacing: '0.03em'
    }}>
      {success ? '⚡' : '✗'} {success ? 'EXECUTED' : 'FAILED'}: {toolName.toUpperCase().replace(/([A-Z])/g, ' $1').trim()}
    </div>
  );
};

// ────────────────────────────────────────────────
// Message Bubble
// ────────────────────────────────────────────────
const MessageBubble: React.FC<{ msg: AgentMessage }> = ({ msg }) => {
  const ref = useRef<HTMLDivElement>(null);
  const isUser = msg.role === 'user';

  useEffect(() => {
    if (ref.current) {
      gsap.fromTo(ref.current,
        { opacity: 0, y: 8, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'power2.out' }
      );
    }
  }, []);

  return (
    <div ref={ref} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
      {/* Tool badge */}
      {msg.actions && msg.actions.length > 0 && msg.actions[0].tool && (
        <ToolBadge toolName={msg.actions[0].tool} success={msg.actions[0].success} />
      )}

      {/* Bubble */}
      <div style={{
        padding: '10px 14px',
        background: isUser ? 'var(--ink)' : 'var(--paper-warm)',
        color: isUser ? 'var(--yellow)' : 'var(--ink)',
        border: isUser ? 'none' : 'var(--stroke-subtle)',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        fontSize: 'var(--text-caption)', lineHeight: 1.6,
        whiteSpace: 'pre-wrap'
      }}>
        {msg.content}
      </div>

      {/* Confidence + Reasoning (collapsed) */}
      {!isUser && msg.confidence != null && (
        <div style={{
          marginTop: '4px', padding: '4px 8px',
          fontFamily: 'var(--font-mono)', fontSize: '0.62rem',
          color: 'var(--muted)', display: 'flex', gap: '10px'
        }}>
          <span>🎯 {Math.round(msg.confidence * 100)}%</span>
          {msg.intent && <span style={{ textTransform: 'uppercase' }}>{msg.intent.replace(/_/g, ' ')}</span>}
          {msg.actions?.[0]?.tool && <span>🛠️ {msg.actions[0].tool}</span>}
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════
// COPILOT — The Agent Terminal Panel
// ════════════════════════════════════════════════
export const Copilot: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isOpen = useAgentStore(s => s.isOpen);
  const togglePanel = useAgentStore(s => s.togglePanel);
  const messages = useAgentStore(s => s.messages);
  const isProcessing = useAgentStore(s => s.isProcessing);
  const currentSteps = useAgentStore(s => s.currentSteps);
  const sendMessage = useAgentStore(s => s.sendMessage);
  const clearConversation = useAgentStore(s => s.clearConversation);
  const pendingNavigation = useAgentStore(s => s.pendingNavigation);
  const setPendingNavigation = useAgentStore(s => s.setPendingNavigation);

  // Read live data for suggestions
  const invoices = useStore((s) => s.invoices);

  const [input, setInput] = useState('');
  const orbRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dynamic Suggestion Chips based on real data
  const suggestions = invoices.length === 0 ? [
    { label: "Create my first invoice", icon: "📄" },
    { label: "Create my first client", icon: "👤" },
    { label: "Show workspace health", icon: "📊" },
    { label: "Explain how CollectAI works", icon: "💡" },
    { label: "How do reminders work?", icon: "💬" }
  ] : [
    { label: "Show overdue invoices", icon: "🔍" },
    { label: "Open highest-risk client", icon: "⚠️" },
    { label: "Create reminder", icon: "✉️" },
    { label: "Generate weekly report", icon: "📊" },
    { label: "Mark invoice as paid", icon: "✅" }
  ];

  // Breathing orb animation
  useEffect(() => {
    if (!orbRef.current) return;
    const pulse = gsap.to(orbRef.current, {
      scale: 1.15,
      boxShadow: '0 0 20px rgba(255, 212, 0, 0.6)',
      duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut'
    });
    return () => { pulse.kill(); };
  }, []);

  // Autofocus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentSteps]);

  // Process pending navigation from agent
  useEffect(() => {
    if (pendingNavigation && pendingNavigation !== location.pathname) {
      navigate(pendingNavigation);
      setPendingNavigation(null);
    }
  }, [pendingNavigation, navigate, location.pathname, setPendingNavigation]);

  // Send message handler
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  };

  // Quick action click
  const handleQuickAction = async (label: string) => {
    if (isProcessing) return;
    await sendMessage(label);
  };

  return (
    <>
      {/* ══ Agent Panel (Sliding Drawer) ══ */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        height: '100vh',
        width: '420px',
        maxWidth: '100%',
        background: 'var(--white)',
        borderLeft: '2px solid var(--ink)',
        boxShadow: '-6px 0 24px rgba(10,10,10,0.15)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.4s',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        visibility: isOpen ? 'visible' : 'hidden'
      }}>

        {/* ── Header (Fixed) ── */}
        <div style={{
          padding: '14px 18px',
          background: 'var(--ink)', color: 'var(--yellow)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
          borderBottom: '2.5px solid var(--yellow)'
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: '0.95rem',
              fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <span style={{
                background: 'var(--yellow)', color: 'var(--ink)',
                padding: '2px 6px', borderRadius: '2px',
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em'
              }}>AI</span>
              CollectAI Employee
            </div>
            <div style={{
              fontSize: '0.65rem', fontFamily: 'var(--font-mono)',
              color: isProcessing ? 'var(--yellow)' : 'rgba(255,255,255,0.5)',
              marginTop: '2px', letterSpacing: '0.04em'
            }}>
              {isProcessing ? '⚡ EXECUTING TASK...' : '● ACTIVE — READY FOR COMMANDS'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={clearConversation} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.5)', padding: '4px 8px',
              fontSize: '0.6rem', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              boxShadow: 'none', borderRadius: '2px'
            }}>
              CLEAR
            </button>
            <button onClick={togglePanel} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.5)', padding: '4px 8px',
              fontSize: '0.65rem', cursor: 'pointer',
              boxShadow: 'none', borderRadius: '2px'
            }}>
              ✕
            </button>
          </div>
        </div>

        {/* ── Scrollable Message Stream & Suggestions ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {messages.length === 0 && (
            <>
              {/* Dynamic Suggestions Block */}
              <div style={{
                padding: '12px 14px', border: 'var(--stroke-subtle)',
                background: 'var(--paper-warm)', borderRadius: '4px',
                marginBottom: '10px'
              }}>
                <div style={{
                  fontSize: '0.62rem', fontFamily: 'var(--font-mono)',
                  color: 'var(--muted)', marginBottom: '8px',
                  letterSpacing: '0.06em', fontWeight: 600
                }}>
                  COMMAND YOUR AI EMPLOYEE
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {suggestions.map((qa, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuickAction(qa.label)}
                      disabled={isProcessing}
                      style={{
                        padding: '6px 10px', fontSize: '0.7rem',
                        border: '1px solid var(--border)', borderRadius: '3px',
                        background: 'var(--white)', cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        boxShadow: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--yellow-soft)';
                        e.currentTarget.style.borderColor = 'var(--ink)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'var(--white)';
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }}
                    >
                      <span>{qa.icon}</span> {qa.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{
                textAlign: 'center', color: 'var(--muted)',
                fontSize: 'var(--text-caption)', padding: '24px 16px',
                lineHeight: 1.6
              }}>
                I'm your accounts receivable assistant.<br/>
                Give me any command — I'll plan, execute, and update your workspace.
              </div>
            </>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Execution Steps */}
          {currentSteps.length > 0 && (
            <div style={{
              padding: '10px 12px',
              background: 'var(--paper-warm)',
              borderRadius: '6px',
              border: 'var(--stroke-subtle)'
            }}>
              <div style={{
                fontSize: '0.6rem', fontFamily: 'var(--font-mono)',
                color: 'var(--muted)', marginBottom: '6px',
                fontWeight: 600, letterSpacing: '0.06em'
              }}>
                AGENT PIPELINE
              </div>
              {currentSteps.map((step, i) => (
                <ExecutionStepRow key={step.id} step={step} index={i} />
              ))}
            </div>
          )}

          {/* Processing indicator */}
          {isProcessing && currentSteps.length === 0 && (
            <div style={{
              padding: '10px 14px', background: 'var(--paper-warm)',
              borderRadius: '6px', fontSize: 'var(--text-caption)',
              color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: 'var(--yellow)',
                animation: 'pulse 1s infinite'
              }} />
              Processing workspace request...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Sticky Input Form (Fixed at Bottom) ── */}
        <form onSubmit={handleSend} style={{
          padding: '14px 16px',
          borderTop: '2px solid var(--ink)',
          display: 'flex', gap: '8px',
          background: 'var(--white)',
          flexShrink: 0
        }}>
          <input
            ref={inputRef}
            type="text"
            className="input-field"
            placeholder={
              messages.length > 0 && messages[messages.length - 1]?.awaitingInput
                ? `Enter ${messages[messages.length - 1]?.awaitingField || 'value'}...`
                : 'Command your AI employee...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              flex: 1, padding: '10px 14px', fontSize: 'var(--text-caption)',
              boxShadow: 'none', border: '1.5px solid var(--border)',
              borderRadius: '3px'
            }}
          />
          <button
            type="submit"
            className="primary"
            disabled={isProcessing || !input.trim()}
            style={{
              padding: '10px 18px', fontSize: '0.75rem',
              boxShadow: 'none', fontWeight: 700,
              letterSpacing: '0.03em', borderRadius: '3px'
            }}
          >
            {isProcessing ? '...' : '▶'}
          </button>
        </form>
      </div>

      {/* ══ Floating Orb ══ */}
      <div
        onClick={togglePanel}
        data-tour-id="tour-ai-employee"
        style={{
          width: '56px', height: '56px',
          background: 'var(--ink)',
          border: '2.5px solid var(--yellow)',
          borderRadius: '50%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(10,10,10,0.25)',
          transition: 'transform 0.2s var(--ease-out), right 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'fixed',
          bottom: '20px',
          right: isOpen ? '440px' : '20px',
          zIndex: 100000,
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <div ref={orbRef} style={{
          width: '18px', height: '18px',
          background: 'var(--yellow)', borderRadius: '50%',
          boxShadow: '0 0 12px rgba(255,212,0,0.6)'
        }} />
        {/* Activity indicator */}
        {isProcessing && (
          <div style={{
            position: 'absolute', top: '-2px', right: '-2px',
            width: '14px', height: '14px', borderRadius: '50%',
            background: 'var(--yellow)',
            border: '2px solid var(--ink)',
            animation: 'pulse 0.8s ease infinite'
          }} />
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }
      `}</style>
    </>
  );
};

export default Copilot;
