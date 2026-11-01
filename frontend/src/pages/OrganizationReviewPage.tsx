import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  approveOrganization,
  closeOrganization,
  organizationKeys,
  reactivateOrganization,
  rejectOrganization,
  suspendOrganization,
  useOrganizations,
  useOrganizationTransitions,
  verifyOrganization,
  type OrganizationReview,
  type OrganizationStatus,
} from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  ORGANIZATION_STATUS,
  PageActionBar,
  PageHeader,
  RadioGroup,
  Select,
  Skeleton,
  StateChangeMenu,
  StickyPageHeader,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  Toolbar,
  ToolbarSearch,
  useToast,
  type Column,
  type StateChangeInput,
  type StateTransition,
} from '../shared/ui';
import { ErrorState, Fact } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { matchesText } from '../shared/lib/filter';
import { ChannelKeySection } from '../widgets/ChannelKeySection/ChannelKeySection';

type Tab = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

const DOCUMENTS = ['Business registration', 'Manager ID card', 'Tour operator licence'];

type Method = 'IN_PERSON' | 'PHONE';

// The counter verification of api-design 05 (FR-ORG-02, BR-43): both contract terms are required.
const VerifyForm: React.FC<{ organization: OrganizationReview; onSaved: () => void }> = ({
  organization,
  onSaved,
}) => {
  // An update keeps the recorded method; a first verification starts at in person.
  const [method, setMethod] = useState<Method>(organization.verificationMethod ?? 'IN_PERSON');
  const [documents, setDocuments] = useState<string[]>(organization.documentsSeen);
  const [reference, setReference] = useState(organization.masterContractRef ?? '');
  const [nda, setNda] = useState(organization.ndaSigned);
  const [licence, setLicence] = useState(organization.softwareLicenceSigned);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const toggle = (document: string) =>
    setDocuments((current) =>
      current.includes(document)
        ? current.filter((item) => item !== document)
        : [...current, document],
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (documents.length === 0 || reference.trim() === '') {
      setError('Tick the documents seen and enter the master contract number.');
      return;
    }
    if (!nda || !licence) {
      setError('The master contract must include the signed NDA and the software licence.');
      return;
    }
    setPending(true);
    try {
      await verifyOrganization(organization.id, {
        method,
        documentsSeen: documents,
        masterContractRef: reference.trim(),
        ndaSigned: nda,
        softwareLicenceSigned: licence,
        expectedVersion: organization.version,
      });
      setError(null);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h3 className="text-title-sm text-ink">Counter verification</h3>
      <RadioGroup<Method>
        name="verification-method"
        legend="Method"
        layout="row"
        options={[
          { value: 'IN_PERSON', label: 'In person' },
          { value: 'PHONE', label: 'By phone' },
        ]}
        value={method}
        onChange={setMethod}
      />
      <fieldset className="flex flex-col">
        <legend className="text-body-sm font-semibold text-ink">Documents seen</legend>
        {DOCUMENTS.map((document) => (
          <Checkbox
            key={document}
            label={document}
            checked={documents.includes(document)}
            onChange={() => toggle(document)}
          />
        ))}
      </fieldset>
      <Field id="master-contract" label="Master contract number" required>
        <Input
          id="master-contract"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <Checkbox
        label="The master contract includes the signed NDA"
        checked={nda}
        onChange={(event) => setNda(event.target.checked)}
      />
      <Checkbox
        label="The master contract includes the Field Station software licence"
        checked={licence}
        onChange={(event) => setLicence(event.target.checked)}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={pending} loadingLabel="Saving">
        {organization.verifiedAt ? 'Update verification' : 'Record verification'}
      </Button>
    </form>
  );
};

// The reject dialog of api-design 07: the reason is shown to the Manager (MSG16).
const RejectDialog: React.FC<{
  organization: OrganizationReview;
  onDone: (rejected: OrganizationReview) => void;
  onClose: () => void;
}> = ({ organization, onDone, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      onDone(await rejectOrganization(organization.id, reason.trim(), organization.version));
    } catch (failure) {
      setPending(false);
      setError(messageOf(failure));
    }
  };

  return (
    <Dialog
      titleId="reject-org-title"
      title={`Reject ${organization.code}?`}
      description={organization.legalName}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep pending
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void submit()}>
            Reject organization
          </Button>
        </>
      }
    >
      <Field
        id="reject-org-reason"
        label="Reason shown to the Manager"
        error={error ?? undefined}
        required
      >
        <Textarea
          id="reject-org-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          {...invalid('reject-org-reason', error ?? undefined)}
        />
      </Field>
    </Dialog>
  );
};

type StatusAction = 'suspend' | 'close';

const STATUS_ACTION: Record<
  StatusAction,
  { title: string; detail: string; confirm: string; done: string }
> = {
  suspend: {
    title: 'Suspend',
    detail:
      'It cannot request contracts while suspended. Rented devices stay monitored and SOS alerts still reach its members.',
    confirm: 'Suspend organization',
    done: 'suspended',
  },
  close: {
    title: 'Close',
    detail:
      'Its members are deactivated and its API keys and Field Station credentials revoked. This cannot be undone.',
    confirm: 'Close organization',
    done: 'closed',
  },
};

// The suspend and close dialogs of api-design 08 and 10: the reason is kept on the transition and
// shown to the Manager. A refusal (OPEN_CONTRACTS, STALE_VERSION) stays in the dialog.
const StatusDialog: React.FC<{
  action: StatusAction;
  organization: OrganizationReview;
  onDone: () => void;
  onStale: () => void;
  onClose: () => void;
}> = ({ action, organization, onDone, onStale, onClose }) => {
  const copy = STATUS_ACTION[action];
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      const call = action === 'suspend' ? suspendOrganization : closeOrganization;
      await call(organization.id, reason.trim(), organization.version);
      onDone();
    } catch (failure) {
      setPending(false);
      setError(messageOf(failure));
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') onStale();
    }
  };

  return (
    <Dialog
      titleId="org-status-title"
      title={`${copy.title} ${organization.code}?`}
      description={`${organization.legalName}. ${copy.detail}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void submit()}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <Field
        id="org-status-reason"
        label="Reason shown to the Manager"
        error={error ?? undefined}
        required
      >
        <Textarea
          id="org-status-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          {...invalid('org-status-reason', error ?? undefined)}
        />
      </Field>
    </Dialog>
  );
};

// The status history of api-design 11, newest last as the server lists it.
const StatusHistory: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const history = useOrganizationTransitions(organizationId);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-title-sm text-ink">Status history</h3>
      {history.isLoading && <Skeleton className="h-10" />}
      {history.error && (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      )}
      {history.data && history.data.length === 0 && (
        <p className="text-body-sm text-ink-muted">No status change yet.</p>
      )}
      {history.data && history.data.length > 0 && (
        <ol className="flex flex-col gap-2">
          {history.data.map((row) => (
            <li key={`${row.createdAt}-${row.toStatus}`} className="text-body-sm">
              <span className="font-semibold text-ink">
                {ORGANIZATION_STATUS[row.fromStatus]?.label ?? row.fromStatus} to{' '}
                {ORGANIZATION_STATUS[row.toStatus]?.label ?? row.toStatus}
              </span>
              <span className="block text-ink-muted">
                {formatDateTime(row.createdAt)}, {row.actor}
                {row.reason ? `: ${row.reason}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

// The row menu of screen 3.2 (W29): only the next statuses of the organization lifecycle (D-035,
// organizations design §2) an Admin may choose. Approve waits for the counter verification (MSG21).
// Reject, suspend and close keep their reason on the transition, shown to the Manager.
type Target = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE' | 'CLOSE';

const REASON_HINT = 'Shown to the Manager and kept on the status history.';

const organizationTransitions = (organization: OrganizationReview, isAdmin: boolean): StateTransition<Target>[] => {
  if (!isAdmin) return [];
  switch (organization.status) {
    case 'PENDING':
      return [
        ...(organization.verifiedAt
          ? [{ target: 'APPROVE' as const, label: 'Approve organization', description: 'The Manager can request devices from now on.', successMessage: `${organization.code} approved. The Manager can now request devices.` }]
          : []),
        { target: 'REJECT', label: 'Reject organization', destructive: true, needsReason: true, reasonHint: REASON_HINT, description: 'The registration is refused. This cannot be undone.', successMessage: `${organization.code} rejected.` },
      ];
    case 'ACTIVE':
      return [
        { target: 'SUSPEND', label: 'Suspend organization', destructive: true, needsReason: true, reasonHint: REASON_HINT, description: STATUS_ACTION.suspend.detail, successMessage: `${organization.code} suspended.` },
        { target: 'CLOSE', label: 'Close organization', destructive: true, needsReason: true, reasonHint: REASON_HINT, description: STATUS_ACTION.close.detail, successMessage: `${organization.code} closed.` },
      ];
    case 'SUSPENDED':
      return [{ target: 'REACTIVATE', label: 'Reactivate organization', description: 'It can request contracts again.', successMessage: `${organization.code} reactivated.` }];
    default:
      return [];
  }
};

const submitTransition = (organization: OrganizationReview, input: StateChangeInput<Target>) => {
  const reason = input.reason ?? '';
  switch (input.target) {
    case 'APPROVE':
      return approveOrganization(organization.id, input.expectedVersion);
    case 'REJECT':
      return rejectOrganization(organization.id, reason, input.expectedVersion);
    case 'SUSPEND':
      return suspendOrganization(organization.id, reason, input.expectedVersion);
    case 'CLOSE':
      return closeOrganization(organization.id, reason, input.expectedVersion);
    case 'REACTIVATE':
      return reactivateOrganization(organization.id, input.expectedVersion);
  }
};

// /t/organizations, screen 3.2 (organizations api-design 02, 05 to 11; UC-02, UC-03, UC-07): Staff
// and Admin work the verification queue, and an Admin approves a verified organization (MSG05,
// MSG21) or rejects it (MSG16), suspends, reactivates or closes it.
export const OrganizationReviewPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [tab, setTab] = useState<Tab>('PENDING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const organizations = useOrganizations(
    tab === 'ALL' ? undefined : (tab satisfies OrganizationStatus),
  );
  const selected = organizations.data?.items.find((item) => item.id === selectedId) ?? null;
  const [find, setFind] = useState({ text: '', verified: '' });
  const clear = () => setFind({ text: '', verified: '' });
  const filtered = find.text !== '' || find.verified !== '';
  const rows = organizations.data?.items.filter(
    (item) =>
      matchesText(find.text, item.code, item.legalName, item.taxCode) &&
      (find.verified === '' || (find.verified === 'YES') === Boolean(item.verifiedAt)),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: organizationKeys.all });

  const columns: Column<OrganizationReview>[] = [
    { key: 'code', header: 'Code', cell: (item) => <span className="font-mono">{item.code}</span> },
    { key: 'name', header: 'Organization', cell: (item) => item.legalName },
    { key: 'registered', header: 'Registered', cell: (item) => formatDateTime(item.createdAt), hideOnMobile: true },
    { key: 'verified', header: 'Verified', cell: (item) => (item.verifiedAt ? 'Yes' : 'Not yet') },
    { key: 'status', header: 'Status', cell: (item) => <StatusBadge entry={ORGANIZATION_STATUS[item.status]} /> },
  ];

  const select = (id: string) => {
    setSelectedId(id);
    setDecisionError(null);
    setStatusError(null);
  };

  // api-design 09: no reason; BALANCE_OUTSTANDING (billing's exit check) shows under Status.
  const reactivate = async (organization: OrganizationReview) => {
    setReactivating(true);
    setStatusError(null);
    try {
      await reactivateOrganization(organization.id, organization.version);
      await refresh();
      showToast(`${organization.code} reactivated.`);
    } catch (failure) {
      setStatusError(messageOf(failure));
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') void refresh();
    } finally {
      setReactivating(false);
    }
  };

  const approve = async (organization: OrganizationReview) => {
    setDeciding(true);
    setDecisionError(null);
    try {
      await approveOrganization(organization.id, organization.version);
      await refresh();
      showToast(`${organization.code} approved. The Manager can now request devices.`);
    } catch (failure) {
      setDecisionError(messageOf(failure));
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') void refresh();
    } finally {
      setDeciding(false);
    }
  };

  return (
    <section aria-labelledby="orgs-title" className="flex flex-1 flex-col">
      <StickyPageHeader>
        <PageHeader id="orgs-title" title="Organizations" />
        <Tabs
          label="Status"
          idPrefix="orgs"
          items={TABS}
          value={tab}
          onChange={(key) => {
            setTab(key);
            setSelectedId(null);
          }}
          className="mb-4"
        />
      </StickyPageHeader>

      <TabPanel idPrefix="orgs" tabKey={tab}>
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            <Toolbar
              label="Organization filters"
              start={
                <>
                  <ToolbarSearch
                    id="orgs-search"
                    label="Search by code, name or tax code"
                    placeholder="Code, name or tax code"
                    value={find.text}
                    onChange={(text) => setFind((current) => ({ ...current, text }))}
                  />
                  <span className="w-44">
                    <Select
                      aria-label="Verified"
                      value={find.verified}
                      onChange={(event) => setFind((current) => ({ ...current, verified: event.target.value }))}
                    >
                      <option value="">Verified or not</option>
                      <option value="YES">Verified</option>
                      <option value="NO">Not yet</option>
                    </Select>
                  </span>
                  {filtered && (
                    <Button variant="ghost" onClick={clear}>
                      Clear filters
                    </Button>
                  )}
                </>
              }
            />
            <DataTable<OrganizationReview>
              caption="Organizations"
              columns={columns}
              rows={rows}
              rowId={(item) => item.id}
              rowLabel={(item) => item.code}
              loading={organizations.isLoading}
              error={
                organizations.error ? (
                  <ErrorState error={organizations.error} onRetry={() => void organizations.refetch()} />
                ) : undefined
              }
              empty={
                filtered
                  ? { title: 'No results match your filters.', action: <Button onClick={clear}>Clear filters</Button> }
                  : { title: 'No organizations here.' }
              }
              activeRowId={selectedId ?? undefined}
              onRowActivate={(item) => select(item.id)}
              rowActions={
                isAdmin
                  ? (item) => (
                      <StateChangeMenu<Target>
                        subject={item.code}
                        transitions={organizationTransitions(item, isAdmin)}
                        version={item.version}
                        onSubmit={(input) => submitTransition(item, input)}
                        onReload={() => void refresh()}
                        onDone={() => void refresh()}
                      />
                    )
                  : undefined
              }
            />
          </div>

          {selected ? (
            <Card
              as="article"
              className="flex flex-col gap-4 xl:sticky xl:top-[calc(var(--tl-page-header-h,0px)+1rem)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-title-sm text-ink">{selected.legalName}</h2>
                <StatusBadge entry={ORGANIZATION_STATUS[selected.status]} />
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Fact label="Code">{selected.code}</Fact>
                <Fact label="Tax code">{selected.taxCode}</Fact>
                <Fact label="Address">{selected.address}</Fact>
                <Fact label="Contact">
                  <span className="[overflow-wrap:anywhere]">
                    {selected.contactEmail}, {selected.contactPhone}
                  </span>
                </Fact>
                {selected.verifiedAt && (
                  <Fact label="Verified">
                    {formatDateTime(selected.verifiedAt)},{' '}
                    {selected.verificationMethod === 'PHONE' ? 'by phone' : 'in person'}, contract{' '}
                    {selected.masterContractRef}
                  </Fact>
                )}
                {selected.rejectionReason && (
                  <Fact label="Rejection reason">{selected.rejectionReason}</Fact>
                )}
              </dl>

              <ChannelKeySection organization={selected} />

              {selected.status === 'PENDING' && (
                <>
                  <VerifyForm
                    key={`${selected.id}-${selected.version}`}
                    organization={selected}
                    onSaved={() => {
                      void refresh();
                      showToast('Saved.');
                    }}
                  />
                  {isAdmin && (!selected.verifiedAt || decisionError) && (
                    <div className="flex flex-col gap-3 border-t border-line pt-4">
                      <h3 className="text-title-sm text-ink">Decision</h3>
                      {!selected.verifiedAt && (
                        <Alert tone="warning">
                          Verify this organization at the counter before approving it.
                        </Alert>
                      )}
                      {decisionError && <Alert tone="error">{decisionError}</Alert>}
                    </div>
                  )}
                </>
              )}

              {isAdmin &&
                (selected.status === 'ACTIVE' || selected.status === 'SUSPENDED') &&
                statusError && (
                  <div className="flex flex-col gap-3 border-t border-line pt-4">
                    <h3 className="text-title-sm text-ink">Status</h3>
                    <Alert tone="error">{statusError}</Alert>
                  </div>
                )}

              {selected.status !== 'PENDING' && <StatusHistory organizationId={selected.id} />}
            </Card>
          ) : (
            organizations.data &&
            organizations.data.items.length > 0 && (
              <Card surface="glass" className="text-body text-ink-muted">
                Select an organization to see its details, record the counter verification and
                decide.
              </Card>
            )
          )}
        </div>
      </TabPanel>

      {/* The selected organization's decision or status actions stay in view (rule of 2026-10-30). */}
      {selected && isAdmin && selected.status === 'PENDING' && (
        <PageActionBar
          label={`Decision on ${selected.code}`}
          start={<span className="text-body-sm font-semibold text-ink">{selected.code}</span>}
        >
          <Button variant="danger" onClick={() => setRejecting(true)}>
            Reject
          </Button>
          <Button
            variant="primary"
            loading={deciding}
            loadingLabel="Approving"
            disabled={!selected.verifiedAt}
            onClick={() => void approve(selected)}
          >
            Approve
          </Button>
        </PageActionBar>
      )}
      {selected && isAdmin && (selected.status === 'ACTIVE' || selected.status === 'SUSPENDED') && (
        <PageActionBar
          label={`Status of ${selected.code}`}
          start={<span className="text-body-sm font-semibold text-ink">{selected.code}</span>}
        >
          {selected.status === 'ACTIVE' ? (
            <>
              <Button variant="danger" onClick={() => setStatusAction('close')}>
                Close organization
              </Button>
              <Button variant="secondary" onClick={() => setStatusAction('suspend')}>
                Suspend
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              loading={reactivating}
              loadingLabel="Reactivating"
              onClick={() => void reactivate(selected)}
            >
              Reactivate
            </Button>
          )}
        </PageActionBar>
      )}

      {statusAction && selected && (
        <StatusDialog
          action={statusAction}
          organization={selected}
          onClose={() => setStatusAction(null)}
          onStale={() => void refresh()}
          onDone={() => {
            setStatusAction(null);
            setStatusError(null);
            void refresh();
            showToast(`${selected.code} ${STATUS_ACTION[statusAction].done}.`);
          }}
        />
      )}

      {rejecting && selected && (
        <RejectDialog
          organization={selected}
          onClose={() => setRejecting(false)}
          onDone={(rejected) => {
            setRejecting(false);
            void refresh();
            showToast(`Your request was not accepted: ${rejected.rejectionReason ?? ''}.`);
          }}
        />
      )}
    </section>
  );
};
