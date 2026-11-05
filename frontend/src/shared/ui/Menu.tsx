import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { FOCUS } from './styles';

// The WAI-ARIA menu button pattern (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), the
// only menu of the TrekLink System (specs/frontend/ui-design/0-ui-standard.md §2 and §3).
//
// Keyboard: Enter, Space or Down Arrow on the button opens the menu on the first item, Up Arrow on
// the last. Inside, Up and Down Arrow move (wrapping), Home and End jump, a printable character
// moves to the next item starting with it, Enter and Space choose, Escape closes and returns focus
// to the button, Tab closes from the button so focus moves on to the control after it (the list is
// portaled to the end of the body). One item holds tabindex 0 (roving tabindex).
//
// A disabled item stays focusable with aria-disabled, so a keyboard or screen-reader user can still
// reach it and hear why it is disabled: its reason shows under the label while the item is focused
// or hovered, and is the item's description (aria-describedby).
//
// The list renders in a portal with fixed positioning, so a scrolling table does not clip it, on the
// toast layer so a menu opened inside a dialog shows above the dialog.
//
// The button draws a chevron-down after its content, the hint that it opens a list (chapter 06
// §10.3, D-096). The icon is decorative. A trigger that is itself a chevron passes `chevron={false}`.

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Why the item is disabled: shown as a tooltip and read as the item's description. */
  disabledReason?: string;
  /** Styled in the critical colour; the action should still confirm in a dialog. */
  destructive?: boolean;
  /** Draws a separator above the item, as before the destructive items (chapter 06 §9.6). */
  separatorBefore?: boolean;
}

export interface MenuProps {
  /** The button's accessible name. With `trigger` text, start it with that text (WCAG 2.5.3). */
  label: string;
  items: MenuItem[];
  /** Button content. Defaults to the label text. */
  trigger?: React.ReactNode;
  /** Classes of the trigger button. */
  triggerClassName?: string;
  /** Read-only content above the items, such as who is signed in. Not a menu item: it takes no focus. */
  header?: React.ReactNode;
  /** Which edge of the button the list lines up with. */
  align?: 'start' | 'end';
  disabled?: boolean;
  /** Tooltip of the trigger, for icon-only triggers. */
  title?: string;
  className?: string;
  /** Draws the chevron-down after the button content (§10.3). On by default. */
  chevron?: boolean;
}

const TRIGGER =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-control px-2 text-body-sm font-semibold text-ink transition duration-tl ease-tl hover:bg-chrome/60 disabled:cursor-not-allowed disabled:opacity-55';

const GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

interface Position {
  top: number;
  left: number;
  minWidth: number;
  /** The room on the side it opens to; a longer list scrolls inside it (1.4.10, 2.1.1). */
  maxHeight: number;
}

export const Menu: React.FC<MenuProps> = ({
  label,
  items,
  trigger,
  triggerClassName,
  header,
  align = 'end',
  disabled,
  title,
  className,
  chevron = true,
}) => {
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const list = listRef.current;
    // The whole list's height, even when a previous placement capped it.
    const height = list?.scrollHeight ?? 0;
    const width = list?.offsetWidth ?? rect.width;
    const below = rect.bottom + GAP_PX;
    // The list opens below, or above when it does not fit below and there is more room above; on
    // either side it is held inside the viewport and scrolls when longer (re-check of #350: the Show
    // menu ran past the bottom of a 1280 x 800 window and its last filters could not be reached).
    const roomBelow = window.innerHeight - VIEWPORT_MARGIN_PX - below;
    const roomAbove = rect.top - GAP_PX - VIEWPORT_MARGIN_PX;
    const flip = height > roomBelow && roomAbove > roomBelow;
    const maxHeight = Math.max(flip ? roomAbove : roomBelow, 0);
    const top = flip ? rect.top - GAP_PX - Math.min(height, maxHeight) : below;
    const rawLeft = align === 'end' ? rect.right - width : rect.left;
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(rawLeft, window.innerWidth - width - VIEWPORT_MARGIN_PX),
    );
    setPosition({ top, left, minWidth: rect.width, maxHeight });
  }, [align]);

  const openAt = (index: number) => {
    if (disabled || items.length === 0) return;
    setActive(index);
    setOpen(true);
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setHovered(null);
    // Measured again on the next open, so focus never waits on a stale position.
    setPosition(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place, active, hovered]);

  // The list stays `visibility: hidden` until it is placed, and a hidden element cannot take focus:
  // focus the active item only once the position is set (review of treklink-web#278).
  const placed = position !== null;
  useEffect(() => {
    if (open && placed) itemRefs.current[active]?.focus();
  }, [open, placed, active]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    const onMove = () => place();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place]);

  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  };

  const onButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space reach the button as a click, which opens on the first item.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(items.length - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const count = items.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => (index + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => (index - 1 + count) % count);
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(count - 1);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case 'Tab':
        // No preventDefault: focus goes back to the button first, so the browser's Tab moves on from
        // the button instead of from the end of the body, where the list is portaled.
        buttonRef.current?.focus();
        close(false);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const letter = event.key.toLowerCase();
          for (let step = 1; step <= count; step += 1) {
            const index = (active + step) % count;
            if (items[index].label.toLowerCase().startsWith(letter)) {
              setActive(index);
              return;
            }
          }
        }
    }
  };

  const list = open ? (
    <div
      ref={listRef}
      id={menuId}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        minWidth: position?.minWidth,
        maxHeight: position?.maxHeight,
        visibility: position ? 'visible' : 'hidden',
      }}
      className="z-toast flex w-max max-w-[min(20rem,calc(100vw-1rem))] flex-col overflow-y-auto overscroll-contain rounded-panel border border-line bg-surface-raised p-1 text-ink shadow-overlay"
    >
      {header && (
        <div role="presentation" className="mb-1 border-b border-line px-3 pb-2 pt-1">
          {header}
        </div>
      )}
      {items.map((item, index) => {
        const reasonId =
          item.disabled && item.disabledReason ? `${baseId}-reason-${item.key}` : undefined;
        const showReason = reasonId !== undefined && (index === active || index === hovered);
        return (
          <React.Fragment key={item.key}>
            {item.separatorBefore && index > 0 && (
              <div role="separator" className="my-1 h-px bg-line" />
            )}
            <div
              role="presentation"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
            >
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={index === active ? 0 : -1}
                aria-disabled={item.disabled || undefined}
                // The separate hint describes the item without becoming part of its visible label.
                aria-label={reasonId ? item.label : undefined}
                aria-describedby={reasonId}
                onClick={() => choose(index)}
                onFocus={() => setActive(index)}
                className={cn(
                  'flex min-h-11 w-full flex-col justify-center rounded-control px-3 py-1.5 text-left text-body font-semibold outline-none hover:bg-chrome/60 focus-visible:bg-chrome/60',
                  FOCUS,
                  item.destructive && !item.disabled && 'text-status-critical-fg',
                  item.disabled && 'cursor-not-allowed text-ink-muted hover:bg-transparent',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  {item.icon && (
                    <span aria-hidden="true" className="flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
                      {item.icon}
                    </span>
                  )}
                  <span className="flex-1">{item.label}</span>
                </span>
              </button>
              {reasonId && (
                <span
                  id={reasonId}
                  // The ID reference still exposes this description, without adding it to the label.
                  aria-hidden="true"
                  className={cn(
                    showReason
                      ? 'mt-1 block rounded-control bg-inverse px-2 py-1 text-body-sm font-medium text-ink-inverse'
                      : 'sr-only',
                  )}
                >
                  {item.disabledReason}
                </span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  ) : null;

  return (
    <span className={cn('inline-flex', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={trigger ? label : undefined}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKeyDown}
        className={cn(TRIGGER, FOCUS, open && 'bg-chrome', triggerClassName)}
      >
        {trigger ?? label}
        {chevron && (
          <ChevronDown aria-hidden="true" data-menu-chevron="" className="h-4 w-4 shrink-0" />
        )}
      </button>
      {list && createPortal(list, document.body)}
    </span>
  );
};
