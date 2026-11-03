import React from 'react';
import type { Invoice } from '../types';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

interface PortfolioStatsProps {
  invoices: Invoice[];
}

/**
 * What the ledger is worth, not just what's in it.
 *
 * Deliberately narrow: every number here is something this data model can
 * actually back. There's no "average days to pay" because no invoice here
 * carries a created-vs-paid timestamp to compute it from — a plausible-
 * looking number with nothing real behind it is worse than one fewer stat.
 * "Closed itself via PayPal" is the one genuinely load-bearing figure: it's
 * the fraction of recovered value that needed zero manual follow-up, which
 * is the actual claim this product makes.
 */
export const PortfolioStats: React.FC<PortfolioStatsProps> = ({ invoices }) => {
  const open = invoices.filter((i) => i.status !== 'paid');
  const paid = invoices.filter((i) => i.status === 'paid');
  const chasing = open.reduce((sum, i) => sum + i.amount, 0);
  const recovered = paid.reduce((sum, i) => sum + i.amount, 0);
  const recoveredByPaypal = paid
    .filter((i) => i.paid_via === 'paypal')
    .reduce((sum, i) => sum + i.amount, 0);
  const autoPct = recovered > 0 ? Math.round((recoveredByPaypal / recovered) * 100) : null;

  if (invoices.length === 0) return null;

  return (
    <dl className="readouts" style={{ marginBottom: 'clamp(28px, 4vw, 48px)' }}>
      <div className="readout">
        <dt>Currently chasing</dt>
        <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)' }}>
          {inr(chasing)} <small>/ {open.length} account{open.length === 1 ? '' : 's'}</small>
        </dd>
      </div>
      <div className="readout">
        <dt>Recovered</dt>
        <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)' }}>
          {inr(recovered)} <small>/ {paid.length} account{paid.length === 1 ? '' : 's'}</small>
        </dd>
      </div>
      {autoPct !== null && (
        <div className="readout">
          <dt>Closed itself via PayPal</dt>
          <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)' }}>
            {autoPct}<small>% of recovered value, no follow-up</small>
          </dd>
        </div>
      )}
    </dl>
  );
};

export default PortfolioStats;
