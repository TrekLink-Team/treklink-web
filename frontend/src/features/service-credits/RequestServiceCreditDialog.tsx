import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  requestServiceCredit,
  serviceCreditKeys,
  SERVICE_CREDIT_CAUSES,
  type ServiceCreditCause,
} from '../../entities/billing/api';
import { contractKeys, type ContractDevice } from '../../entities/contract/api';
import { useFaultReports } from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { Alert, Button, Dialog, Field, Input, Select, Textarea, useToast } from '../../shared/ui';

const MAX_NOTE = 500;

const manualStartError = (value: string, date: Date): string | undefined => {
  if (value === '') return 'Outage start is required.';
  if (Number.isNaN(date.getTime())) return 'Enter a valid outage start.';
  if (date.getTime() > Date.now()) return 'The outage start cannot be in the future.';
  return undefined;
};

// The request of screen 6.5 (billing api-design 18, REQ-EVT-12): from a device row of /t/contracts/:id
// that is back with a FAILED inspection. Staff give the cause, the outage start and its source; the
// outage end is computed by the server.
export const RequestServiceCreditDialog: React.FC<{
  contractId: string;
  device: ContractDevice;
  onClose: () => void;
}> = ({ contractId, device, onClose }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [cause, setCause] = useState<ServiceCreditCause | ''>('');
  const [outageFrom, setOutageFrom] = useState('');
  const [note, setNote] = useState('');
  const [reportId, setReportId] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);
  const tag = device.assetTag ?? device.deviceId;
  const inspection = device.inspection;
  const reports = useFaultReports(contractId, Boolean(device.contractDeviceId));
  const eligibleReports =
    reports.data?.filter((report) => report.contractDeviceId === device.contractDeviceId) ?? [];
  const selectedReport = eligibleReports.find((report) => report.id === reportId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!cause) found.cause = 'Choose a cause.';
    const manualStart = new Date(outageFrom);
    if (reportId) {
      if (!selectedReport) found.reportId = 'Choose an available fault report or enter a note.';
    } else {
      const dateError = manualStartError(outageFrom, manualStart);
      if (dateError) found.outageFrom = dateError;
      if (note.trim() === '') found.note = 'Say how the fault was reported, and when.';
      else if (note.trim().length > MAX_NOTE) found.note = `At most ${MAX_NOTE} characters.`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !cause || !inspection || !device.contractDeviceId) return;
    setPending(true);
    try {
      await requestServiceCredit(contractId, {
        contractDeviceId: device.contractDeviceId,
        cause,
        faultInspectionId: inspection.id,
        ...(selectedReport
          ? { outageSourceFaultReportId: selectedReport.id }
          : { outageFrom: manualStart.toISOString(), outageSourceNote: note.trim() }),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all }),
        queryClient.invalidateQueries({ queryKey: contractKeys.detail(contractId) }),
      ]);
      showToast('Service credit requested.');
      onClose();
    } catch (failure) {
      setPending(false);
      const message =
        failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
      const outageField =
        failure instanceof ApiError &&
        (failure.errorCode === 'DUPLICATE_CREDIT' || /outage start/i.test(failure.message));
      setErrors(outageField ? { [reportId ? 'reportId' : 'outageFrom']: message } : { form: message });
    }
  };

  return (
    <Dialog
      titleId="request-credit-title"
      title={`Request a service credit for ${tag}`}
      description="The outage ends at the replacement's handover, the check-in or the term end, whichever comes first."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="request-credit-form" variant="primary" loading={pending}>
            Request
          </Button>
        </>
      }
    >
      <form id="request-credit-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <Field id="credit-cause" label="Cause" error={errors.cause} required>
          <Select
            id="credit-cause"
            value={cause}
            onChange={(event) => setCause(event.target.value as ServiceCreditCause | '')}
          >
            <option value="">Choose a cause</option>
            {SERVICE_CREDIT_CAUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        {reports.isLoading && <p role="status">Loading fault reports.</p>}
        {reports.isError && (
          <Alert tone="info">Fault reports could not be loaded. You can still enter a note.</Alert>
        )}
        {(eligibleReports.length > 0 || reportId) && (
          <Field id="credit-report" label="Fault report" error={errors.reportId}>
            <Select
              id="credit-report"
              value={reportId}
              invalid={Boolean(errors.reportId)}
              aria-describedby={errors.reportId ? 'credit-report-error' : undefined}
              onChange={(event) => {
                setReportId(event.target.value);
                setErrors({});
              }}
            >
              <option value="">Enter a note instead</option>
              {reportId && !selectedReport && <option value={reportId}>Report unavailable</option>}
              {eligibleReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDateTime(report.reportedAt)} ({report.resolvedAt ? 'Resolved' : 'Open'})
                  {' · '}{report.description.replace(/\s+/g, ' ').slice(0, 80)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {selectedReport && (
          <p className="break-words text-body-sm text-ink-muted">
            Outage start: {formatDateTime(selectedReport.reportedAt)}. {selectedReport.description}
          </p>
        )}
        {!reportId && (
          <>
            <Field
              id="credit-outage-from"
              label="Outage start"
              hint="When the organization reported the fault."
              error={errors.outageFrom}
              required
            >
              <Input
                id="credit-outage-from"
                type="datetime-local"
                value={outageFrom}
                onChange={(event) => setOutageFrom(event.target.value)}
              />
            </Field>
            <Field id="credit-note" label="Source of the start" error={errors.note} required>
              <Textarea
                id="credit-note"
                rows={3}
                placeholder="The trek leader called the counter at 09:00"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </>
        )}
        {inspection && (
          <p className="text-body-sm text-ink-muted">
            Fault record: the failed inspection of {formatDateTime(inspection.at)}.
          </p>
        )}
      </form>
    </Dialog>
  );
};
