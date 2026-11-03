import React, { useState } from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '../../../shared/ui/cn';
import { renderPath } from '../model/text';

// The upright product render of a variant (devices design section 11.2, decided Q5 A): by convention
// `/variants/<code>-detail.png` in the device view and `/variants/<code>-icon.png` in rows. The files are
// made separately; until one exists, or when it fails to load, the labelled empty slot shows the variant
// name (REQ-ERR-29).

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
  return (
    <img
      src={src}
      alt={kind === 'detail' ? `${name ?? 'Unit'}, front view` : ''}
      onError={() => setFailed(src)}
      className={cn('border border-line bg-sunken object-contain', box, className)}
    />
  );
};
