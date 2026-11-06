import React, { useState } from 'react';
import { cn, ImagePreview } from '../../shared/ui';
import { imageSources, type VariantRender } from './spec';

export const NO_IMAGE_TEXT = 'Variant image not added yet';

// Fixed sizes, so a slot keeps its box while the image loads or when it fails (nothing shifts). The
// numbers are the width and height attributes; the classes draw the same box.
const SIZES = {
  sm: { px: 32, box: 'h-8 w-8 rounded-control' },
  md: { px: 96, box: 'h-24 w-24 rounded-card' },
  lg: { px: 160, box: 'h-40 w-40 rounded-card' },
} as const;

export type VariantImageSize = keyof typeof SIZES;

interface Props {
  variant: { name: string; imageUrl: string | null };
  // The icon render for lists and cards, the detail render for detail panes and the device page
  // (specs/devices/design.md section 10, "Two renders per variant").
  render: VariantRender;
  size: VariantImageSize;
  // Every device render opens the larger detail render (leader, 2026-11-06 00:50, chapter 06 §11.9). Off
  // only where a caller shows the large render itself.
  preview?: boolean;
  // Inside a row that is itself a link or a button: hover only, no control of its own (ImagePreview).
  nested?: boolean;
  className?: string;
}

// One render of a hardware variant in a fixed box on a theme surface token, so the transparent renders read
// in both themes. Lazy loaded, named "{variant name} unit". A source that fails moves to the next one (the
// icon to the detail render); with none left the box shows the labelled empty slot, or, at the small size
// where the label cannot fit, an empty box the row's own text already names.
export const VariantImage: React.FC<Props> = ({
  variant,
  render,
  size,
  preview = true,
  nested = false,
  className,
}) => {
  const sources = imageSources(variant.imageUrl, render);
  const key = sources.join('|');
  // The failures are kept per source list, so a changed variant starts again from its first source.
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const index = failed.key === key ? failed.count : 0;
  const src = sources[index];
  const { px, box } = SIZES[size];
  const image = (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-line bg-sunken',
        box,
        className,
      )}
      aria-hidden={src === undefined && size === 'sm' ? true : undefined}
    >
      {src !== undefined ? (
        <img
          src={src}
          alt={`${variant.name} unit`}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
          onError={() => setFailed({ key, count: index + 1 })}
        />
      ) : size === 'sm' ? null : (
        <p className="px-1 text-center text-caption text-ink-muted">{NO_IMAGE_TEXT}</p>
      )}
    </div>
  );
  const previewSrc = imageSources(variant.imageUrl, 'detail')[0];
  return preview && src !== undefined && previewSrc !== undefined ? (
    <ImagePreview
      src={previewSrc}
      alt={`${variant.name} unit`}
      caption={variant.name}
      hoverOnly={nested}
    >
      {image}
    </ImagePreview>
  ) : (
    image
  );
};
