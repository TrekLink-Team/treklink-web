import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { FOCUS } from './styles';

export const IMAGE_PREVIEW_DELAY_MS = 500;

interface ImagePreviewProps {
  src: string;
  alt: string;
  caption: string;
  children: React.ReactNode;
  className?: string;
  // For a thumbnail inside a row that is itself a link or a button: the thumbnail is no control of its
  // own, so it never swallows the row's click; the focus view opens on a pointer rest only, and the row's
  // page or pane shows the larger image to keyboard users.
  hoverOnly?: boolean;
}

/**
 * The focus view of a device or variant image (devices design section 12.14, REQ-EVT-51, leader UAT 2026-11-06):
 * after the pointer rests 500 ms on the image, on a click or a tap, or on Enter or Space, the image opens centred
 * over the whole page at the largest size that fits, at most 90 % of the viewport, over a dimmed backdrop, with
 * the caption. It is a modal dialog: focus moves to Close and stays inside, Escape, a click or tap outside the
 * image, or Close shut it, and focus returns to the image that opened it. On a phone a tap opens it and a tap
 * closes it. It replaces the small hover preview of treklink-web#405.
 */
export const ImagePreview: React.FC<ImagePreviewProps> = ({
  src,
  alt,
  caption,
  children,
  className,
  hoverOnly = false,
}) => {
  const id = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The element that had focus when the view opened: the trigger, or for a hover-only thumbnail (a span, which
  // takes no focus) the row or control the user was on. Focus goes back there on close, never to the body.
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const close = useCallback(() => {
    cancelOpen();
    setOpen(false);
    // Focus returns where it was when the view opened (WCAG 2.4.3): the image's own button, else the element saved
    // on open, else the trigger when it can take focus.
    const target = returnFocus.current ?? triggerRef.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [cancelOpen]);

  const show = useCallback(() => {
    const active = document.activeElement;
    returnFocus.current =
      active instanceof HTMLElement && active !== document.body ? active : (triggerRef.current ?? null);
    setOpen(true);
  }, []);

  const openNow = useCallback(() => {
    cancelOpen();
    show();
  }, [cancelOpen, show]);

  const restToOpen = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || open || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      show();
    }, IMAGE_PREVIEW_DELAY_MS);
  };

  const leave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') cancelOpen();
  };

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        // Close is the one control inside: focus stays on it (the trap of a modal dialog).
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [close, open]);

  useEffect(() => cancelOpen, [cancelOpen]);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openNow();
    }
  };

  const view =
    open &&
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-caption`}
        id={id}
        className="fixed inset-0 z-dialog flex items-center justify-center bg-scrim/[0.85] p-[5vmin]"
        // A click or a tap anywhere but Close shuts the view, the image included (a tap opens, a tap closes).
        onClick={close}
      >
        <figure className="flex max-h-[90dvh] max-w-[90vw] flex-col items-center gap-2">
          <img
            src={src}
            alt={alt}
            className="max-h-[calc(90dvh-3rem)] max-w-[90vw] rounded-panel bg-surface object-contain shadow-overlay"
          />
          <figcaption id={`${id}-caption`} className="rounded-badge bg-inverse px-3 py-1 text-body font-semibold text-ink-inverse">
            {caption}
          </figcaption>
        </figure>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the ${caption} image`}
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
          className={cn(
            'absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-control bg-inverse text-ink-inverse',
            FOCUS,
          )}
        >
          <X aria-hidden="true" className="h-6 w-6" />
        </button>
      </div>,
      document.body,
    );

  if (hoverOnly)
    return (
      <>
        <span
          ref={triggerRef as React.RefObject<HTMLSpanElement>}
          onPointerEnter={restToOpen}
          onPointerLeave={leave}
          className={cn('inline-flex shrink-0 cursor-zoom-in', className)}
        >
          {children}
        </span>
        {view}
      </>
    );

  return (
    <>
      <button
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        type="button"
        aria-label={`Preview ${caption} image`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openNow}
        onKeyDown={onTriggerKeyDown}
        onPointerEnter={restToOpen}
        onPointerLeave={leave}
        className={cn('inline-flex shrink-0 cursor-zoom-in rounded-control', FOCUS, className)}
      >
        {children}
      </button>
      {view}
    </>
  );
};
