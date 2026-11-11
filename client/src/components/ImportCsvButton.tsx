import React, { useRef, useState } from 'react';
import { importInvoicesCsv, type ImportInvoicesResult } from '../api';
import { Upload, X, CheckCircle2, AlertTriangle } from 'lucide-react';

interface ImportCsvButtonProps {
  /** Called once after a successful import call (even a partial one) so the
   *  parent can refetch the ledger. Not called if the request itself fails
   *  outright (nothing was saved). */
  onImported: () => void;
}

/**
 * Bulk invoice import: pick a .csv file, send its raw text to
 * POST /api/agent/invoices/import, and show what happened — created count
 * plus a per-row error list, since partial success (197 of 200 rows saved,
 * 3 typos flagged) is the normal outcome, not a failure to apologize for.
 *
 * A plain hidden <input type="file"> rather than a drag-and-drop zone or a
 * modal with a dropzone — this is a CSV-shaped utility, not a visual
 * centerpiece, and the existing "+ New invoice" pill is right next to it.
 */
export const ImportCsvButton: React.FC<ImportCsvButtonProps> = ({ onImported }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportInvoicesResult | null>(null);
  const [failedToStart, setFailedToStart] = useState<string | null>(null);

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so choosing the same file again (e.g.
    // after fixing it) still fires a change event.
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setFailedToStart(null);
    setResult(null);
    try {
      const text = await file.text();
      const res = await importInvoicesCsv(text);
      setResult(res);
      if (res.created_count > 0) onImported();
    } catch (err: any) {
      setFailedToStart(err?.details || err?.error || 'Could not import that file.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFileChosen}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="pill pill--sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
      >
        {importing ? <span className="spin" /> : <Upload size={13} />}
        {importing ? 'Importing…' : 'Import CSV'}
      </button>

      {(result || failedToStart) && (
        <div
          className="overlay"
          onClick={() => { setResult(null); setFailedToStart(null); }}
          role="dialog"
          aria-modal="true"
          aria-label="CSV import result"
        >
          <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="title">CSV import</h3>
              <button
                type="button" className="pill pill--icon"
                onClick={() => { setResult(null); setFailedToStart(null); }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {failedToStart && (
              <p className="body body--sm" style={{ color: 'var(--warn)' }}>{failedToStart}</p>
            )}

            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p className="body body--sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {result.created_count > 0
                    ? <CheckCircle2 size={16} style={{ flex: 'none', color: 'var(--lime, #CCFF00)' }} />
                    : <AlertTriangle size={16} style={{ flex: 'none', color: 'var(--warn)' }} />}
                  {result.created_count} of {result.created_count + result.errors.length} row
                  {result.created_count + result.errors.length === 1 ? '' : 's'} imported.
                </p>

                {result.warnings && result.warnings.length > 0 && (
                  <p className="body body--sm" style={{ opacity: 0.65 }}>{result.warnings.join(' ')}</p>
                )}

                {result.errors.length > 0 && (
                  <div>
                    <p className="lbl" style={{ marginBottom: 8 }}>Skipped rows</p>
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {result.errors.map((e, i) => (
                        <li key={i} className="body body--sm" style={{ opacity: 0.8 }}>
                          Row {e.row}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button" className="pill pill--lg pill--solid"
                  onClick={() => { setResult(null); setFailedToStart(null); }}
                  style={{ marginTop: 4 }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ImportCsvButton;
