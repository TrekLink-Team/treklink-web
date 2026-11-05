import React, { useState } from 'react';
import { z } from 'zod';
import type { FleetIncidentFilters } from '../../entities/incident/api';
import { viewerTimeZone } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Field, Input } from '../../shared/ui/Field';

const localValue = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// API 01 filters only. API 13 always reads the linked episode without query parameters.
export const IncidentFiltersDialog: React.FC<{
  value: FleetIncidentFilters;
  onApply: (value: FleetIncidentFilters) => void;
  onClose: () => void;
}> = ({ value, onApply, onClose }) => {
  const [deviceId, setDeviceId] = useState(value.deviceId ?? '');
  const [from, setFrom] = useState(localValue(value.from));
  const [errors, setErrors] = useState<{ deviceId?: string; from?: string }>({});
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (deviceId.trim() && !z.string().uuid().safeParse(deviceId.trim()).success)
      nextErrors.deviceId = 'Enter a valid device UUID.';
    if (from && !Number.isFinite(new Date(from).getTime()))
      nextErrors.from = 'Enter a valid date and time.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onApply({
      ...(deviceId.trim() ? { deviceId: deviceId.trim() } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
    });
  };
  return (
    <Dialog
      titleId="incident-filters-title"
      title="Filter incidents"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply({})}>Reset filters</Button>
          <Button type="submit" form="incident-filters" variant="primary">
            Apply filters
          </Button>
        </>
      }
    >
      <form id="incident-filters" onSubmit={apply} noValidate className="flex flex-col gap-4">
        <Field
          id="incident-device-id"
          label="Device ID"
          hint="Device UUID, not its asset tag."
          error={errors.deviceId}
        >
          <Input
            id="incident-device-id"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            invalid={Boolean(errors.deviceId)}
            aria-describedby={
              errors.deviceId ? 'incident-device-id-error' : 'incident-device-id-hint'
            }
          />
        </Field>
        <Field
          id="incident-created-from"
          label="Created from"
          hint={`Your time zone: ${viewerTimeZone()}.`}
          error={errors.from}
        >
          <Input
            id="incident-created-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            invalid={Boolean(errors.from)}
            aria-describedby={
              errors.from ? 'incident-created-from-error' : 'incident-created-from-hint'
            }
          />
        </Field>
      </form>
    </Dialog>
  );
};
