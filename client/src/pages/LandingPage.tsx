import React from 'react';
import { Link } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { Torn } from '../components/Torn';
import { useInView } from '../useInView';

type Tone = 'mint' | 'ink' | 'coral';

/** A full-bleed colour field that reveals its contents once, on first sight.
 *  This stays scroll-gated (unlike routed pages' <PageField>) because the
 *  landing page is a deliberate long scroll — the reveal is the point. */
const Field: React.FC<{
  id: string;
  tone: Tone;
  marker: string;
  statement: string;
  children: React.ReactNode;
}> = ({ id, tone, marker, statement, children }) => {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      id={id}
      data-field={tone}
      className={`field field--${tone}${inView ? ' is-in' : ''}`}
    >
      <div className="wrap">
        <header className="page-head">
          <div>
            <span className="marker fade">{marker}</span>
            <h2 className="statement rise rise--1"><span>{statement}</span></h2>
          </div>
        </header>
        <div className="fade">{children}</div>
      </div>
    </section>
  );
};

const STEPS = [
  {
    n: '01',
    head: 'It scores the money and the odds',
    body: 'Risk and payment probability are computed in parallel — amount, days overdue, ignored reminders, relationship history, on-time rate. Two independent reads before anything is decided.',
  },
  {
    n: '02',
    head: 'It decides whether chasing is worth it',
    body: 'A high-probability account gets left alone. The graph genuinely stops — no message is drafted at all. Chasing someone who was always going to pay costs goodwill and buys nothing.',
  },
  {
    n: '03',
    head: 'It writes the message, with a real payment link',
    body: 'Tone matched to the relationship, channel matched to what’s actually on file. A real PayPal order is minted and the live approval link is woven into the text — not a promise of one.',
  },
  {
    n: '04',
    head: 'It reads the reply and keeps going',
    body: 'An answer comes back, the agent negotiates: a settlement, an installment plan it then bills on schedule, or an escalation to you. Paid closes the loop automatically via webhook.',
  },
];

export const LandingPage: React.FC = () => (
  <>
    <Hero />

    <Torn from="mint" to="ink" variant={0} />
    <Field
      id="how"
      tone="ink"
      marker="How it thinks"
      statement="It weighs the money and the odds before it writes a word"
    >
      <ol className="steps">
        {STEPS.map((s) => (
          <li className="step" key={s.n}>
            <span className="num step-n">{s.n}</span>
            <h3 className="title step-head">{s.head}</h3>
            <p className="body step-body">{s.body}</p>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 'clamp(36px, 5vw, 64px)' }}>
        <Link className="pill pill--lg pill--solid" to="/agent">Watch it run</Link>
      </div>
    </Field>

    <Torn from="ink" to="coral" variant={2} />
    <Field
      id="control"
      tone="coral"
      marker="Your call"
      statement="Nothing goes out until you say so"
    >
      <p className="lede" style={{ maxWidth: '34ch' }}>
        Every drafted message waits at an approval gate. Edit it, send it, or
        throw it away — and when it does go, the gate tells you the truth about
        what actually happened on the wire, provider errors and all.
      </p>
      <div style={{ marginTop: 'clamp(28px, 4vw, 48px)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link className="pill pill--lg pill--solid" to="/ledger">Open the ledger</Link>
        <Link className="pill pill--lg" to="/history">See what it sent</Link>
      </div>
    </Field>

    <Torn from="coral" to="ink" variant={1} />
    <footer className="field field--ink field--tight" data-field="ink">
      <div className="wrap">
        <h2 className="mega" style={{ marginBottom: 'clamp(28px, 4vw, 56px)' }}>Get paid.</h2>
        <dl className="readouts">
          <div className="readout">
            <dt>Payments</dt>
            <dd className="readout-stack">PayPal Orders v2 + webhooks</dd>
          </div>
          <div className="readout">
            <dt>Reasoning</dt>
            <dd className="readout-stack">Strands multi-agent graph</dd>
          </div>
          <div className="readout">
            <dt>Model</dt>
            <dd className="readout-stack">Gemini</dd>
          </div>
          <div className="readout">
            <dt>Channels</dt>
            <dd className="readout-stack">Email + WhatsApp</dd>
          </div>
        </dl>
      </div>
    </footer>
  </>
);

export default LandingPage;
