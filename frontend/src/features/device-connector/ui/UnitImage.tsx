import React, { useState } from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '../../../shared/ui/cn';
import { ImagePreview } from '../../../shared/ui/ImagePreview';
import { renderPath } from '../model/text';

// The upright product render of a variant (devices design section 12.2, decided Q5 A): by convention
// `/variants/<code>-detail.png` in the device view and `/variants/<code>-icon.png` in rows. The files are
// made separately; until one exists, or when it fails to load, the labelled empty slot shows the variant
// name (REQ-ERR-31). A loaded render, icon or detail, opens the detail render as a larger preview on a
// 500 ms rest, a click, a tap, or Enter or Space (leader, 2026-11-06 00:50, chapter 06 §11.9).

interface Props {
  code: string | null;
  name: string | null;
  kind: 'detail' | 'icon';
  className?: string;
}

export const UnitImage: React.FC<Props> = ({ code, name, kind, className }) => {
  const [failed, setFailed] = useState<string | null>(null);
  const src = code ? renderPath(code, kind) : null;
  const box =
    kind === 'detail'
      ? // 240 px from 600 px, 160 px on a phone's bottom sheet (screen 4.6, Mobile).
        'h-40 w-full rounded-card min-[600px]:h-60'
      : 'h-12 w-12 shrink-0 rounded-control';
  if (!src || failed === src) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-line bg-sunken text-center text-ink-muted',
          box,
          className,
        )}
      >
        {kind === 'detail' ? (
          <p className="px-4 text-body-sm">
            {name ? `${name}: render not added yet` : 'Unit render not added yet'}
          </p>
        ) : (
          <>
            <Cpu aria-hidden="true" className="h-5 w-5" />
            <span className="sr-only">{name ? `${name}, no render yet` : 'Unknown unit'}</span>
          </>
        )}
      </div>
    );
  }
  const image = (
    <img
      src={src}
      alt={kind === 'detail' ? `${name ?? 'Unit'}, front view` : ''}
      onError={() => setFailed(src)}
      className={cn('border border-line bg-sunken object-contain', box, className)}
    />
  );
  return (
    <ImagePreview
      src={renderPath(code as string, 'detail')}
      alt={`${name ?? 'Unit'}, front view`}
      caption={name ?? 'Unit'}
      className={kind === 'detail' ? 'w-full' : undefined}
    >
      {image}
    </ImagePreview>
  );
};
