import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CASE_TYPE_LABEL,
  complianceCaseKeys,
  COMPLIANCE_PAGE_SIZE,
  openComplianceCase,
  useComplianceCases,
  type ComplianceCase,
  type ComplianceCaseStatus,
  type ComplianceCaseType,
} from '../entities/organization/complianceCases';
import { useOrganizations } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDate, formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Pagination,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

type Tab = 'OPEN' | 'CLOSED' | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'All' },
];

const TYPES = Object.keys(CASE_TYPE_LABEL) as ComplianceCaseType[];

export const CaseStatusBadge: React.FC<{ status: ComplianceCaseStatus }> = ({ status }) =>
  status === 'OPEN' ? <Badge tone="active">Open</Badge> : <Badge tone="ended">Closed</Badge>;

export const CaseTypeBadge: React.FC<{ type: ComplianceCaseType }> = ({ type }) => (
  <Badge>{CASE_TYPE_LABEL[type]}</Badge>
);

// "1 contract, 1 loss case", or "none" (SD 3.6 Data).
const linkedText = (item: ComplianceCase) => {
  const parts = [
    item.linkedContractIds.length > 0 &&
      `${item.linkedContractIds.length} contract${item.linkedContractIds.length === 1 ? '' : 's'}`,
    item.linkedLossCases.length > 0 &&
      `${item.linkedLossCases.length} loss case${item.linkedLossCases.length === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'none';
};

// NOT_FOUND names the missing record; other 403 and 404 answers read MSG26 (SD 3.6 States).
export const caseErrorText = (failure: unknown): string =>
  failure instanceof ApiError && failure.errorCode === 'NOT_FOUND' ? failure.message : messageOf(failure);

// The open case dialog of api-design 29. Linked contracts and loss cases are not offered: no Staff
// list of an organization's contracts or loss cases exists yet (SD 3.6 open point 5).
const OpenCaseDialog: React.FC<{
  onOpened: (opened: ComplianceCase) => void;
  onClose: () => void;
}> = ({ onOpened, onClose }) => {
  const organizations = useOrganizations(undefined);
  const choices = organizations.data?.items.filter((item) => item.status !== 'CLOSED') ?? [];
  const [organizationId, setOrganizationId] = useState('');
  const [type, setType] = useState<ComplianceCaseType | ''>('');
  const [evidence, setEvidence] = useState('');
  const [errors, setErrors] = useState<{ organization?: string; type?: string; evidence?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const missing = {
      organization: organizationId === '' ? 'Organization is required.' : undefined,
      type: type === '' ? 'Type is required.' : undefined,
      evidence: evidence.trim() === '' ? 'Evidence is required.' : undefined,
    };
    setErrors(missing);
    if (missing.organization || missing.type || missing.evidence || type === '') return;
    setPending(true);
    setError(null);
    try {
      onOpened(
        await openComplianceCase(organizationId, {
          type,
          evidence: evidence.trim(),
          linkedContractIds: [],
          linkedLossCaseIds: [],
        }),
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED') {
        const lower = failure.message.toLowerCase();
        if (lower.startsWith('evidence')) setErrors({ evidence: failure.message });
        else if (lower.startsWith('type')) setErrors({ type: failure.message });
        else setError(failure.message);
      } else setError(caseErrorText(failure));
    }
  };

  return (
    <Dialog
      titleId="open-case-title"
      title="Open compliance case"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Opening" onClick={() => void submit()}>
            Open case
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="case-organization" label="Organization" error={errors.organization} required>
          <Select
            id="case-organization"
            value={organizationId}
            disabled={organizations.isLoading}
            onChange={(event) => setOrganizationId(event.target.value)}
            {...invalid('case-organization', errors.organization)}
          >
            <option value="">{organizations.isLoading ? 'Loading organizations' : 'Choose an organization'}</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}, {item.legalName}
              </option>
            ))}
          </Select>
        </Field>
        {organizations.error && <Alert tone="error">{messageOf(organizations.error)}</Alert>}
        <Field id="case-type" label="Type" error={errors.type} required>
          <Select
            id="case-type"
            value={type}
            onChange={(event) => setType(event.target.value as ComplianceCaseType | '')}
            {...invalid('case-type', errors.type)}
          >
            <option value="">Choose a type</option>
            {TYPES.map((key) => (
              <option key={key} value={key}>
                {CASE_TYPE_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="case-evidence" label="Evidence" error={errors.evidence} required>
          <Textarea
            id="case-evidence"
            rows={4}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            {...invalid('case-evidence', errors.evidence)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// /t/compliance-cases, screen 3.6 (organizations api-design 28 and 29; UC-63). TrekLink Staff and
// Admin list the cases by status and open a new one.
export const ComplianceCasesPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [pageNumber, setPageNumber] = useState(1);
  const [opening, setOpening] = useState(false);
  const cases = useComplianceCases(tab === 'ALL' ? undefined : tab, pageNumber);

  const columns: Column<ComplianceCase>[] = [
    {
      key: 'code',
      header: 'Code',
      cell: (item) => (
        <Link to={`/t/compliance-cases/${item.id}`} className={`${LINK} font-mono`}>
          {item.code}
        </Link>
      ),
    },
    { key: 'organization', header: 'Organization', cell: (item) => <span className="font-mono">{item.organization.code}</span> },
    { key: 'type', header: 'Type', cell: (item) => <CaseTypeBadge type={item.type} /> },
    { key: 'evidence', header: 'Evidence', cell: (item) => item.evidence, truncate: (item) => item.evidence },
    { key: 'linked', header: 'Linked', cell: linkedText },
    { key: 'opened', header: 'Opened', cell: (item) => <span className="whitespace-nowrap">{formatDateTime(item.openedAt)}</span> },
    { key: 'status', header: 'Status', cell: (item) => <CaseStatusBadge status={item.status} /> },
  ];

  const openButton = (
    <Button variant="primary" onClick={() => setOpening(true)}>
      Open case
    </Button>
  );

  return (
    <section aria-labelledby="cases-title">
      <PageHeader
        id="cases-title"
        title="Compliance cases"
        meta={cases.data ? `${cases.data.totalCount} ${cases.data.totalCount === 1 ? 'case' : 'cases'}` : undefined}
        primaryAction={openButton}
      />
      <Tabs
        label="Status"
        idPrefix="cases"
        items={TABS}
        value={tab}
        onChange={(key) => {
          setTab(key);
          setPageNumber(1);
        }}
        className="mb-4"
      />
      <TabPanel idPrefix="cases" tabKey={tab}>
        <DataTable
          caption="Compliance cases"
          columns={columns}
          rows={cases.data?.items}
          rowId={(item) => item.id}
          loading={cases.isLoading}
          error={cases.error ? <ErrorState error={cases.error} onRetry={() => void cases.refetch()} /> : undefined}
          empty={{ title: 'No compliance cases here.' }}
          renderCard={(item) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/t/compliance-cases/${item.id}`} className={`${LINK} font-mono`}>
                  {item.code}
                </Link>
                <CaseStatusBadge status={item.status} />
              </div>
              <p className="font-mono text-body-sm text-ink">{item.organization.code}</p>
              <CaseTypeBadge type={item.type} />
              <p className="text-body-sm text-ink-muted">Opened {formatDate(item.openedAt)}</p>
            </div>
          )}
          footer={
            cases.data && cases.data.totalPages > 1 ? (
              <Pagination
                pageNumber={cases.data.pageNumber}
                totalPages={cases.data.totalPages}
                totalItems={cases.data.totalCount}
                pageSize={cases.data.pageSize || COMPLIANCE_PAGE_SIZE}
                onPage={setPageNumber}
              />
            ) : undefined
          }
        />
      </TabPanel>

      {opening && (
        <OpenCaseDialog
          onClose={() => setOpening(false)}
          onOpened={(opened) => {
            setOpening(false);
            queryClient.setQueryData(complianceCaseKeys.detail(opened.id), opened);
            void queryClient.invalidateQueries({ queryKey: complianceCaseKeys.all });
            showToast('Compliance case opened');
            navigate(`/t/compliance-cases/${opened.id}`, { state: { focusHeading: true } });
          }}
        />
      )}
    </section>
  );
};
