import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { FOCUS } from './styles';

export const IMAGE_PREVIEW_DELAY_MS = 500;

const CLOSE_DELAY_MS = 80;
const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
const PREVIEW_WIDTH_PX = 320;

interface Position {
  top: number;
  left: number;
}

interface ImagePreviewProps {
  src: string;
  alt: string;
  caption: string;
  children: React.ReactNode;
  className?: string;
  // For a thumbnail inside a row that is itself a link or a button: the thumbnail is no control of its
  // own, so it never swallows the row's click; the preview opens on a pointer rest only, and the row's
  // page or pane shows the larger render to keyboard users.
  hoverOnly?: boolean;
}

/**
 * A non-modal image preview that opens after a short pointer rest, or immediately from click, tap and
 * keyboard activation (chapter 06 §11.9). It is portaled so a table or details pane cannot clip it.
 * It closes on Escape, on leaving it with a mouse, on a pointer down anywhere outside it and its
 * trigger (a phone has no Escape key, WCAG 1.4.13 dismissible), and on a second activation of the
 * trigger. Focus stays on the trigger, so the preview is a named figure, not a dialog.
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
  const previewRef = useRef<HTMLElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  // How the open preview was opened: by a pointer rest, or by a click, tap or key on the trigger. A
  // second activation closes only a preview the trigger opened, so a mouse that rests and then clicks
  // keeps it.
  const openedBy = useRef<'rest' | 'activation' | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    cancelOpen();
    cancelClose();
    openedBy.current = null;
    setOpen(false);
    setPosition(null);
  }, [cancelClose, cancelOpen]);

  const openNow = useCallback(() => {
    cancelOpen();
    cancelClose();
    openedBy.current = 'activation';
    setOpen(true);
  }, [cancelClose, cancelOpen]);

  // A click, a tap or Enter and Space on the trigger.
  const activate = () => {
    if (open && openedBy.current === 'activation') close();
    else openNow();
  };

  const restToOpen = () => {
    cancelClose();
    if (open || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      openedBy.current = 'rest';
      setOpen(true);
    }, IMAGE_PREVIEW_DELAY_MS);
  };

  const leave = () => {
    cancelOpen();
    cancelClose();
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  };

  const pointerRest = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') restToOpen();
  };

  const pointerLeave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') leave();
  };

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(PREVIEW_WIDTH_PX, window.innerWidth - VIEWPORT_MARGIN_PX * 2);
    const height = previewRef.current?.offsetHeight ?? 0;
    const roomRight = window.innerWidth - rect.right - VIEWPORT_MARGIN_PX;
    const roomLeft = rect.left - VIEWPORT_MARGIN_PX;
    const rawLeft =
      roomRight >= width + GAP_PX || roomRight >= roomLeft
        ? rect.right + GAP_PX
        : rect.left - GAP_PX - width;
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(rawLeft, window.innerWidth - width - VIEWPORT_MARGIN_PX),
    );
    const top = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(rect.top, window.innerHeight - height - VIEWPORT_MARGIN_PX),
    );
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // A pointer down outside the preview and its trigger closes it, a tap on a phone included.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || previewRef.current?.contains(target)))
        return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [close, open, place]);

  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelClose, cancelOpen],
  );

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const preview =
    open &&
    createPortal(
      <figure
        ref={previewRef}
        id={id}
        aria-label={`${caption} image preview`}
        onPointerEnter={cancelClose}
        onPointerLeave={pointerLeave}
        className="fixed z-toast w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-panel border border-line bg-surface-raised p-2 shadow-overlay"
        style={{
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          visibility: position === null ? 'hidden' : 'visible',
        }}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[calc(100dvh-5rem)] w-full rounded-control bg-sunken object-contain"
        />
        <figcaption className="mt-2 text-body-sm font-semibold text-ink">{caption}</figcaption>
      </figure>,
      document.body,
    );

  if (hoverOnly)
    return (
      <>
        <span
          ref={triggerRef as React.RefObject<HTMLSpanElement>}
          onPointerEnter={pointerRest}
          onPointerLeave={pointerLeave}
          className={cn('inline-flex shrink-0 cursor-zoom-in', className)}
        >
          {children}
        </span>
        {preview}
      </>
    );

  return (
    <>
      <button
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        type="button"
        aria-label={`Preview ${caption} image`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={activate}
        onKeyDown={onTriggerKeyDown}
        onPointerEnter={pointerRest}
        onPointerLeave={pointerLeave}
        className={cn('inline-flex shrink-0 cursor-zoom-in rounded-control', FOCUS, className)}
      >
        {children}
      </button>

      {preview}
    </>
  );
};
