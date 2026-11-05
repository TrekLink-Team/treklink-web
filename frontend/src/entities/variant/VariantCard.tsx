import React from 'react';
import { cn } from '../../shared/ui';
import { capabilityText, specLines, type VariantMedia, type VariantRender } from './spec';
import { VariantImage } from './VariantImage';

export { NO_IMAGE_TEXT } from './VariantImage';

interface Props {
  variant: VariantMedia;
  // The icon render (96 px, beside the text) for lists and cards; the detail render (160 px, above the text)
  // for detail panes and the device page (design section 10, "Two renders per variant").
  render?: VariantRender;
  // The level of the variant name, so the card fits the heading order of the page it is on.
  headingLevel?: 'h2' | 'h3' | 'h4';
  // For a control that names itself after the card (aria-labelledby).
  headingId?: string;
  // Under the spec summary, for a price or an availability line.
  children?: React.ReactNode;
  className?: string;
}

// The card of a hardware variant (specs/devices/design.md section 10, UI conventions E-2): an image slot,
// the name and the spec summary in the fixed key order. No image, or one that does not load, shows the
// labelled empty slot instead of a broken image.
export const VariantCard: React.FC<Props> = ({
  variant,
  render = 'icon',
  headingLevel = 'h3',
  headingId,
  children,
  className,
}) => {
  const lines = specLines(variant.specSheet);
  const capabilities = capabilityText(variant);
  const baseline = variant.firmwareBaseline?.trim() || null;
  const Heading = headingLevel;
  return (
    // The text wraps under the image when the card is narrower than both (reflow at 320 px).
    <div className={cn('flex min-w-0 flex-wrap gap-3', render === 'detail' && 'flex-col', className)}>
      <VariantImage variant={variant} render={render} size={render === 'detail' ? 'lg' : 'md'} />
      <div className="min-w-[10rem] flex-1">
        <Heading id={headingId} className="text-body font-semibold text-ink">
          {variant.name}
        </Heading>
        {(lines.length > 0 || capabilities !== null || baseline !== null) && (
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-body-sm [&_dd]:[overflow-wrap:anywhere]">
            {lines.map((line) => (
              <React.Fragment key={line.key}>
                <dt className="text-ink-muted">{line.label}</dt>
                <dd className="text-ink">{line.value}</dd>
              </React.Fragment>
            ))}
            {capabilities !== null && (
              <>
                <dt className="text-ink-muted">Capabilities</dt>
                <dd className="text-ink">{capabilities}</dd>
              </>
            )}
            {baseline !== null && (
              <>
                <dt className="text-ink-muted">Firmware baseline</dt>
                <dd className="text-ink">{baseline}</dd>
              </>
            )}
          </dl>
        )}
        {children}
      </div>
    </div>
  );
};
