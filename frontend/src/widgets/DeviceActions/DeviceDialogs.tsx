import React, { useState } from 'react';
import {
  disposeDevice,
  recordIntakeCheck,
  recordReset,
  useVariants,
  type Device,
} from '../../entities/device/api';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Checkbox, Field, Input, Switch, Textarea } from '../../shared/ui/Field';
import { ALERT } from '../../shared/ui/styles';
import { deviceFailure } from './deviceFailure';

// The data-entry dialogs of a device's lifecycle (screen 4.2), shared by the device page and the
// fleet table's row actions: the intake check (devices api-design 09), the reset (api-design 10) and
// the disposal (api-design 23). Retirement needs a reason only, so it is a StateChangeDialog.

export const IntakeDialog: React.FC<{ device: Device; onDone: () => void; onCancel: () => void }> = ({
  device,
  onDone,
  onCancel,
}) => {
  const { data: variants } = useVariants(true);
  const hasMotion = variants?.find((variant) => variant.id === device.hardwareVariant.id)?.hasMotionSensor;
  const [gpsFixOk, setGpsFixOk] = useState(true);
  const [radioOk, setRadioOk] = useState(true);
  const [batteryOk, setBatteryOk] = useState(true);
  const [motionOk, setMotionOk] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await recordIntakeCheck(device.id, {
        gpsFixOk,
        radioOk,
        batteryOk,
        ...(hasMotion ? { motionOk } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        expectedVersion: device.version,
      });
      onDone();
      return result;
    } catch (failure) {
      setPending(false);
      setError(deviceFailure(failure, device.status));
    }
  };

  return (
    <Dialog titleId="intake-title" title="Record intake check" onClose={onCancel} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
        <Switch id="intake-gps" label="GPS fix" checked={gpsFixOk} onChange={setGpsFixOk} />
        <Switch id="intake-radio" label="Radio" checked={radioOk} onChange={setRadioOk} />
        <Switch id="intake-battery" label="Battery" checked={batteryOk} onChange={setBatteryOk} />
        {hasMotion && <Switch id="intake-motion" label="Motion sensor" checked={motionOk} onChange={setMotionOk} />}
        <div className="mt-3">
          <Field id="intake-note" label="Note" hint="Up to 500 characters">
            <Textarea
              id="intake-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className={`${ALERT} mt-3`}>
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const NO_STEPS = { key: false, node: false, owner: false };

// devices api-design 10: the three steps are ticked before Save enables.
export const ResetDialog: React.FC<{ device: Device; onDone: () => void; onCancel: () => void }> = ({
  device,
  onDone,
  onCancel,
}) => {
  const [checked, setChecked] = useState(NO_STEPS);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = checked.key && checked.node && checked.owner;

  const submit = async () => {
    setFailure(null);
    setPending(true);
    try {
      await recordReset(device.id);
      onDone();
    } catch (error) {
      setPending(false);
      setFailure(deviceFailure(error, device.status));
    }
  };

  return (
    <Dialog titleId="reset-title" title="Record reset" description={device.assetTag} onClose={onCancel} size="sm">
      <div className="flex flex-col gap-1">
        <Checkbox
          label="Key removed"
          checked={checked.key}
          onChange={(event) => setChecked((prev) => ({ ...prev, key: event.target.checked }))}
        />
        <Checkbox
          label="Node database cleared"
          checked={checked.node}
          onChange={(event) => setChecked((prev) => ({ ...prev, node: event.target.checked }))}
        />
        <Checkbox
          label="Owner cleared"
          checked={checked.owner}
          onChange={(event) => setChecked((prev) => ({ ...prev, owner: event.target.checked }))}
        />
        {failure && (
          <p role="alert" className={`${ALERT} mt-2`}>
            {failure}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={pending} onClick={() => void submit()}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

// devices api-design 23: the verified wipe and its method; the server refuses a step left false.
export const DisposeDialog: React.FC<{ device: Device; onDone: () => void; onCancel: () => void }> = ({
  device,
  onDone,
  onCancel,
}) => {
  const [checked, setChecked] = useState(NO_STEPS);
  const [method, setMethod] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = checked.key && checked.node && checked.owner;

  const submit = async () => {
    if (!method.trim()) {
      setFailure('Please fill in this field.');
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await disposeDevice(
        device.id,
        { keyRemoved: checked.key, nodeDbCleared: checked.node, ownerCleared: checked.owner },
        method.trim(),
        device.version,
      );
      onDone();
    } catch (error) {
      setPending(false);
      setFailure(deviceFailure(error, device.status));
    }
  };

  return (
    <Dialog titleId="dispose-title" title={`Dispose of ${device.assetTag}?`} role="alertdialog" onClose={onCancel} size="sm">
      <div className="flex flex-col gap-1">
        <Checkbox
          label="Key removed"
          checked={checked.key}
          onChange={(event) => setChecked((prev) => ({ ...prev, key: event.target.checked }))}
        />
        <Checkbox
          label="Node database cleared"
          checked={checked.node}
          onChange={(event) => setChecked((prev) => ({ ...prev, node: event.target.checked }))}
        />
        <Checkbox
          label="Owner cleared"
          checked={checked.owner}
          onChange={(event) => setChecked((prev) => ({ ...prev, owner: event.target.checked }))}
        />
        <div className="mt-3">
          <Field id="dispose-method" label="Method" required>
            <Input id="dispose-method" value={method} onChange={(event) => setMethod(event.target.value)} />
          </Field>
        </div>
        {failure && (
          <p role="alert" className={`${ALERT} mt-2`}>
            {failure}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} loading={pending} onClick={() => void submit()}>
            Dispose
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
