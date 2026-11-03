import React, { useId, useState } from 'react';
import { IconButton } from '../Button';
import { cn } from '../cn';

interface Props {
  /** The verb shown in the tooltip ("Edit"). */
  tooltip: string;
  /** The accessible name, starting with the tooltip text ("Edit TL-0042", WCAG 2.5.3). */
  name: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Shown but unavailable: the reason shows in the tooltip and is the button's description. */
  unavailableReason?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** A short visible label next to the icon ("Live map"). */
  shortLabel?: string;
  /** Where the tooltip lines up with the button. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * An icon button with the tooltip of chapter 06 §9.5 (WCAG 1.4.13): it shows on pointer hover and
 * on keyboard focus, stays while the pointer moves onto it, stays until hover and focus have both
 * left, and closes on Escape without moving focus. It is `role="tooltip"`. The native `title` is
 * not used: it does not show on focus or touch and cannot be dismissed.
 */
export const TooltipButton = React.forwardRef<HTMLButtonElement, Props>(function TooltipButton(
  { tooltip, name, icon, onClick, unavailableReason, pressed, disabled, shortLabel, align = 'end', className },
  ref,
) {
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const unavailable = unavailableReason !== undefined;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      // The innermost layer closes first (§9.4 rule 5): the tooltip, not the selection.
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  const commonEvents = {
    onFocus: () => {
      setFocused(true);
      setDismissed(false);
    },
    onBlur: () => setFocused(false),
    onKeyDown,
  };

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {shortLabel ? (
        <button
          ref={ref}
          type="button"
          aria-label={name}
          aria-pressed={pressed}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? tipId : undefined}
          disabled={disabled}
          onClick={() => {
            if (!unavailable) onClick();
          }}
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-control px-2.5 text-body-sm font-semibold text-ink transition duration-tl ease-tl hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55',
            unavailable && 'cursor-not-allowed text-ink-muted',
          )}
          {...commonEvents}
        >
          <span aria-hidden="true" className="flex [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
          <span aria-hidden="true">{shortLabel}</span>
        </button>
      ) : (
        <IconButton
          ref={ref}
          label={name}
          icon={icon}
          title={undefined}
          pressed={pressed}
          disabled={disabled}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? tipId : undefined}
          onClick={() => {
            if (!unavailable) onClick();
          }}
          className={cn(unavailable && 'cursor-not-allowed text-ink-muted opacity-70')}
          {...commonEvents}
        />
      )}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute bottom-full z-toast mb-1.5 flex w-max max-w-[16rem] flex-col rounded-badge bg-inverse px-2 py-1 text-body-sm font-semibold text-ink-inverse shadow-overlay',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <span>{tooltip}</span>
          {unavailable && (
            <span id={tipId} className="font-medium">
              {unavailableReason}
            </span>
          )}
        </span>
      )}
      {!open && unavailable && (
        <span id={tipId} className="sr-only">
          {unavailableReason}
        </span>
      )}
    </span>
  );
});
