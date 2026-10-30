import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchIncident,
  incidentKeys,
  useFleetIncidents,
  type Incident,
} from '../../entities/incident/api';
import {
  authorityReportKeys,
  closeCase,
  fetchDefaultedContracts,
  fetchReportableContract,
  instantOf,
  isReportable,
  REPORTABLE_STATES,
  reportContract,
  reportIncident,
  useAuthorityReports,
  type AuthorityReport,
  type ReportableContract,
  type ReportInput,
} from '../../entities/incident/authorityReports';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, viewerTimeZone } from '../../shared/lib/format';
import { Badge } from '../../shared/ui/Badge';
import { Empty, ErrorState, Loading, Pager } from '../../shared/ui/bits';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { CONTRACT_STATUS, INCIDENT_STATE } from '../../shared/ui/status';
import { useToast } from '../../shared/ui/toastStore';
import { ALERT, LINK, TABLE, TD, TH, WARNING } from '../../shared/ui/styles';

const MSG03 = 'Saved.';
const MSG28 = (state: string) => `This cannot be done while it is ${state}.`;
const REQUIRED = 'Please fill in this field.';
// Screen 8.3 visible copy.
export const REPORT_DISCLAIMER =
  'TrekLink records reports to authorities. It does not coordinate rescue operations.';
const ALREADY_MADE = 'This records a report you have already made.';

export type ReportSubject =
  { kind: 'incident'; incident: Incident } | { kind: 'contract'; contract: ReportableContract };

export type ReportEntry = { kind: 'incident' | 'contract'; id: string };

const subjectLabel = (subject: ReportSubject) =>
  subject.kind === 'incident'
    ? `Incident ${subject.incident.code}, ${INCIDENT_STATE[subject.incident.state].label}`
    : `Contract ${subject.contract.code}, ${CONTRACT_STATUS[subject.contract.status].label}${
        subject.contract.organization ? `, ${subject.contract.organization.legalName}` : ''
      }`;

// The current state of a subject, and whether it may be reported (screen 8.3: an incident UNROUTED
// or ESCALATED, a contract DEFAULTED). Read fresh before the details step opens.
const loadSubject = async (entry: ReportEntry): Promise<ReportSubject> =>
  entry.kind === 'incident'
    ? { kind: 'incident', incident: await fetchIncident(entry.id) }
    : { kind: 'contract', contract: await fetchReportableContract(entry.id) };

const ineligible = (subject: ReportSubject): string | null =>
  subject.kind === 'incident'
    ? isReportable(subject.incident)
      ? null
      : MSG28(INCIDENT_STATE[subject.incident.state].label)
    : subject.contract.status === 'DEFAULTED'
      ? null
      : MSG28(CONTRACT_STATUS[subject.contract.status].label);

// Step 1 of Record report: the subject kind and an eligible record, page by page.
const SubjectSelector: React.FC<{
  onPick: (entry: ReportEntry) => void;
  picking: boolean;
}> = ({ onPick, picking }) => {
  const [kind, setKind] = useState<ReportEntry['kind']>('incident');
  const [pageNumber, setPageNumber] = useState(1);
  const incidents = useFleetIncidents(REPORTABLE_STATES, pageNumber);
  const contracts = useQuery({
    queryKey: ['contracts', 'fleet', 'DEFAULTED', pageNumber] as const,
    queryFn: () => fetchDefaultedContracts(pageNumber),
    enabled: kind === 'contract',
  });
  const list = kind === 'incident' ? incidents : contracts;
  const rows =
    kind === 'incident'
      ? (incidents.data?.items ?? []).map((incident) => ({
          id: incident.id,
          label: `${incident.code}, ${incident.device.assetTag ?? 'Unknown device'}`,
          state: INCIDENT_STATE[incident.state].label,
        }))
      : (contracts.data?.items ?? []).map((contract) => ({
          id: contract.id,
          label: `${contract.code}${contract.organization ? `, ${contract.organization.legalName}` : ''}`,
          state: CONTRACT_STATUS[contract.status].label,
        }));

  return (
    <div className="flex flex-col gap-4">
      <Field id="report-kind" label="Subject kind" required>
        <Select
          id="report-kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ReportEntry['kind']);
            setPageNumber(1);
          }}
        >
          <option value="incident">Incident</option>
          <option value="contract">Defaulted contract</option>
        </Select>
      </Field>
      <p className="text-body-sm text-ink-muted">
        {kind === 'incident'
          ? 'Only unrouted or escalated incidents can be reported.'
          : 'Only defaulted contracts can be reported.'}
      </p>
      {list.isLoading && <Loading />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && (
        <Empty>
          <p>No results match your filters.</p>
        </Empty>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Eligible records">
          {rows.map((row) => (
            <li key={row.id}>
              <Button
                className="w-full justify-between"
                disabled={picking}
                onClick={() => onPick({ kind, id: row.id })}
              >
                <span className="break-words text-left">{row.label}</span>
                <span className="text-body-sm text-ink-muted">{row.state}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.data && (
        <Pager
          pageNumber={list.data.pageNumber}
          totalPages={list.data.totalPages}
          onPage={setPageNumber}
        />
      )}
    </div>
  );
};

const EMPTY_FORM: ReportInput = { agency: '', reference: '', reportedAt: '', note: '' };

// Record report (screen 8.3): at most two steps. An entry from a validated incident or contract
// skips step 1. The submit records a report a person already made; it contacts nobody.
export const ReportDialog: React.FC<{
  entry?: ReportEntry;
  onClose: () => void;
  onSaved?: (subject: ReportSubject) => void;
}> = ({ entry, onClose, onSaved }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [picked, setSubject] = useState<ReportSubject | null>(null);
  const [loadingSubject, setLoadingSubject] = useState(false);
  const [pickError, setSubjectError] = useState<string | null>(null);
  // An entry subject is read fresh when the dialog opens; a pick or a reload replaces it.
  const entered = useQuery({
    queryKey: ['authority-report-subject', entry?.kind, entry?.id] as const,
    queryFn: () => loadSubject(entry!),
    enabled: Boolean(entry),
    gcTime: 0,
  });
  const entryRefusal = !picked && entered.data ? ineligible(entered.data) : null;
  const subject = picked ?? (entered.data && !entryRefusal ? entered.data : null);
  const subjectError =
    pickError ?? entryRefusal ?? (entered.error ? messageOf(entered.error) : null);
  const [form, setForm] = useState<ReportInput>(EMPTY_FORM);
  const [missing, setMissing] = useState<Partial<Record<keyof ReportInput, boolean>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const dirty = Object.values(form).some((value) => Boolean(value?.trim()));

  const pick = async (next: ReportEntry) => {
    setLoadingSubject(true);
    setSubjectError(null);
    try {
      const loaded = await loadSubject(next);
      const refusal = ineligible(loaded);
      if (refusal) setSubjectError(refusal);
      else setSubject(loaded);
    } catch (error) {
      setSubjectError(messageOf(error));
    } finally {
      setLoadingSubject(false);
    }
  };

  // Reload keeps the typed values and rechecks eligibility (MSG36, screen 8.3).
  const reload = async () => {
    if (!subject) return;
    setStale(false);
    setFailure(null);
    const id = subject.kind === 'incident' ? subject.incident.id : subject.contract.id;
    setLoadingSubject(true);
    try {
      const loaded = await loadSubject({ kind: subject.kind, id });
      setSubject(loaded);
      setFailure(ineligible(loaded));
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setLoadingSubject(false);
    }
  };

  const close = () => (dirty && !pending ? setDiscarding(true) : onClose());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subject) return;
    const gaps = {
      agency: !form.agency.trim(),
      reference: !form.reference.trim(),
      reportedAt: !form.reportedAt,
    };
    setMissing(gaps);
    if (Object.values(gaps).some(Boolean)) return;
    const input = {
      ...form,
      agency: form.agency.trim(),
      reference: form.reference.trim(),
      reportedAt: instantOf(form.reportedAt),
    };
    setPending(true);
    setFailure(null);
    setStale(false);
    try {
      if (subject.kind === 'incident') {
        await reportIncident(subject.incident.id, input, subject.incident.version);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: incidentKeys.all }),
          queryClient.invalidateQueries({ queryKey: incidentKeys.detail(subject.incident.id) }),
        ]);
      } else {
        await reportContract(subject.contract.id, input);
      }
      await queryClient.invalidateQueries({ queryKey: authorityReportKeys.all });
      showToast(MSG03);
      onSaved?.(subject);
      onClose();
    } catch (error) {
      // The draft stays; nothing is resubmitted automatically.
      if (error instanceof ApiError && error.errorCode === 'STALE_VERSION') {
        setStale(true);
        setFailure(error.message);
      } else if (error instanceof ApiError && error.errorCode === 'INVALID_STATE_TRANSITION') {
        await reload();
      } else setFailure(messageOf(error));
    } finally {
      setPending(false);
    }
  };

  const set = (key: keyof ReportInput) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMissing((current) => ({ ...current, [key]: false }));
  };

  const footer = discarding ? (
    <>
      <Button variant="ghost" onClick={() => setDiscarding(false)}>
        Keep editing
      </Button>
      <Button variant="danger" onClick={onClose}>
        Discard report
      </Button>
    </>
  ) : subject ? (
    <>
      {!entry && (
        <Button
          variant="ghost"
          onClick={() => {
            setSubject(null);
            setFailure(null);
          }}
          disabled={pending}
        >
          Back
        </Button>
      )}
      <Button variant="ghost" onClick={close} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" form="authority-report-form" loading={pending} disabled={stale}>
        Record report
      </Button>
    </>
  ) : (
    <Button variant="ghost" onClick={close}>
      Cancel
    </Button>
  );

  return (
    <Dialog
      titleId="authority-report-title"
      title="Record authority report"
      description={REPORT_DISCLAIMER}
      onClose={close}
      footer={footer}
      size="lg"
    >
      {discarding && (
        <p role="alert" className={`${WARNING} mb-4`}>
          Discard this report? The values you entered are not saved.
        </p>
      )}
      {subjectError && (
        <p role="alert" className={`${ALERT} mb-4`}>
          {subjectError}
        </p>
      )}
      {!subject && !entry && (
        <SubjectSelector onPick={(next) => void pick(next)} picking={loadingSubject} />
      )}
      {!subject && (loadingSubject || entered.isLoading) && <Loading />}
      {subject && (
        <form
          id="authority-report-form"
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-body font-semibold text-ink">{subjectLabel(subject)}</p>
          <p className="text-body text-ink">{ALREADY_MADE}</p>
          <Field
            id="report-agency"
            label="Agency"
            required
            error={missing.agency ? REQUIRED : undefined}
          >
            <Input
              id="report-agency"
              value={form.agency}
              invalid={missing.agency}
              onChange={(event) => set('agency')(event.target.value)}
            />
          </Field>
          <Field
            id="report-reference"
            label="Authority reference"
            required
            error={missing.reference ? REQUIRED : undefined}
          >
            <Input
              id="report-reference"
              value={form.reference}
              invalid={missing.reference}
              onChange={(event) => set('reference')(event.target.value)}
            />
          </Field>
          <Field
            id="report-at"
            label="Reported at"
            required
            hint={`Your time zone, ${viewerTimeZone()}.${subject.kind === 'incident' ? ' Not in the future.' : ''}`}
            error={missing.reportedAt ? REQUIRED : undefined}
          >
            <Input
              id="report-at"
              type="datetime-local"
              value={form.reportedAt}
              invalid={missing.reportedAt}
              onChange={(event) => set('reportedAt')(event.target.value)}
            />
          </Field>
          <Field id="report-note" label="Note" hint="What was shared with the authority.">
            <Textarea
              id="report-note"
              value={form.note}
              onChange={(event) => set('note')(event.target.value)}
            />
          </Field>
          {failure && (
            <div role="alert" className={`${ALERT} flex flex-wrap items-center gap-3`}>
              <span>{failure}</span>
              {stale && (
                <Button onClick={() => void reload()} loading={loadingSubject}>
                  Reload
                </Button>
              )}
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
};

// Record case closed (screen 8.3): one step, two fields. The linked incident closes only while it is
// still REPORTED; a contract report records the authority's closure time, not a settlement.
export const CloseCaseDialog: React.FC<{ report: AuthorityReport; onClose: () => void }> = ({
  report,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [closedAt, setClosedAt] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: authorityReportKeys.all }),
      ...(report.incidentId
        ? [
            queryClient.invalidateQueries({ queryKey: incidentKeys.all }),
            queryClient.invalidateQueries({ queryKey: incidentKeys.detail(report.incidentId) }),
          ]
        : []),
    ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!closedAt) {
      setMissing(true);
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await closeCase(report.id, instantOf(closedAt), note);
      await refresh();
      showToast(MSG03);
      onClose();
    } catch (error) {
      setFailure(messageOf(error));
      // A closure recorded elsewhere, or a report no longer visible, refreshes the list.
      if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 409))
        void refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      titleId="close-case-title"
      title={`Record case ${report.reference} with ${report.agency} closed?`}
      description={
        report.incidentId
          ? 'A linked incident still reported to the authority moves to Closed. An incident an organization has acknowledged keeps its response.'
          : 'This records when the authority closed its case. The contract is not settled by it.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="close-case-form" loading={pending}>
            Record case closed
          </Button>
        </>
      }
    >
      <form
        id="close-case-form"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field
          id="close-case-at"
          label="Closed at"
          required
          hint={`Your time zone, ${viewerTimeZone()}.`}
          error={missing ? REQUIRED : undefined}
        >
          <Input
            id="close-case-at"
            type="datetime-local"
            value={closedAt}
            invalid={missing}
            onChange={(event) => {
              setClosedAt(event.target.value);
              setMissing(false);
            }}
          />
        </Field>
        <Field
          id="close-case-note"
          label="Closure note"
          hint="The outcome as the authority reported it."
        >
          <Textarea
            id="close-case-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
      </form>
    </Dialog>
  );
};

// The Authority reports tab of /t/incidents (screen 8.3, api-design 11): open cases only by default,
// server order kept (D-059 rule 7), no sort or extra filters.
export const AuthorityReportsPanel: React.FC<{ onViewIncident: (id: string) => void }> = ({
  onViewIncident,
}) => {
  const [openOnly, setOpenOnly] = useState(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [recording, setRecording] = useState(false);
  const [closing, setClosing] = useState<AuthorityReport | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useAuthorityReports(openOnly, pageNumber);

  return (
    <section aria-labelledby="authority-reports-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="authority-reports-title" tabIndex={-1} className="text-title-sm text-ink">
          Authority reports
        </h2>
        <Button variant="primary" onClick={() => setRecording(true)}>
          Record report
        </Button>
      </div>
      <p className={WARNING}>{REPORT_DISCLAIMER}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Checkbox
          label="Open cases only"
          checked={openOnly}
          onChange={(event) => {
            setOpenOnly(event.target.checked);
            setPageNumber(1);
          }}
        />
        <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
          Refresh
        </Button>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <Empty>
          <p>{openOnly ? 'No open authority cases.' : 'No authority reports recorded.'}</p>
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Subject</th>
                  <th className={TH}>Agency</th>
                  <th className={TH}>Reference</th>
                  <th className={TH}>Reported</th>
                  <th className={TH}>Case</th>
                  <th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((report) => (
                  <tr key={report.id}>
                    <td className={TD}>
                      {report.incidentId ? (
                        <button
                          type="button"
                          className={LINK}
                          onClick={() => onViewIncident(report.incidentId!)}
                        >
                          View incident
                        </button>
                      ) : (
                        <Link to={`/t/contracts/${report.contractId}`} className={LINK}>
                          View contract
                        </Link>
                      )}
                    </td>
                    <td className={`${TD} break-words`}>{report.agency}</td>
                    <td className={`${TD} break-all`}>{report.reference}</td>
                    <td className={TD}>{formatDateTime(report.reportedAt)}</td>
                    <td className={TD}>
                      {report.caseClosedAt ? (
                        <Badge tone="ended">Closed {formatDateTime(report.caseClosedAt)}</Badge>
                      ) : (
                        <Badge tone="attention">Open</Badge>
                      )}
                    </td>
                    <td className={TD}>
                      {!report.caseClosedAt && (
                        <Button onClick={() => setClosing(report)}>Record case closed</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pageNumber={data.pageNumber} totalPages={data.totalPages} onPage={setPageNumber} />
        </>
      )}

      {recording && <ReportDialog onClose={() => setRecording(false)} />}
      {closing && <CloseCaseDialog report={closing} onClose={() => setClosing(null)} />}
    </section>
  );
};
