import React from 'react';

const RUNS = [
  'Risk scored in parallel',
  'Chases only when it pays',
  'Real PayPal links',
  'Closes itself when paid',
];

const go = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export const Hero: React.FC = () => (
  <section className="field field--mint hero" data-field="mint" id="top">
    <div className="wrap hero-inner">
      <h1 className="mega hero-head">
        <span className="hero-line"><span>Your invoices</span></span>
        <span className="hero-line"><span>chase them-</span></span>
        <span className="hero-line"><span>selves</span></span>
      </h1>

      <div className="hero-foot">
        <p className="lede hero-lede">
          CollectAI reads every overdue account, decides who to chase and how hard,
          writes the message, and attaches a real PayPal link. You approve. It collects.
        </p>
        <div className="hero-cta">
          <a className="pill pill--lg pill--solid" href="#ledger" onClick={go('ledger')}>
            Run the agent
          </a>
          <a className="pill pill--lg" href="#agent" onClick={go('agent')}>
            See how it thinks
          </a>
        </div>
      </div>
    </div>

    <div className="hero-marquee">
      <div className="marquee">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <div className="marquee-run" key={dup}>
              {RUNS.map((r) => (
                <React.Fragment key={r}>
                  {r}
                  <span>&nbsp;&nbsp;/&nbsp;&nbsp;</span>
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default Hero;
