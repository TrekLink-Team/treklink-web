import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { incidentKeys } from '../entities/incident/api';
import { StaffIncidentDetail } from '../widgets/StaffIncidentDetail/StaffIncidentDetail';
import { LINK } from '../shared/ui/styles';

export const StaffIncidentDetailPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [unavailableId, setUnavailableId] = useState<string | null>(null);
  if (unavailableId === id)
    return (
      <section>
        <p role="alert">You do not have access to this.</p>
        <Link to="/t/incidents" className={LINK}>
          Back to queue
        </Link>
      </section>
    );
  return (
    <StaffIncidentDetail
      key={id}
      id={id}
      page
      onBack={() => navigate('/t/incidents')}
      onSaved={() => {
        void client.invalidateQueries({ queryKey: incidentKeys.all });
      }}
      onUnavailable={() => {
        setUnavailableId(id);
        client.removeQueries({ queryKey: incidentKeys.detail(id) });
      }}
    />
  );
};
