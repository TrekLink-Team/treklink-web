import React, { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useContract } from '../../entities/contract/api';
import {
  reportDeviceFault,
  useFaultReports,
  type DeviceFaultReport,
  type RentedDevice,
} from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { Alert, Button, Dialog, Field, Textarea } from '../../shared/ui';
import { ErrorState, Loading } from '../../shared/ui/bits';
import { messageOf } from '../../shared/ui/errors';
import { HolderDialog } from '../ContractActions/HolderDialog';
import { NoticeDialog } from '../ContractActions/NoticeDialog';

const RESOLUTIONS: Record<NonNullable<DeviceFaultReport['resolution']>, string> = {
  REPLACED: 'Device replaced',
  CHECKED_IN: 'Device checked in',
  LOST: 'Loss settled',
  RELEASED: 'Device released',
};

export const FaultHistoryDialog: React.FC<{ device: RentedDevice; onClose: () => void }> = ({
  device,
  onClose,
}) => {
  const id = useId();
  const reports = useFaultReports(device.contract.id);
  const own = reports.data?.filter((report) => report.deviceId === device.deviceId) ?? [];
  return (
    <Dialog
      titleId={id}
      title={`Fault reports for ${device.assetTag}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {reports.isLoading && <Loading label="Loading fault reports" />}
      {reports.error && <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />}
      {reports.data &&
        (own.length ? (
          <ul className="divide-y divide-line">
            {own.map((report) => (
              <li key={report.id} className="space-y-1 py-3">
                <p className="whitespace-pre-wrap break-words">{report.description}</p>
                <p className="text-sm text-ink-muted">
                  Reported {formatDateTime(report.reportedAt)}
                </p>
                <p className="text-sm text-ink-muted">
                  {report.resolvedAt
                    ? `${report.resolution ? RESOLUTIONS[report.resolution] : 'Resolved'} · ${formatDateTime(report.resolvedAt)}`
                    : 'Waiting for TrekLink'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No faults have been reported for this device.</p>
        ))}
    </Dialog>
  );
};

export const ReportFaultDialog: React.FC<{
  device: RentedDevice;
  onClose: () => void;
  onReported: () => void;
}> = ({ device, onClose, onReported }) => {
  const id = useId();
  const [description, setDescription] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [reportedAt, setReportedAt] = useState<string>();
  const report = useMutation({
    mutationFn: () => reportDeviceFault(device.contract.id, device.deviceId, description.trim()),
    onSuccess: onReported,
    onError: (failure) => {
      if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED')
        setFieldError(failure.message);
      if (failure instanceof ApiError && failure.errorCode === 'FAULT_ALREADY_REPORTED') {
        void history
          .refetch()
          .then(({ data }) =>
            setReportedAt(
              data?.find((item) => item.deviceId === device.deviceId && !item.resolvedAt)
                ?.reportedAt,
            ),
          );
      }
    },
  });
  const duplicate =
    report.error instanceof ApiError && report.error.errorCode === 'FAULT_ALREADY_REPORTED';
  const history = useFaultReports(device.contract.id, false);
  const close = () => {
    if (!report.isPending) onClose();
  };
  return (
    <Dialog
      titleId={`${id}-title`}
      title={`Report a fault on ${device.assetTag}`}
      onClose={close}
      description="TrekLink Staff will receive the report."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={report.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            form={id}
            type="submit"
            loading={report.isPending}
            disabled={duplicate}
          >
            Report fault
          </Button>
        </>
      }
    >
      <form
        id={id}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!description.trim()) {
            setFieldError('Describe what is wrong.');
            return;
          }
          report.mutate();
        }}
      >
        {report.error && !fieldError && (
          <Alert tone="error">
            {duplicate
              ? `A fault on ${device.assetTag} is already reported and waits for TrekLink.${reportedAt ? ` Reported ${formatDateTime(reportedAt)}.` : ''}`
              : messageOf(report.error)}
          </Alert>
        )}
        <Field id={`${id}-description`} label="What is wrong" error={fieldError}>
          <Textarea
            id={`${id}-description`}
            rows={4}
            maxLength={1000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setFieldError(undefined);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
};

export const ContractActionDialog: React.FC<{
  device: RentedDevice;
  action: 'holder' | 'notice';
  onClose: () => void;
}> = ({ device, action, onClose }) => {
  const id = useId();
  const contract = useContract(device.contract.id);
  const held = contract.data?.devices.find(
    (item) =>
      item.deviceId === device.deviceId && item.handedOverAt && !item.checkedInAt && !item.lostAt,
  );
  if (contract.data) {
    if (
      action === 'notice' &&
      contract.data.planType === 'MONTHLY' &&
      contract.data.status === 'ACTIVE'
    )
      return <NoticeDialog contract={contract.data} onClose={onClose} />;
    if (action === 'holder' && held && contract.data.status !== 'CLOSED')
      return <HolderDialog contract={contract.data} device={held} onClose={onClose} />;
  }
  return (
    <Dialog
      titleId={id}
      title={action === 'holder' ? 'Label holder' : 'Give notice'}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {contract.isLoading && <Loading label="Loading the contract" />}
      {contract.error && (
        <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />
      )}
      {contract.data && (
        <Alert tone="warning">This action is no longer available on this contract.</Alert>
      )}
    </Dialog>
  );
};
