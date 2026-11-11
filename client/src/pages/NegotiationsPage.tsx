import React from 'react';
import { PageField } from '../components/PageField';
import { NegotiationsPanel } from '../components/NegotiationsPanel';
import { useAppState } from '../AppState';

export const NegotiationsPage: React.FC = () => {
  const { historyRefreshKey } = useAppState();

  return (
    <PageField
      id="negotiations"
      tone="lime"
      marker="Still working it"
      statement="It doesn’t stop at one reminder — it reads the reply and keeps going"
    >
      <NegotiationsPanel refreshKey={historyRefreshKey} />
    </PageField>
  );
};

export default NegotiationsPage;
