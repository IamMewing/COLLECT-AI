import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAgentStore } from './agentStore';
import gsap from 'gsap';

/**
 * useAgentUI — Hook that executes UI commands from the Agent Runtime.
 * 
 * Handles:
 * - Navigation (agent-triggered page changes)
 * - Scroll-to-element targeting via data attributes
 * - GSAP highlight animations on invoice/client cards
 * - Auto-cleanup of visual effects
 * 
 * Must be mounted inside a Router context (Layout component).
 */
export function useAgentUI() {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingNavigation = useAgentStore(s => s.pendingNavigation);
  const highlightedInvoiceId = useAgentStore(s => s.highlightedInvoiceId);
  const highlightedClientName = useAgentStore(s => s.highlightedClientName);

  // Handle pending navigation
  useEffect(() => {
    if (pendingNavigation && pendingNavigation !== location.pathname) {
      navigate(pendingNavigation);
      useAgentStore.setState({ pendingNavigation: null });
    }
  }, [pendingNavigation, navigate, location.pathname]);

  // Handle invoice highlight — scroll to and animate
  useEffect(() => {
    if (!highlightedInvoiceId) return;

    // Wait for navigation + DOM render
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-invoice-id="${highlightedInvoiceId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        gsap.fromTo(el,
          { scale: 1, boxShadow: '0 0 0 rgba(255,212,0,0)' },
          {
            scale: 1.02,
            boxShadow: '0 0 24px rgba(255,212,0,0.4)',
            duration: 0.5,
            ease: 'power2.out',
            yoyo: true,
            repeat: 2
          }
        );
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [highlightedInvoiceId]);

  // Handle client highlight — scroll to and animate
  useEffect(() => {
    if (!highlightedClientName) return;

    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-client-name="${highlightedClientName}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        gsap.fromTo(el,
          { scale: 1, boxShadow: '0 0 0 rgba(255,212,0,0)' },
          {
            scale: 1.03,
            boxShadow: '0 0 20px rgba(255,212,0,0.35)',
            duration: 0.5,
            ease: 'power2.out',
            yoyo: true,
            repeat: 2
          }
        );
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [highlightedClientName]);
}
