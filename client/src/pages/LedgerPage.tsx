import React from 'react';
import { PageField } from '../components/PageField';
import { PortfolioStats } from '../components/PortfolioStats';
import { InvoiceGrid } from '../components/InvoiceGrid';
import { InvoiceSelector } from '../components/InvoiceSelector';
import { PortfolioSweep } from '../components/PortfolioSweep';
import { ImportCsvButton } from '../components/ImportCsvButton';
import { useAppState } from '../AppState';
import { Plus } from 'lucide-react';

export const LedgerPage: React.FC = () => {
  const {
    invoices, selectedInvoice, isSweeping, isMarkingPaid, isCalling, callNote,
    paypalConfigured, loadInvoices, selectInvoice, handleRunSweep,
    handleMarkPaid, handleCallThem, handleOpenPortfolioResult, setShowAddInvoice,
  } = useAppState();

  const empty = invoices.length === 0;

  return (
    <PageField
      id="ledger"
      tone="mint"
      marker="The ledger"
      statement={empty ? 'Nothing on the books yet' : 'Every account it’s watching'}
      aside={
        <span className={`tag${paypalConfigured ? ' tag--paid' : ''}`} style={!paypalConfigured ? { opacity: 0.5 } : undefined}>
          <span className={paypalConfigured ? 'dot dot--live' : 'dot'} />
          {paypalConfigured ? 'PayPal sandbox live' : 'PayPal not configured'}
        </span>
      }
    >
      {empty ? (
        <div className="empty">
          <h3 className="title">Add the first account you’re chasing</h3>
          <p className="body" style={{ marginTop: 12, opacity: 0.8 }}>
            This ledger holds real accounts only — no sample data. Give an invoice a
            client, an amount, how late it is, and at least one way to reach them
            (email or a phone number with country code). The agent takes it from there.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
            <button className="pill pill--lg pill--solid" onClick={() => setShowAddInvoice(true)}>
              <Plus size={15} /> Add an invoice
            </button>
            <ImportCsvButton onImported={loadInvoices} />
          </div>
        </div>
      ) : (
        <>
          <PortfolioStats invoices={invoices} />
          <InvoiceGrid
            invoices={invoices}
            selectedInvoiceId={selectedInvoice?.invoice_id}
            onSelectInvoice={selectInvoice}
          />
          <div id="selector" style={{ marginTop: 'clamp(40px, 6vw, 78px)' }}>
            <InvoiceSelector
              invoices={invoices}
              selectedInvoice={selectedInvoice}
              onSelectInvoice={selectInvoice}
              onRunSweep={handleRunSweep}
              isSweeping={isSweeping}
              onAddInvoice={() => setShowAddInvoice(true)}
              onMarkPaid={handleMarkPaid}
              isMarkingPaid={isMarkingPaid}
              onCallThem={handleCallThem}
              isCalling={isCalling}
              onInvoicesImported={loadInvoices}
            />
            {callNote && (
              <p className="body body--sm" style={{ opacity: 0.75, marginTop: 14 }}>{callNote}</p>
            )}
          </div>
          <PortfolioSweep invoices={invoices} onOpen={handleOpenPortfolioResult} />
        </>
      )}
    </PageField>
  );
};

export default LedgerPage;
