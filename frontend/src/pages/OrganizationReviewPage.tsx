import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  approveOrganization,
  ORGANIZATION_STATUS_LABELS,
  ORGANIZATION_STATUS_TONES,
  organizationKeys,
  rejectOrganization,
  useOrganizations,
  verifyOrganization,
  type OrganizationReview,
  type OrganizationStatus,
} from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, Empty, ErrorState, Fact, Field, Loading, PageTitle } from '../shared/ui/bits';
import { Dialog } from '../shared/ui/Dialog';
import { invalid } from '../shared/ui/errors';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TAB,
  TABLE,
  TD,
  TH,
} from '../shared/ui/styles';

const TABS: { label: string; status?: OrganizationStatus }[] = [
  { label: 'Pending', status: 'PENDING' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Rejected', status: 'REJECTED' },
  { label: 'All' },
];

const DOCUMENTS = ['Business registration', 'Manager ID card', 'Tour operator licence'];

const messageOf = (failure: unknown) =>
  failure instanceof ApiError
    ? failure.statusCode === 403 || failure.statusCode === 404
      ? 'You do not have access to this.'
      : failure.message
    : 'Something went wrong.';

// The counter verification of api-design 05 (FR-ORG-02, BR-43): both contract terms are required.
const VerifyForm: React.FC<{ organization: OrganizationReview; onSaved: () => void }> = ({
  organization,
  onSaved,
}) => {
  const [method, setMethod] = useState<'IN_PERSON' | 'PHONE'>('IN_PERSON');
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
      <h3 className="font-bold text-slate-900">Counter verification</h3>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Method</legend>
        {(['IN_PERSON', 'PHONE'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="method"
              checked={method === value}
              onChange={() => setMethod(value)}
            />
            {value === 'IN_PERSON' ? 'In person' : 'By phone'}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-semibold text-slate-900">Documents seen</legend>
        {DOCUMENTS.map((document) => (
          <label key={document} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={documents.includes(document)}
              onChange={() => toggle(document)}
            />
            {document}
          </label>
        ))}
      </fieldset>
      <Field id="master-contract" label="Master contract number">
        <input
          id="master-contract"
          className={INPUT}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={nda} onChange={(event) => setNda(event.target.checked)} />
        The master contract includes the signed NDA
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={licence}
          onChange={(event) => setLicence(event.target.checked)}
        />
        The master contract includes the Field Station software licence
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {pending
          ? 'Saving…'
          : organization.verifiedAt
            ? 'Update verification'
            : 'Record verification'}
      </button>
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
    <Dialog titleId="reject-org-title" title={`Reject ${organization.code}?`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          id="reject-org-reason"
          label="Reason shown to the Manager"
          error={error ?? undefined}
        >
          <textarea
            id="reject-org-reason"
            rows={3}
            className="rounded-lg border border-slate-400 p-3"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('reject-org-reason', error ?? undefined)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={pending} className={`${DANGER_BUTTON} flex-1`}>
            {pending ? 'Rejecting…' : 'Reject organization'}
          </button>
          <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON} flex-1`}>
            Keep pending
          </button>
        </div>
      </form>
    </Dialog>
  );
};

// /t/organizations, screen 3.2 (organizations api-design 02, 05 to 07; UC-02, UC-03): Staff and
// Admin work the verification queue, and an Admin approves a verified organization (MSG05, MSG21)
// or rejects it (MSG16).
export const OrganizationReviewPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const organizations = useOrganizations(TABS[tab].status);
  const selected = organizations.data?.items.find((item) => item.id === selectedId) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: organizationKeys.all });

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
    <section aria-labelledby="orgs-title">
      <PageTitle id="orgs-title" title="Organizations" />
      <div role="tablist" aria-label="Status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={tab === index}
            className={TAB(tab === index)}
            onClick={() => {
              setTab(index);
              setSelectedId(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 overflow-x-auto">
          {organizations.isLoading && <Loading label="Loading organizations" />}
          {organizations.error && (
            <ErrorState error={organizations.error} onRetry={() => void organizations.refetch()} />
          )}
          {organizations.data && organizations.data.items.length === 0 && (
            <Empty>No organizations here.</Empty>
          )}
          {organizations.data && organizations.data.items.length > 0 && (
            <table className={TABLE}>
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Code</th>
                  <th className={TH}>Organization</th>
                  <th className={TH}>Registered</th>
                  <th className={TH}>Verified</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {organizations.data.items.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer border-t border-slate-200 hover:bg-slate-50 ${
                      item.id === selectedId ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => {
                      setSelectedId(item.id);
                      setDecisionError(null);
                    }}
                  >
                    <td className={`${TD} font-mono`}>
                      <button
                        type="button"
                        className="font-semibold text-blue-700 hover:underline"
                        onClick={() => setSelectedId(item.id)}
                      >
                        {item.code}
                      </button>
                    </td>
                    <td className={TD}>{item.legalName}</td>
                    <td className={TD}>{formatDateTime(item.createdAt)}</td>
                    <td className={TD}>{item.verifiedAt ? 'Yes' : 'Not yet'}</td>
                    <td className={TD}>
                      <Badge tone={ORGANIZATION_STATUS_TONES[item.status]}>
                        {ORGANIZATION_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <aside aria-label={`${selected.code} details`} className={`${CARD} flex flex-col gap-4`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">{selected.legalName}</h2>
              <Badge tone={ORGANIZATION_STATUS_TONES[selected.status]}>
                {ORGANIZATION_STATUS_LABELS[selected.status]}
              </Badge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Code">{selected.code}</Fact>
              <Fact label="Tax code">{selected.taxCode}</Fact>
              <Fact label="Address">{selected.address}</Fact>
              <Fact label="Contact">
                {selected.contactEmail}, {selected.contactPhone}
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
                {isAdmin && (
                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
                    <h3 className="font-bold text-slate-900">Decision</h3>
                    {!selected.verifiedAt && (
                      <p className="text-sm text-slate-700">
                        Verify this organization at the counter before approving it.
                      </p>
                    )}
                    {decisionError && (
                      <div role="alert" className={ALERT}>
                        {decisionError}
                      </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className={`${PRIMARY_BUTTON} flex-1`}
                        disabled={deciding || !selected.verifiedAt}
                        onClick={() => void approve(selected)}
                      >
                        {deciding ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className={`${DANGER_BUTTON} flex-1`}
                        onClick={() => setRejecting(true)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>

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
