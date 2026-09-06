import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAgentStore } from '../store/agentStore';
import { useAuth } from '../contexts/AuthContext';
import type { Invoice } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export const ClientProfiles: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const invoices = useStore((state) => state.invoices);
  const fetchInvoices = useStore((state) => state.fetchInvoices);

  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [clientData, setClientData] = useState<any>(null);
  const highlightedClientName = useAgentStore((s) => s.highlightedClientName);

  // Auto-select agent-highlighted client
  useEffect(() => {
    if (highlightedClientName && uniqueClients.includes(highlightedClientName)) {
      setSelectedClient(highlightedClientName);
    }
  }, [highlightedClientName]);

  // Group unique client names
  const uniqueClients = Array.from(new Set(invoices.map(i => i.client_name)));

  useEffect(() => {
    fetchInvoices();
  }, []);

  useEffect(() => {
    if (uniqueClients.length > 0 && !selectedClient) {
      setSelectedClient(uniqueClients[0]);
    }
  }, [invoices]);

  // Load client memory logs
  useEffect(() => {
    const fetchMemory = async () => {
      if (selectedClient && user) {
        try {
          const res = await fetch(`/api/invoices?business_id=${invoices[0]?.business_id}`, {
            headers: { 'Authorization': `Bearer ${user.uid}` }
          });
          const allInvoices: Invoice[] = await res.json();
          const clientInvoices = allInvoices.filter(i => i.client_name === selectedClient);

          const riskScore = clientInvoices.some(i => i.status === 'escalated') ? 78 : 24;
          const trustScore = clientInvoices.some(i => i.status === 'escalated') ? 45 : 88;
          const relationshipScore = clientInvoices.some(i => i.status === 'escalated') ? 35 : 92;

          let health = 'Excellent';
          if (relationshipScore <= 35) health = 'Needs Attention';
          if (riskScore > 70) health = 'Critical';

          setClientData({
            clientName: selectedClient,
            health,
            riskScore,
            trustScore,
            relationshipScore,
            invoices: clientInvoices,
            avgDelay: clientInvoices.some(i => i.status === 'escalated') ? 22 : 4,
            phone: 'Not Provided',
            email: clientInvoices[0]?.client_email || 'Not Provided',
            whatsapp: 'Not Connected',
            timezone: 'Asia/Kolkata',
            country: 'India',
            sentiment: clientInvoices.some(i => i.status === 'escalated') ? 'frustrated' : 'neutral',
            notes: clientInvoices.some(i => i.status === 'escalated')
              ? 'Client has outstanding overdue invoices. Gentle follow-up email recommended.'
              : 'Client contract exhibits a standard payment schedule. Maintain polite reminders.'
          });
        } catch (e) {
          console.error(e);
        }
      }
    };
    fetchMemory();
  }, [selectedClient, user, invoices]);

  const stages = [
    'Created', 'Waiting', 'Due Soon', 'Reminder Scheduled',
    'Reminder Sent', 'Viewed', 'Client Responded',
    'Negotiation', 'Paid', 'Archived'
  ];

  const getLifecycleStageIndex = (inv: Invoice) => {
    if (inv.status === 'paid') return 8;
    if (inv.status === 'escalated') return 7;
    if (inv.escalation_level === 2) return 6;
    if (inv.escalation_level === 1) return 4;
    return 2;
  };

  const chartData = (clientData?.invoices || []).map((inv: Invoice) => ({
    name: inv.invoice_id,
    delay: inv.status === 'paid' ? 0 : Math.max(1, Math.ceil((new Date().getTime() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24)))
  }));

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="page-title">Clients</h2>
          <p className="page-subtitle">Client risk scores, trust indices, and AI relationship memories</p>
        </div>
        <button
          onClick={() => navigate('/add')}
          className="primary"
          data-tour-id="tour-create-client"
          style={{ padding: '8px 16px', fontSize: 'var(--text-caption)' }}
        >
          + Create Client
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '24px' }}>

        {/* Client List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="label-text">SELECT CLIENT</div>
          {uniqueClients.map((client) => {
            const isHighlighted = highlightedClientName === client;
            return (
            <div
              key={client}
              data-client-name={client}
              onClick={() => setSelectedClient(client)}
              className={isHighlighted ? 'agent-highlight' : ''}
              style={{
                padding: '12px 14px',
                border: isHighlighted ? '2px solid var(--yellow)' : 'var(--stroke-subtle)',
                borderRadius: '3px',
                cursor: 'pointer',
                backgroundColor: selectedClient === client ? 'var(--yellow-soft)' : isHighlighted ? 'rgba(255,212,0,0.1)' : 'var(--white)',
                borderLeft: selectedClient === client ? '3px solid var(--yellow)' : isHighlighted ? '3px solid var(--yellow)' : '1px solid var(--border)',
                fontWeight: selectedClient === client ? 600 : 400,
                fontSize: 'var(--text-body)',
                transition: 'all 0.3s ease',
                boxShadow: isHighlighted ? '0 0 12px rgba(255,212,0,0.25)' : 'none'
              }}
            >
              {client}
            </div>
          );})}

          {uniqueClients.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 'var(--text-caption)' }}>
              No clients found.
            </div>
          )}
        </div>

        {/* Client Detail */}
        {clientData ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Header */}
            <div className="os-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="label-text">CLIENT PROFILE</div>
                  <h3 className="section-title" style={{ fontSize: '1.6rem', marginBottom: '4px' }}>
                    {clientData.clientName}
                  </h3>
                  <div style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)' }}>
                    {clientData.email} · {clientData.phone}
                  </div>
                </div>

                <span className={`badge badge-${
                  clientData.health === 'Excellent' ? 'paid' :
                  clientData.health === 'Needs Attention' ? 'warning' : 'escalated'
                }`}>
                  Health: {clientData.health}
                </span>
              </div>
            </div>

            {/* Scores */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              {[
                { label: 'Relationship Score', value: `${clientData.relationshipScore}%` },
                { label: 'Trust Index', value: `${clientData.trustScore}%` },
                { label: 'Credit Risk', value: `${clientData.riskScore}%` },
                { label: 'Avg Payment Delay', value: `${clientData.avgDelay} Days` },
              ].map((s, i) => (
                <div key={i} className="os-card" style={{ padding: '16px' }}>
                  <div className="label-text">{s.label}</div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-title)',
                    fontWeight: 700,
                    marginTop: '4px'
                  }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Invoices */}
            <div className="os-card">
              <h3 className="section-title">Invoice Progress</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {clientData.invoices.map((inv: Invoice) => {
                  const activeIndex = getLifecycleStageIndex(inv);
                  return (
                    <div key={inv.id} style={{
                      padding: '16px',
                      background: 'var(--paper-warm)',
                      borderRadius: '3px'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-label)',
                        marginBottom: '10px'
                      }}>
                        <span>{inv.invoice_id}</span>
                        <span>₹{inv.amount.toLocaleString('en-IN')}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px' }}>
                        {stages.map((stage, idx) => (
                          <div
                            key={idx}
                            style={{
                              height: '4px',
                              borderRadius: '2px',
                              background: idx < activeIndex ? 'var(--mint)' : idx === activeIndex ? 'var(--yellow)' : 'var(--border)'
                            }}
                            title={stage}
                          />
                        ))}
                      </div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '6px',
                        fontSize: 'var(--text-label)',
                        color: 'var(--muted)',
                        fontFamily: 'var(--font-mono)'
                      }}>
                        <span>{stages[0]}</span>
                        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Current: {stages[activeIndex]}</span>
                        <span>{stages[stages.length - 1]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Delays Chart */}
            {chartData.length > 0 && (
              <div className="os-card">
                <h3 className="section-title">Payment Delay History (Days Overdue)</h3>
                <div style={{ width: '100%', height: '180px', marginTop: '12px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="name" stroke="var(--muted)" fontSize={12} />
                      <YAxis stroke="var(--muted)" fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="delay" fill="var(--yellow)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* AI Notes */}
            <div className="os-card" style={{ background: 'var(--yellow-soft)' }}>
              <div className="label-text">AI MEMORY SUMMARY</div>
              <p style={{ fontSize: 'var(--text-body)', marginTop: '4px', lineHeight: 1.5 }}>
                💡 "{clientData.notes}"
              </p>
            </div>

          </div>
        ) : (
          <div className="os-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
            Select a client to view their relationship profile.
          </div>
        )}

      </div>
    </div>
  );
};

export default ClientProfiles;
