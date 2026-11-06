import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  createVariant,
  updateVariant,
  type AdminVariant,
  type VariantInput,
} from '../../entities/variant/api';
import { VariantCard } from '../../entities/variant/VariantCard';
import { SPEC_KEYS } from '../../entities/variant/spec';
import { ApiError } from '../../shared/api/apiClient';
import { Alert, Button, Checkbox, Dialog, Field, IconButton, Input, MoneyInput } from '../../shared/ui';
import { invalid } from '../../shared/ui/errors';
import { variantErrorsOf } from './variantErrors';

type Errors = Record<string, string | undefined>;

interface ScheduleText {
  fromMonths: string;
  valueVnd: string;
}

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FIXED_NOTE = 'Fixed while units are registered';
const MEDIA_HINT = 'Use an https link or /variants/<file>.';

// The schedule and service plan rules of devices design section 11, checked here first so most mistakes
// show before a round trip; the server stays the judge (SCHEDULE_INVALID, CHECKLIST_REQUIRED).
const scheduleError = (rows: ScheduleText[]): string | undefined => {
  if (rows.length === 0) return 'Add at least one row, starting at month 0.';
  const parsed = rows.map((row) => ({
    fromMonths: Number(row.fromMonths),
    valueVnd: Number(row.valueVnd.replace(/[,\s]/g, '')),
  }));
  const whole = (value: number) => Number.isInteger(value) && value >= 0;
  if (parsed.some((row) => !whole(row.fromMonths) || !whole(row.valueVnd))) {
    return 'Months and values are whole numbers, 0 or more.';
  }
  if (parsed[0].fromMonths !== 0) return 'The first row starts at month 0.';
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].fromMonths <= parsed[i - 1].fromMonths) return 'Months increase from row to row.';
    if (parsed[i].valueVnd > parsed[i - 1].valueVnd) return 'Values descend with age.';
  }
  return undefined;
};

interface Props {
  // The variant to edit, or undefined to create one.
  variant?: AdminVariant;
  onClose: () => void;
  onSaved: (variant: AdminVariant) => void;
}

// The create and edit form of screen 4.1 (devices api-design 02 and 03): identity and sensors, firmware
// and service plan, remaining value schedule, then the image link and the spec sheet with a live card
// preview. Full screen at 360 px with the buttons fixed at the bottom (Dialog).
export const VariantFormDialog: React.FC<Props> = ({ variant, onClose, onSaved }) => {
  const editing = variant !== undefined;
  const fixed = editing && variant.deviceCount > 0;
  const [code, setCode] = useState(variant?.code ?? '');
  const [name, setName] = useState(variant?.name ?? '');
  const [hasGps, setHasGps] = useState(variant?.hasGps ?? true);
  const [hasMotionSensor, setHasMotionSensor] = useState(variant?.hasMotionSensor ?? false);
  const [mqttCapable, setMqttCapable] = useState(variant?.mqttCapable ?? true);
  const [firmwareBaseline, setFirmwareBaseline] = useState(variant?.firmwareBaseline ?? '');
  const [serviceDays, setServiceDays] = useState(
    variant?.serviceIntervalDays != null ? String(variant.serviceIntervalDays) : '',
  );
  const [checklist, setChecklist] = useState<string[]>(
    variant?.serviceChecklist.length ? variant.serviceChecklist : [''],
  );
  const [schedule, setSchedule] = useState<ScheduleText[]>(
    variant?.remainingValueSchedule.map((row) => ({
      fromMonths: String(row.fromMonths),
      valueVnd: String(row.valueVnd),
    })) ?? [{ fromMonths: '0', valueVnd: '' }],
  );
  const [imageUrl, setImageUrl] = useState(variant?.imageUrl ?? '');
  const [spec, setSpec] = useState<Record<string, string>>(() => ({ ...(variant?.specSheet ?? {}) }));
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const items = checklist.map((item) => item.trim()).filter((item) => item !== '');
  const specSheet = Object.fromEntries(
    SPEC_KEYS.map(([key]) => [key, (spec[key] ?? '').trim()]).filter(([, value]) => value !== ''),
  );

  const check = (): Errors => {
    const found: Errors = {};
    if (!editing && !CODE_PATTERN.test(code.trim())) {
      found.code = 'Use lower case letters, digits and hyphens, for example treklink-v5.';
    }
    if (name.trim() === '') found.name = 'Name is required.';
    else if (name.trim().length > 80) found.name = 'Name is up to 80 characters.';
    if (firmwareBaseline.trim() === '') found.firmwareBaseline = 'Firmware baseline is required.';
    if (serviceDays.trim() !== '') {
      const days = Number(serviceDays);
      if (!Number.isInteger(days) || days < 1) found.serviceIntervalDays = 'Use a whole number of days.';
      else if (items.length === 0) found.checklist = 'A service interval needs at least one checklist item.';
    }
    if (items.some((item) => item.length > 120)) found.checklist = 'Each item is up to 120 characters.';
    const scheduleProblem = scheduleError(schedule);
    if (scheduleProblem) found.schedule = scheduleProblem;
    for (const [key, label] of SPEC_KEYS) {
      if ((spec[key] ?? '').trim().length > 80) found[`spec-${key}`] = `${label} is up to 80 characters.`;
    }
    return found;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const input: VariantInput = {
      name: name.trim(),
      hasGps,
      hasMotionSensor,
      mqttCapable,
      firmwareBaseline: firmwareBaseline.trim(),
      remainingValueSchedule: schedule.map((row) => ({
        fromMonths: Number(row.fromMonths),
        valueVnd: Number(row.valueVnd.replace(/[,\s]/g, '')),
      })),
      serviceIntervalDays: serviceDays.trim() === '' ? null : Number(serviceDays),
      serviceChecklist: items,
      imageUrl: imageUrl.trim() === '' ? null : imageUrl.trim(),
      specSheet,
    };
    setPending(true);
    try {
      if (editing) {
        // The sensor flags are left out while units are registered (REQ-STA-02).
        const body: Partial<VariantInput> = { ...input };
        if (fixed) {
          delete body.hasGps;
          delete body.hasMotionSensor;
          delete body.mqttCapable;
        }
        onSaved(await updateVariant(variant.id, { ...body, expectedVersion: variant.version }));
      } else {
        onSaved(await createVariant({ ...input, code: code.trim() }));
      }
    } catch (failure) {
      setPending(false);
      setErrors(
        failure instanceof ApiError && failure.errorCode === 'STALE_VERSION'
          ? { form: `${failure.message} Close this form to load the current values.` }
          : variantErrorsOf(failure),
      );
    }
  };

  const title = editing ? `Edit ${variant.code}` : 'New hardware variant';
  const preview = {
    name: name.trim() || 'New variant',
    imageUrl: imageUrl.trim() === '' ? null : imageUrl.trim(),
    specSheet,
    hasGps,
    hasMotionSensor,
    mqttCapable,
    firmwareBaseline: firmwareBaseline.trim() || undefined,
  };

  return (
    <Dialog
      titleId="variant-form-title"
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="variant-form" variant="primary" loading={pending} className="min-h-11">
            Save
          </Button>
        </>
      }
    >
      <form id="variant-form" noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-title-sm text-ink">1. Variant and sensors</legend>
          {editing ? (
            <div className="flex flex-col gap-1">
              <span className="text-body-sm font-semibold text-ink">Code</span>
              <span className="text-body text-ink">{variant.code}</span>
            </div>
          ) : (
            <Field id="variant-code" label="Code" required hint="For example treklink-v5" error={errors.code}>
              <Input
                id="variant-code"
                value={code}
                autoComplete="off"
                onChange={(event) => setCode(event.target.value)}
                {...invalid('variant-code', errors.code)}
              />
            </Field>
          )}
          <Field id="variant-name" label="Name" required error={errors.name}>
            <Input
              id="variant-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              {...invalid('variant-name', errors.name)}
            />
          </Field>
          {fixed ? (
            <div className="flex flex-col gap-1">
              <span className="text-body-sm font-semibold text-ink">Sensors</span>
              <span className="text-body text-ink">
                GPS {variant.hasGps ? 'yes' : 'no'}, motion sensor {variant.hasMotionSensor ? 'yes' : 'no'}, MQTT{' '}
                {variant.mqttCapable ? 'yes' : 'no'}
              </span>
              <span className="text-body-sm text-ink-muted">{FIXED_NOTE}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              <Checkbox label="GPS" checked={hasGps} onChange={(event) => setHasGps(event.target.checked)} />
              <Checkbox
                label="Motion sensor"
                description="Adds the motion row to the intake check"
                checked={hasMotionSensor}
                onChange={(event) => setHasMotionSensor(event.target.checked)}
              />
              <Checkbox
                label="MQTT capable"
                checked={mqttCapable}
                onChange={(event) => setMqttCapable(event.target.checked)}
              />
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-title-sm text-ink">2. Firmware and service plan</legend>
          <Field
            id="variant-baseline"
            label="Firmware baseline"
            required
            hint="For example 2.7.19-treklink.4. The weekly service scan flags units on another version."
            error={errors.firmwareBaseline}
          >
            <Input
              id="variant-baseline"
              value={firmwareBaseline}
              onChange={(event) => setFirmwareBaseline(event.target.value)}
              {...invalid('variant-baseline', errors.firmwareBaseline)}
            />
          </Field>
          <Field
            id="variant-interval"
            label="Service interval, days"
            hint="Empty means no periodic service."
            error={errors.serviceIntervalDays}
          >
            <Input
              id="variant-interval"
              inputMode="numeric"
              value={serviceDays}
              onChange={(event) => setServiceDays(event.target.value)}
              {...invalid('variant-interval', errors.serviceIntervalDays)}
            />
          </Field>
          <div role="group" aria-labelledby="variant-checklist-label" className="flex flex-col gap-2">
            <span id="variant-checklist-label" className="text-body-sm font-semibold text-ink">
              Service checklist
            </span>
            {checklist.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Checklist item ${index + 1}`}
                  value={item}
                  maxLength={120}
                  onChange={(event) =>
                    setChecklist((rows) => rows.map((row, at) => (at === index ? event.target.value : row)))
                  }
                />
                <IconButton
                  label={`Remove checklist item ${index + 1}`}
                  icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                  size="lg"
                  className="shrink-0"
                  onClick={() => setChecklist((rows) => rows.filter((_, at) => at !== index))}
                />
              </div>
            ))}
            {errors.checklist && (
              <p role="alert" className="text-body-sm font-medium text-status-critical-fg">
                {errors.checklist}
              </p>
            )}
            <Button
              className="self-start"
              icon={<Plus aria-hidden="true" className="h-4 w-4" />}
              onClick={() => setChecklist((rows) => [...rows, ''])}
            >
              Add checklist item
            </Button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-title-sm text-ink">3. Remaining value schedule</legend>
          <p className="text-body-sm text-ink-muted">
            Used for loss charges: the value of a unit by its age in months. The first row starts at month 0
            and values descend with age.
          </p>
          {schedule.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <Field id={`schedule-months-${index}`} label="From month" className="w-28">
                <Input
                  id={`schedule-months-${index}`}
                  inputMode="numeric"
                  value={row.fromMonths}
                  onChange={(event) =>
                    setSchedule((rows) =>
                      rows.map((item, at) => (at === index ? { ...item, fromMonths: event.target.value } : item)),
                    )
                  }
                />
              </Field>
              <Field id={`schedule-value-${index}`} label="Value, VND" className="min-w-0 flex-1">
                <MoneyInput
                  id={`schedule-value-${index}`}
                  label={`Value from month ${row.fromMonths || index}`}
                  value={row.valueVnd}
                  onValueChange={(digits) =>
                    setSchedule((rows) =>
                      rows.map((item, at) => (at === index ? { ...item, valueVnd: digits } : item)),
                    )
                  }
                />
              </Field>
              <IconButton
                label={`Remove schedule row ${index + 1}`}
                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                size="lg"
                className="shrink-0"
                disabled={schedule.length === 1}
                onClick={() => setSchedule((rows) => rows.filter((_, at) => at !== index))}
              />
            </div>
          ))}
          {errors.schedule && (
            <p role="alert" className="text-body-sm font-medium text-status-critical-fg">
              {errors.schedule}
            </p>
          )}
          <Button
            className="self-start"
            icon={<Plus aria-hidden="true" className="h-4 w-4" />}
            onClick={() => setSchedule((rows) => [...rows, { fromMonths: '', valueVnd: '' }])}
          >
            Add schedule row
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-title-sm text-ink">Image and spec sheet</legend>
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Field id="variant-image" label="Image link" hint={MEDIA_HINT} error={errors.imageUrl}>
                <Input
                  id="variant-image"
                  value={imageUrl}
                  placeholder="/variants/treklink-v5-detail.png"
                  onChange={(event) => setImageUrl(event.target.value)}
                  {...invalid('variant-image', errors.imageUrl)}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {SPEC_KEYS.map(([key, label]) => (
                  <Field key={key} id={`spec-${key}`} label={label} error={errors[`spec-${key}`]}>
                    <Input
                      id={`spec-${key}`}
                      value={spec[key] ?? ''}
                      maxLength={80}
                      onChange={(event) => setSpec((sheet) => ({ ...sheet, [key]: event.target.value }))}
                      {...invalid(`spec-${key}`, errors[`spec-${key}`])}
                    />
                  </Field>
                ))}
              </div>
            </div>
            <div className="md:w-64 md:shrink-0" aria-label="Card preview" role="group">
              <VariantCard variant={preview} render="detail" headingLevel="h3" />
            </div>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
};
