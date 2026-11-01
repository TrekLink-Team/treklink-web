import React, { useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useOrganizations, type OrganizationReview } from '../entities/organization/api';
import {
  FIELD_STATION_REFRESH_MS,
  fieldStationKeys,
  revokeFieldStation,
  queueText,
  type FieldStation,
  type FieldStationList,
} from '../entities/organization/fieldStations';
import { StatusCell, VersionCell } from '../entities/organization/fieldStationUi';
import { apiClient } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  DataTable,
  PageHeader,
  Select,
  StateChangeDialog,
  Toolbar,
  type Column,
  type StateTransition,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';

// The organizations whose stations can still connect, or hold a credential worth revoking.
const LISTED: readonly OrganizationReview['status'][] = ['ACTIVE', 'SUSPENDED'];

interface StationRow extends FieldStation {
  organization: Pick<OrganizationReview, 'id' | 'code' | 'legalName'>;
}

// organizations api-design 25: a reason is required when TrekLink Staff or Admin revoke.
const REVOKE: StateTransition<'REVOKED'> = {
  target: 'REVOKED',
  label: 'Revoke Field Station',
  destructive: true,
  needsReason: true,
  description:
    'The broker refuses this credential from its next connection; its cache lasts up to 60 seconds. Events the station still holds are delivered once the organization configures a new credential.',
  reasonHint: 'Kept in the audit log and shown to the organization.',
  successMessage: 'Field Station credential revoked',
};

// /t/field-stations, screen 3.5 section "TrekLink view" (organizations api-design 23 and 25; UC-06,
// FR-EVT-14): TrekLink Staff and Admin hold `fieldStation.read` and `fieldStation.revoke` for every
// organization. The API lists stations per organization, so the page reads each ACTIVE or SUSPENDED
// organization's list (organizations api-design 02 page of 100) and joins them; the organization
// filter narrows to one.
export const StaffFieldStationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const organizations = useOrganizations(undefined);
  const [organizationId, setOrganizationId] = useState('');
  const [revoking, setRevoking] = useState<StationRow | null>(null);

  const listed = useMemo(
    () => (organizations.data?.items ?? []).filter((item) => LISTED.includes(item.status)),
    [organizations.data],
  );
  const shown = organizationId ? listed.filter((item) => item.id === organizationId) : listed;

  const lists = useQueries({
    queries: shown.map((organization) => ({
      queryKey: fieldStationKeys.list(organization.id),
      queryFn: () => apiClient<FieldStationList>(`/organizations/${organization.id}/field-stations`),
      refetchInterval: FIELD_STATION_REFRESH_MS,
      refetchIntervalInBackground: false,
    })),
  });

  const loading = organizations.isLoading || lists.some((list) => list.isLoading);
  const failure = organizations.error ?? lists.find((list) => list.error)?.error ?? null;
  const rows: StationRow[] = shown.flatMap((organization, index) =>
    (lists[index]?.data?.items ?? []).map((station) => ({
      ...station,
      organization: { id: organization.id, code: organization.code, legalName: organization.legalName },
    })),
  );

  // organizations api-design 02 answers one page of 100: say so when there are more, rather than
  // leaving the stations of the others out without notice (review of treklink-web#284).
  const unread = organizations.data ? organizations.data.totalCount - organizations.data.items.length : 0;
  // Retry reads again whatever failed: the organizations, and each station list that failed.
  const retry = () => {
    void organizations.refetch();
    lists.forEach((list) => {
      if (list.error) void list.refetch();
    });
  };

  const refresh = (id: string) => queryClient.invalidateQueries({ queryKey: fieldStationKeys.list(id) });

  const columns: Column<StationRow>[] = [
    {
      key: 'organization',
      header: 'Organization',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-mono font-semibold text-ink">{row.organization.code}</span>
          <span className="text-body-sm text-ink-muted">{row.organization.legalName}</span>
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Station',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{row.name}</span>
          <span className="font-mono text-body-sm text-ink-muted">{row.mqttUsername}</span>
        </span>
      ),
    },
    { key: 'version', header: 'Version', cell: (row) => <VersionCell station={row} /> },
    { key: 'lastSync', header: 'Last sync', cell: (row) => (row.lastSyncAt ? formatDateTime(row.lastSyncAt) : 'Never') },
    { key: 'queue', header: 'Queue p0 / p1 / p2 / p3', cell: queueText, hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (row) => <StatusCell station={row} /> },
  ];

  return (
    <section aria-labelledby="t-field-stations-title">
      <PageHeader
        id="t-field-stations-title"
        title="Field stations"
        meta={loading ? undefined : `${rows.filter((row) => !row.revokedAt).length} active across ${shown.length} organizations`}
      />
      <Toolbar
        label="Field station filters"
        start={
          <label className="flex items-center gap-2 text-body-sm font-semibold text-ink">
            Organization
            <span className="w-64">
              <Select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
                <option value="">All organizations</option>
                {listed.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.code}, {organization.legalName}
                  </option>
                ))}
              </Select>
            </span>
          </label>
        }
      />
      {unread > 0 && (
        <Alert tone="warning" className="mb-3">
          {`Showing the stations of the first ${organizations.data?.items.length ?? 0} organizations; ${unread} more are not read here. Find an organization on its own page.`}
        </Alert>
      )}
      <DataTable
        caption="Field Stations of every organization"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        rowLabel={(row) => `${row.name} of ${row.organization.code}`}
        loading={loading}
        error={failure ? <ErrorState error={failure} onRetry={retry} /> : undefined}
        empty={{
          title: 'No Field Stations',
          description: organizationId
            ? 'This organization has not created a Field Station credential.'
            : 'No active or suspended organization has created a Field Station credential.',
        }}
        rowActions={(row) =>
          row.revokedAt ? [] : [{ key: 'revoke', label: 'Revoke', destructive: true, onSelect: () => setRevoking(row) }]
        }
      />
      {revoking && (
        <StateChangeDialog<'REVOKED'>
          subject={revoking.name}
          transition={REVOKE}
          version={0}
          onSubmit={({ reason }) => revokeFieldStation(revoking.organization.id, revoking.id, reason)}
          onDone={() => void refresh(revoking.organization.id)}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  );
};
