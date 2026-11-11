import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Nav } from '../components/Nav';
import { LiquidBlobs } from '../components/LiquidBlobs';
import { PipelineRail } from '../components/PipelineRail';
import { AddInvoiceForm } from '../components/AddInvoiceForm';
import { Assistant } from '../components/Assistant';
import { useAppState } from '../AppState';
import { useNotifications } from '../notifications';

/**
 * The shell every route renders inside: nav, the ambient blob field, the
 * floating pipeline rail, the error toast, and the add-invoice modal.
 *
 * These all live here rather than in individual pages because they're
 * cross-cutting — the rail reports an agent run that was kicked off from the
 * ledger and finishes while you're reading the history page, and the modal
 * can be opened from more than one place.
 */
export const AppLayout: React.FC = () => {
  const {
    sweepResult, approveResult, isSweeping, isApproving, error, setError,
    showAddInvoice, setShowAddInvoice, handleInvoiceCreated,
  } = useAppState();
  const { unreadCount } = useNotifications();
  const { pathname } = useLocation();

  // Land at the top of each new page. Without this the browser keeps the
  // previous page's scroll offset, so navigating from a long ledger to a
  // short history page can open it already scrolled past its own header.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <>
      <LiquidBlobs />
      <Nav unreadCount={unreadCount} />

      <main>
        <Outlet />
      </main>

      {/* Errors sit above everything, out of the reading flow. A real-mode
          failure's `details` is the agent's actual exception message, which
          can run long — so this is capped and scrolls internally, with the
          dismiss button kept in its own non-shrinking header row. */}
      {error && (
        <div role="alert" className="toast">
          <div className="toast-head" style={{ paddingBottom: error.details ? 8 : 18 }}>
            <strong style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>{error.error}</strong>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="toast-x">
              <X size={16} />
            </button>
          </div>
          {error.details && <p className="body body--sm toast-body">{error.details}</p>}
        </div>
      )}

      <PipelineRail
        sweepResult={sweepResult}
        approveResult={approveResult}
        isSweeping={isSweeping}
        isApproving={isApproving}
        error={error}
        nudged={!!error}
      />

      <Assistant />

      {showAddInvoice && (
        <AddInvoiceForm onClose={() => setShowAddInvoice(false)} onCreated={handleInvoiceCreated} />
      )}
    </>
  );
};

export default AppLayout;
