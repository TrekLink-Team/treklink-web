import React, { useState } from 'react';
import {
  findAvailableUnit,
  replaceDevice,
  type ContractDetail,
  type Replaced,
} from '../../entities/contract/api';
import { useOrganization } from '../../entities/organization/api';
import { ApiError } from '../../shared/api/apiClient';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Select } from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import { SignaturePad } from '../SignaturePad/SignaturePad';

type Errors = Partial<Record<'device' | 'tag' | 'signature' | 'form', string>>;

// The replacement tab of screen 5.5 (rentals api-design 15, UC-61, BR-41): Staff pick the unit going
// out of service, scan the AVAILABLE unit of the same variant taking its place, write the
// organization's current channel key to it, and the Manager signs on screen. The faulty unit, when
// it is here, is checked in and waits for reset and inspection on the next tab.
export const ReplacementPanel: React.FC<{
  contract: ContractDetail;
  onReplaced: () => Promise<unknown>;
}> = ({ contract, onReplaced }) => {
  const organization = useOrganization(contract.organization?.id);
  const keyVersion = organization.data?.channelKeyVersion;
  const out = contract.devices.filter(
    (device) => device.handedOverAt && !device.checkedInAt && !device.lostAt,
  );
  const [deviceId, setDeviceId] = useState('');
  const [tag, setTag] = useState('');
  const [faultyPresent, setFaultyPresent] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<
    (Replaced & { from: string; to: string; faultyPresent: boolean }) | null
  >(null);
  // The pad keeps its own drawing; a new key clears it after a replacement.
  const [padKey, setPadKey] = useState(0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const wanted = tag.trim().toUpperCase();
    const found: Errors = {};
    if (deviceId === '') found.device = 'Choose the device to replace.';
    if (wanted === '') found.tag = 'Scan or type the asset tag of the replacement.';
    if (!signature) found.signature = 'The Manager signs on screen before the replacement.';
    setErrors(found);
    if (Object.keys(found).length > 0 || keyVersion === undefined || !signature) return;
    setPending(true);
    try {
      const unit = await findAvailableUnit(wanted, contract.hardwareVariant.id);
      if (!unit) {
        setErrors({
          tag: `${wanted} is not an available ${contract.hardwareVariant.code ?? ''} unit.`,
        });
        return;
      }
      const replaced = await replaceDevice(contract.id, deviceId, {
        replacementDeviceId: unit.id,
        keyVersion,
        signatureImage: signature,
        faultyPresent,
      });
      const from = out.find((device) => device.deviceId === deviceId)?.assetTag ?? 'The device';
      setDone({ ...replaced, from, to: unit.assetTag, faultyPresent });
      setDeviceId('');
      setTag('');
      setSignature(null);
      setPadKey((key) => key + 1);
      await onReplaced();
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.message : messageOf(failure);
      if (failure instanceof ApiError && failure.errorCode === 'DEVICE_NOT_ON_CONTRACT') {
        setErrors({ device: message });
      } else if (
        failure instanceof ApiError &&
        ['VARIANT_MISMATCH', 'DEVICE_NOT_AVAILABLE'].includes(failure.errorCode ?? '')
      ) {
        setErrors({ tag: message });
      } else {
        setErrors({ form: message });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Replace a device"
        description="Plan, variant and quantity stay the same; the replacement gets its own signed note."
      />
      {done && (
        <Alert tone="success" className="mb-4">
          {done.from} replaced by {done.to}.{' '}
          {done.faultyPresent
            ? 'The returned unit waits for reset and inspection.'
            : 'The missing unit stays with its loss case.'}
        </Alert>
      )}
      {out.length === 0 ? (
        <Alert tone="info">No device is out on this contract.</Alert>
      ) : (
        <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
          {errors.form && <Alert tone="error">{errors.form}</Alert>}
          <Field id="replace-device" label="Device to replace" error={errors.device} required>
            <Select
              id="replace-device"
              value={deviceId}
              invalid={Boolean(errors.device)}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">Choose a device</option>
              {out.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.assetTag ?? device.deviceId}
                  {device.holder ? `, ${device.holder.name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label="The device is here at the counter"
            description="Untick when it is missing: it then needs an open loss case."
            checked={faultyPresent}
            onChange={(event) => setFaultyPresent(event.target.checked)}
          />
          <Field
            id="replace-tag"
            label="Replacement asset tag"
            hint={`An available ${contract.hardwareVariant.code ?? ''} unit.`}
            error={errors.tag}
            required
          >
            <Input
              id="replace-tag"
              value={tag}
              invalid={Boolean(errors.tag)}
              onChange={(event) => setTag(event.target.value)}
            />
          </Field>
          {keyVersion !== undefined ? (
            <Alert tone="info">
              Write channel key version {keyVersion} of the organization to the replacement.
            </Alert>
          ) : (
            <Alert tone="warning">Loading the organization&apos;s key version.</Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-semibold text-ink">Manager signature</span>
            <SignaturePad
              key={padKey}
              id="replace-signature"
              invalid={Boolean(errors.signature)}
              onChange={setSignature}
            />
            {errors.signature && (
              <p role="alert" className="text-body-sm font-medium text-status-critical-fg">
                {errors.signature}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            loading={pending}
            loadingLabel="Replacing"
            disabled={keyVersion === undefined}
          >
            Replace device
          </Button>
        </form>
      )}
    </Card>
  );
};
