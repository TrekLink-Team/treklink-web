import React from 'react';
import type { PlanVariant } from '../../entities/billing/api';
import { VariantCard } from '../../entities/variant/VariantCard';
import { formatVnd } from '../../shared/lib/format';
import { cn } from '../../shared/ui';

interface Props {
  variants: PlanVariant[];
  value: string;
  onChange: (variantId: string) => void;
  // The units available now per variant; undefined while it is not read.
  countOf: (variantId: string) => number | undefined;
  error?: string;
}

// The variant picker of the contract request form as cards (specs/devices/design.md section 10, UI
// conventions E-2): one radio per variant, named after the variant, described by its price and the units
// available. The whole card selects it. It replaces the select of step 1 and keeps its error text.
export const VariantPicker: React.FC<Props> = ({ variants, value, onChange, countOf, error }) => (
  <fieldset
    id="variant"
    className="m-0 min-w-0 border-0 p-0"
    aria-describedby={error ? 'variant-error' : undefined}
  >
    <legend className="mb-1.5 text-body-sm font-semibold text-ink">Hardware variant</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {variants.map((item) => {
        const selected = item.id === value;
        const count = countOf(item.id);
        const nameId = `variant-${item.id}-name`;
        const detailId = `variant-${item.id}-detail`;
        return (
          // The radio is the control and takes the keyboard; a click anywhere on the card chooses it too.
          <div
            key={item.id}
            onClick={(event) => {
              // A click on the radio itself reaches onChange below; only the rest of the card needs this.
              if (!(event.target instanceof HTMLInputElement)) onChange(item.id);
            }}
            className={cn(
              'flex cursor-pointer gap-3 rounded-card border p-3',
              selected ? 'border-2 border-brand bg-sunken' : 'border-line bg-surface',
            )}
          >
            <input
              type="radio"
              name="variant"
              value={item.id}
              checked={selected}
              onChange={() => onChange(item.id)}
              aria-labelledby={nameId}
              aria-describedby={detailId}
              aria-invalid={error ? true : undefined}
              className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[rgb(var(--tl-accent))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <VariantCard variant={item} headingId={nameId}>
              <p id={detailId} className="mt-2 text-body-sm text-ink">
                {formatVnd(item.monthlyPriceVnd)} per device per month
                {count === undefined ? '' : `, ${count} available`}
              </p>
            </VariantCard>
          </div>
        );
      })}
    </div>
    {error && (
      <p id="variant-error" role="alert" className="mt-1.5 text-body-sm text-status-critical-fg">
        {error}
      </p>
    )}
  </fieldset>
);
