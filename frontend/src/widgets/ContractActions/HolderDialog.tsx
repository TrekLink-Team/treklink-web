import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  contractKeys,
  setHolder,
  type ContractDetail,
  type ContractDevice,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { Field } from '../../shared/ui/bits';
import { Dialog } from '../../shared/ui/Dialog';
import { useToast } from '../../shared/ui/toastStore';
import {
  ALERT,
  DANGER_BUTTON,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from '../../shared/ui/styles';

// The holder label of a handed-over device (screen 5.2, rentals api-design 13). Optional personal
// data, erased when the contract closes (BR-33); saving with an empty name clears the label.
export const HolderDialog: React.FC<{
  contract: ContractDetail;
  device: ContractDevice;
  onClose: () => void;
}> = ({ contract, device, onClose }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [name, setName] = useState(device.holder?.name ?? '');
  const [phone, setPhone] = useState(device.holder?.phone ?? '');
  const [emergency, setEmergency] = useState(device.holder?.emergencyContact ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tag = device.assetTag ?? device.deviceId;

  const save = async (clear: boolean) => {
    if (clear && !window.confirm(`Remove the holder label of ${tag}?`)) return;
    setPending(true);
    setError(null);
    try {
      await setHolder(
        contract.id,
        device.deviceId,
        clear || name.trim() === ''
          ? { name: null }
          : {
              name: name.trim(),
              phone: phone.trim() || null,
              emergencyContact: emergency.trim() || null,
            },
      );
      await queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) });
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
    }
  };

  const close = () => {
    const dirty =
      name !== (device.holder?.name ?? '') ||
      phone !== (device.holder?.phone ?? '') ||
      emergency !== (device.holder?.emergencyContact ?? '');
    if (!dirty || window.confirm('Discard the label changes?')) onClose();
  };

  return (
    <Dialog titleId="holder-title" title={`Holder of ${tag}`} onClose={close}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <p className="text-sm text-slate-700">
          Who carries this device on the trek. The label is optional and is erased when the contract
          closes.
        </p>
        {error && (
          <div role="alert" className={ALERT}>
            {error}
          </div>
        )}
        <Field id="holder-name" label="Name">
          <input
            id="holder-name"
            className={INPUT}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field id="holder-phone" label="Phone">
          <input
            id="holder-phone"
            type="tel"
            className={INPUT}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field id="holder-emergency" label="Emergency contact" hint="Name and phone.">
          <input
            id="holder-emergency"
            className={INPUT}
            value={emergency}
            onChange={(event) => setEmergency(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} flex-1`}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {device.holder && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void save(true)}
              className={`${DANGER_BUTTON} flex-1`}
            >
              Clear label
            </button>
          )}
          <button type="button" onClick={close} className={`${SECONDARY_BUTTON} flex-1`}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
};
