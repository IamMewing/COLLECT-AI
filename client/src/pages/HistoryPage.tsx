import React from 'react';
import { PageField } from '../components/PageField';
import { AgentHistory } from '../components/AgentHistory';
import { useAppState } from '../AppState';

export const HistoryPage: React.FC = () => {
  const { historyRefreshKey } = useAppState();

  return (
    <PageField
      id="history"
      tone="ultra"
      tight
      marker="The record"
      statement="Every message it sent, and who got it"
    >
      <AgentHistory refreshKey={historyRefreshKey} />
    </PageField>
  );
};

export default HistoryPage;
