import React, { useState } from 'react';
import { cn } from '../../shared/ui';
import { specLines, type VariantMedia } from './spec';

export const NO_IMAGE_TEXT = 'Variant image not added yet';

interface Props {
  variant: VariantMedia;
  // The level of the variant name, so the card fits the heading order of the page it is on.
  headingLevel?: 'h2' | 'h3' | 'h4';
  // For a control that names itself after the card (aria-labelledby).
  headingId?: string;
  // Under the spec summary, for a price or an availability line.
  children?: React.ReactNode;
  className?: string;
}

// The card of a hardware variant (specs/devices/design.md section 10, UI conventions E-2): an image slot,
// the name and the spec summary in the fixed key order. No photo, or one that does not load, shows the
// labelled empty slot instead of a broken image.
export const VariantCard: React.FC<Props> = ({
  variant,
  headingLevel = 'h3',
  headingId,
  children,
  className,
}) => {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = variant.imageUrl !== null && failed !== variant.imageUrl;
  const lines = specLines(variant.specSheet);
  const Heading = headingLevel;
  return (
    <div className={cn('flex min-w-0 gap-3', className)}>
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-sunken">
        {showImage ? (
          <img
            src={variant.imageUrl ?? undefined}
            alt={`${variant.name} unit`}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setFailed(variant.imageUrl)}
          />
        ) : (
          <p className="px-1 text-center text-caption text-ink-muted">{NO_IMAGE_TEXT}</p>
        )}
      </div>
      <div className="min-w-0">
        <Heading id={headingId} className="text-body font-semibold text-ink">
          {variant.name}
        </Heading>
        {lines.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body-sm">
            {lines.map((line) => (
              <React.Fragment key={line.key}>
                <dt className="text-ink-muted">{line.label}</dt>
                <dd className="text-ink">{line.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {children}
      </div>
    </div>
  );
};
