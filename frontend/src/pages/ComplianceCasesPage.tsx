import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CASE_TYPE_LABEL,
  complianceCaseKeys,
  caseErrorText,
  COMPLIANCE_PAGE_SIZE,
  openComplianceCase,
  useComplianceCases,
  type ComplianceCase,
  type ComplianceCaseType,
} from '../entities/organization/complianceCases';
import { CaseStatusBadge, CaseTypeBadge } from '../entities/organization/complianceCaseUi';
import { useOrganizations } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Button,
  CollectionView,
  Dialog,
  Field,
  PageHeader,
  Pagination,
  pageInfoOf,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
  type CollectionField,
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

// /t/compliance-cases, screen 3.6 (organizations api-design 28 and 29; UC-63) on CollectionView
// (chapter 06 §9, D-096). TrekLink Staff and Admin list the cases by status tab and open a new one.
export const ComplianceCasesPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [pageNumber, setPageNumber] = useState(1);
  const [opening, setOpening] = useState(false);
  const cases = useComplianceCases(tab === 'ALL' ? undefined : tab, pageNumber);

  const fields: CollectionField<ComplianceCase>[] = [
    {
      key: 'organization',
      label: 'Organization',
      render: (item) => <span className="font-mono">{item.organization.code}</span>,
      text: (item) => item.organization.code,
      compact: true,
    },
    { key: 'type', label: 'Type', render: (item) => <CaseTypeBadge type={item.type} />, text: (item) => CASE_TYPE_LABEL[item.type], compact: true },
    { key: 'evidence', label: 'Evidence', render: (item) => <span className="line-clamp-2">{item.evidence}</span>, text: (item) => item.evidence, hideWithPane: true },
    { key: 'linked', label: 'Linked', render: linkedText, hideWithPane: true },
    {
      key: 'opened',
      label: 'Opened',
      render: (item) => <span className="whitespace-nowrap">{formatDateTime(item.openedAt)}</span>,
      text: (item) => item.openedAt,
      hideWithPane: true,
    },
    { key: 'status', label: 'Status', render: (item) => <CaseStatusBadge status={item.status} />, compact: true },
  ];

  const openButton = (
    <Button variant="primary" onClick={() => setOpening(true)}>
      Open case
    </Button>
  );

  return (
    <section aria-labelledby="cases-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
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
      <TabPanel idPrefix="cases" tabKey={tab} fill>
        <CollectionView<ComplianceCase>
          icon={<ShieldCheck />}
          label="Compliance cases"
          items={cases.data?.items}
          loading={cases.isLoading}
          error={cases.error ? <ErrorState error={cases.error} onRetry={() => void cases.refetch()} /> : undefined}
          itemId={(item) => item.id}
          itemName={(item) => item.code}
          itemTitle={(item) => (
            <Link to={`/t/compliance-cases/${item.id}`} className={`${LINK} inline-flex min-h-6 items-center font-mono`}>
              {item.code}
            </Link>
          )}
          fields={fields}
          noun={{ one: 'case', other: 'cases' }}
          pageInfo={pageInfoOf(cases.data)}
          details={{ href: (item) => `/t/compliance-cases/${item.id}`, hrefLabel: 'Open the case' }}
          emptyState={{ title: 'No compliance cases here.' }}
          resetKey={tab}
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
