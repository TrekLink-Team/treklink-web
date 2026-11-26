import React, { useState } from 'react';
import { damageCodesFor, useDamageRates } from '../../entities/billing/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatVnd } from '../../shared/lib/format';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  RadioGroup,
  Skeleton,
  Textarea,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

export type InspectionChoice = 'PASSED' | 'DAMAGED' | 'FAILED';

export interface InspectionInput {
  result: InspectionChoice;
  damageCodes: string[];
  note?: string;
}

const errorOf = (failure: unknown) =>
  failure instanceof ApiError ? failure.message : messageOf(failure);

interface Props<T> {
  assetTag: string | null;
  hardwareVariantId: string;
  // The write: rentals api-design 16 at the counter, devices api-design 35 on the device page (D-114).
  inspect: (input: InspectionInput) => Promise<T>;
  // False on the device page: no contract carries a damage charge there, so no price shows.
  charged?: boolean;
  onDone: (outcome: T) => void;
  onClose: () => void;
}

// The inspection of one reset unit; DAMAGED needs at least one damage code, chosen from the damage price
// list of the unit's variant (billing api-design 05). Shared by the return counter and the device page.
export const InspectDialog = <T,>({
  assetTag,
  hardwareVariantId,
  inspect,
  charged = true,
  onDone,
  onClose,
}: Props<T>) => {
  const [result, setResult] = useState<InspectionChoice | undefined>(undefined);
  const [codes, setCodes] = useState<string[]>([]);
  const rates = useDamageRates(hardwareVariantId);
  const choices = damageCodesFor(rates.data ?? [], hardwareVariantId);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);

  const submit = async () => {
    if (!result) {
      setError('Choose the result.');
      return;
    }
    // Only the codes still offered: one deactivated since the list loaded has no checkbox left to
    // untick after the reload, so it would be sent again (review of #129).
    const damageCodes = codes.filter((code) => choices.some((rate) => rate.code === code));
    if (result === 'DAMAGED' && damageCodes.length === 0) {
      setCodesError('Choose at least one damage code.');
      return;
    }
    setPending(true);
    try {
      onDone(
        await inspect({
          result,
          damageCodes: result === 'DAMAGED' ? damageCodes : [],
          note: note.trim() || undefined,
        }),
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'UNKNOWN_DAMAGE_CODE') {
        // A code deactivated since the list loaded: the server's message, and the list reloads.
        setCodesError(failure.message);
        void rates.refetch();
      } else setError(errorOf(failure));
    }
  };

  return (
    <Dialog
      titleId="inspect-title"
      title={`Inspect ${assetTag ?? 'device'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Record inspection
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup<InspectionChoice>
          name="inspection-result"
          legend="Result"
          layout="row"
          value={result}
          onChange={(value) => {
            setResult(value);
            setError(null);
          }}
          options={[
            { value: 'PASSED', label: 'Passed' },
            { value: 'DAMAGED', label: 'Damaged' },
            { value: 'FAILED', label: 'Failed' },
          ]}
        />
        {result === 'DAMAGED' &&
          (rates.isLoading ? (
            <Skeleton className="h-24" />
          ) : rates.error ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" onClick={() => void rates.refetch()}>
                  Try again
                </Button>
              }
            >
              {messageOf(rates.error)}
            </Alert>
          ) : choices.length === 0 ? (
            <Alert tone="warning">
              No damage code is priced for this variant. An Admin adds one on the Prices page.
            </Alert>
          ) : (
            <fieldset
              aria-describedby={codesError ? 'damage-codes-error' : undefined}
              className="flex flex-col gap-1"
            >
              <legend className="mb-1 text-body-sm font-semibold text-ink">
                Damage codes
                <span aria-hidden="true" className="ml-0.5 text-status-critical-fg">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </legend>
              {!charged && (
                <p className="mb-1 text-body-sm text-ink-muted">
                  Not charged: this unit came back outside a contract.
                </p>
              )}
              {choices.map((rate) => (
                <Checkbox
                  key={rate.code}
                  id={`damage-${rate.code}`}
                  label={`${rate.label} (${rate.code})`}
                  description={charged ? formatVnd(rate.amountVnd) : undefined}
                  checked={codes.includes(rate.code)}
                  onChange={(event) => {
                    const { checked } = event.target;
                    setCodes((current) =>
                      checked
                        ? [...current, rate.code]
                        : current.filter((code) => code !== rate.code),
                    );
                    setCodesError(null);
                  }}
                />
              ))}
              {codesError && (
                <p
                  id="damage-codes-error"
                  role="alert"
                  className="text-body-sm font-medium text-status-critical-fg"
                >
                  {codesError}
                </p>
              )}
            </fieldset>
          ))}
        <Field id="inspection-note" label="Note">
          <Textarea
            id="inspection-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};
