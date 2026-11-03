import React, { useState } from 'react';
import { Alert, Button, Dialog, Field, Input, Switch } from '../../shared/ui';
import { UPLINK_ROOT, type UplinkSettings } from '../../shared/lib/meshtastic-dock';
import type { DockStage } from './DockingService';
import { uplinkDockMessage } from './messages';
import { useDocking } from './useDocking';

// Configure uplink on screen 4.2 (devices design section 8.8, D-005): Wi-Fi and broker typed here, the
// D-005 values written as they are frozen, one edit transaction, the restart wait, the reconnect
// prompt and the read-back. Nothing typed is kept after the docking (REQ-UBI-05): the dialog's state
// goes with it, and a failure clears both passwords.

interface Props {
  device: { id: string; assetTag: string; nodeNum: number; keyVersion: number | null };
  onDone: (message: string) => void;
  onClose: () => void;
}

const EMPTY: UplinkSettings = {
  wifiSsid: '',
  wifiPassword: '',
  brokerAddress: '',
  brokerUsername: '',
  brokerPassword: '',
  tls: false,
};

const bytes = (value: string) => new TextEncoder().encode(value).length;

// The firmware's field sizes (`config.pb.h` wifi_ssid[33], wifi_psk[65]; `module_config.pb.h`
// address[64], username[64], password[32]), in bytes.
const validate = (form: UplinkSettings): Partial<Record<keyof UplinkSettings, string>> => {
  const errors: Partial<Record<keyof UplinkSettings, string>> = {};
  if (form.wifiSsid.trim() === '') errors.wifiSsid = 'Please fill in this field.';
  else if (bytes(form.wifiSsid) > 32) errors.wifiSsid = 'Use at most 32 characters.';
  if (bytes(form.wifiPassword) > 64) errors.wifiPassword = 'Use at most 64 characters.';
  if (form.brokerAddress.trim() === '') errors.brokerAddress = 'Please fill in this field.';
  else if (
    bytes(form.brokerAddress) > 63 ||
    !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(form.brokerAddress.trim())
  ) {
    errors.brokerAddress = 'Enter a host or host:port, at most 63 characters.';
  }
  if (bytes(form.brokerUsername) > 63) errors.brokerUsername = 'Use at most 63 characters.';
  if (bytes(form.brokerPassword) > 31) errors.brokerPassword = 'Use at most 31 characters.';
  return errors;
};

const stageText = (stage: DockStage, assetTag: string) => {
  switch (stage) {
    case 'reading':
      return `Reading ${assetTag}…`;
    case 'writing':
      return 'Writing settings…';
    case 'restarting':
    case 'reconnect':
      return `Waiting for ${assetTag} to restart.`;
    default:
      return 'Checking the unit…';
  }
};

export const ConfigureUplinkDialog: React.FC<Props> = ({ device, onDone, onClose }) => {
  const docking = useDocking();
  const [form, setForm] = useState<UplinkSettings>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof UplinkSettings, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const stage = docking.state.stage;

  const set = (field: keyof UplinkSettings) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setFailure(null);
    const settings = { ...form, brokerAddress: form.brokerAddress.trim() };
    const result = await docking.configureUplink(
      { deviceId: device.id, assetTag: device.assetTag, nodeNum: device.nodeNum },
      settings,
    );
    if (result.ok) {
      setForm(EMPTY);
      onDone(`${device.assetTag} is configured as an uplink to ${settings.brokerAddress}.`);
      return;
    }
    setForm((current) => ({ ...current, wifiPassword: '', brokerPassword: '' }));
    setFailure(uplinkDockMessage(result, device.assetTag));
  };

  return (
    <Dialog
      titleId="uplink-title"
      title={`Configure ${device.assetTag} as an uplink`}
      description="The unit restarts once to apply the settings."
      // Closing mid-write would leave the unit half configured; Stop ends the restart wait.
      onClose={docking.busy ? () => undefined : onClose}
      size="md"
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {device.keyVersion === null && (
          <Alert tone="warning">
            {device.assetTag} carries no organization's channel key, so it relays nothing from rented
            units. Provision it at the counter for that organization first.
          </Alert>
        )}
        <Field id="uplink-ssid" label="Wi-Fi network name" required error={errors.wifiSsid}>
          <Input
            id="uplink-ssid"
            autoComplete="off"
            value={form.wifiSsid}
            invalid={Boolean(errors.wifiSsid)}
            onChange={set('wifiSsid')}
          />
        </Field>
        <Field id="uplink-wifi-password" label="Wi-Fi password" error={errors.wifiPassword}>
          <Input
            id="uplink-wifi-password"
            type="password"
            autoComplete="off"
            value={form.wifiPassword}
            invalid={Boolean(errors.wifiPassword)}
            onChange={set('wifiPassword')}
          />
        </Field>
        <Field
          id="uplink-broker"
          label="Broker address"
          required
          hint="Host or host:port, for example 192.168.1.20:1883."
          error={errors.brokerAddress}
        >
          <Input
            id="uplink-broker"
            autoComplete="off"
            value={form.brokerAddress}
            invalid={Boolean(errors.brokerAddress)}
            onChange={set('brokerAddress')}
          />
        </Field>
        <Field id="uplink-user" label="Broker user name" error={errors.brokerUsername}>
          <Input
            id="uplink-user"
            autoComplete="off"
            value={form.brokerUsername}
            invalid={Boolean(errors.brokerUsername)}
            onChange={set('brokerUsername')}
          />
        </Field>
        <Field id="uplink-password" label="Broker password" error={errors.brokerPassword}>
          <Input
            id="uplink-password"
            type="password"
            autoComplete="off"
            value={form.brokerPassword}
            invalid={Boolean(errors.brokerPassword)}
            onChange={set('brokerPassword')}
          />
        </Field>
        <Switch
          id="uplink-tls"
          label="TLS"
          description="Off for the broker on the local network. A unit built without TLS refuses it."
          checked={form.tls}
          onChange={(tls) => setForm((current) => ({ ...current, tls }))}
        />
        <p className="text-body-sm text-ink-muted">
          Fixed by D-005: root {UPLINK_ROOT}, JSON on, MQTT encryption off, uplink on channel 0.
        </p>
        {stage && (
          <div role="status" className="flex flex-wrap items-center gap-3 text-body text-ink">
            <span>{stageText(stage, device.assetTag)}</span>
            {stage === 'reconnect' && (
              <>
                <Button type="button" onClick={() => void docking.reconnect()}>
                  Reconnect
                </Button>
                <Button type="button" variant="ghost" onClick={docking.giveUp}>
                  Stop
                </Button>
              </>
            )}
          </div>
        )}
        {failure && <Alert tone="error">{failure}</Alert>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onClose} disabled={docking.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={docking.busy}>
            Configure uplink
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
