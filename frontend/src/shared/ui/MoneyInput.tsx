import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { appendThousand, applyMoneyEdit, groupVnd, parseMoneyText } from '../lib/money';
import { cn } from './cn';
import { FOCUS, INPUT } from './styles';

// The shared money input (chapter 06 §11.10, D-101, ui standard §4). It shows the amount in the vi-VN
// form `1.000.000 ₫`, grouped as the person types with the caret kept, reads pasted amounts and the `k`
// and `tr` shorthand, appends three zeros from its "000" button and sets presets in one press. A payment
// amount offers a Secure keyboard: an on-screen numpad under the field, off by default. The form keeps
// and sends plain digits, as before.

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  id: string;
  /** The amount as plain digits, '' when empty. */
  value: string;
  onValueChange: (digits: string) => void;
  /** The field's visible label, which names its buttons ("000 for Amount received"). */
  label: string;
  /** Amounts offered as chips that set the field in one press. */
  presets?: number[];
  /** Offers the Secure keyboard toggle (payment amount fields). */
  secureKeyboard?: boolean;
  invalid?: boolean;
}

const KEYS: { key: string; hint?: string }[] = [
  { key: '1' },
  { key: '2', hint: 'ABC' },
  { key: '3', hint: 'DEF' },
  { key: '4', hint: 'GHI' },
  { key: '5', hint: 'JKL' },
  { key: '6', hint: 'MNO' },
  { key: '7', hint: 'PQRS' },
  { key: '8', hint: 'TUV' },
  { key: '9', hint: 'WXYZ' },
  { key: '000' },
  { key: '0' },
  { key: 'back' },
];
const COLUMNS = 3;

const CHIP = `inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-3 text-body-sm font-semibold text-ink hover:bg-sunken ${FOCUS}`;

export const MoneyInput: React.FC<MoneyInputProps> = ({
  id,
  value,
  onValueChange,
  label,
  presets,
  secureKeyboard = false,
  invalid,
  className,
  onBlur,
  disabled,
  ...rest
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const keyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const caretRef = useRef<number | null>(null);
  const padId = useId();
  // What the field shows: the grouped value, or a shorthand still being typed.
  const [text, setText] = useState(() => groupVnd(value));
  const [secure, setSecure] = useState(false);
  const [active, setActive] = useState(0);

  // A value set from outside (a reset, a preset of the page) replaces the text; checked while rendering,
  // so the field never shows a stale amount for one frame.
  const [shownFor, setShownFor] = useState(value);
  if (value !== shownFor) {
    setShownFor(value);
    if (parseMoneyText(text) !== value) setText(groupVnd(value));
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caretRef.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

  const commit = (digits: string, shown = groupVnd(digits)) => {
    setText(shown);
    if (digits !== value) onValueChange(digits);
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const edit = applyMoneyEdit(raw, event.target.selectionStart ?? raw.length, value);
    caretRef.current = edit.caret;
    commit(edit.digits, edit.text);
  };

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = parseMoneyText(event.clipboardData.getData('text'));
    if (pasted === null) return;
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const raw = `${text.slice(0, start)}${pasted}${text.slice(end)}`;
    const edit = applyMoneyEdit(raw, start + pasted.length, value);
    caretRef.current = edit.caret;
    commit(edit.digits, edit.text);
  };

  const press = (key: string) => {
    if (key === 'back') commit(value.slice(0, -1));
    else if (key === '000') commit(appendThousand(value));
    else commit(applyMoneyEdit(`${value}${key}`, value.length + 1, value).digits);
  };

  const openPad = (open: boolean) => {
    setSecure(open);
    if (open) setActive(0);
  };

  useEffect(() => {
    if (secure) keyRefs.current[active]?.focus();
    // Focus moves into the pad only when it opens or the active key changes.
  }, [secure, active]);

  const onPadKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const next = active + move;
      if (next >= 0 && next < KEYS.length) setActive(next);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : KEYS.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setSecure(false);
      toggleRef.current?.focus();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      press('back');
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-40">
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode={secure ? 'none' : 'numeric'}
            autoComplete="off"
            readOnly={secure}
            value={text}
            onChange={onChange}
            onPaste={onPaste}
            onBlur={(event) => {
              // A shorthand left unfinished settles on the kept amount.
              setText(groupVnd(value));
              onBlur?.(event);
            }}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(INPUT, 'w-full pr-9 text-right tabular-nums', className)}
            {...rest}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body text-ink-muted"
          >
            ₫
          </span>
        </div>
        <button
          type="button"
          className={cn(CHIP, 'min-w-11 justify-center')}
          disabled={disabled}
          onClick={() => {
            commit(appendThousand(value));
            inputRef.current?.focus();
          }}
        >
          000 <span className="sr-only">for {label}</span>
        </button>
        {secureKeyboard && (
          <button
            ref={toggleRef}
            type="button"
            aria-pressed={secure}
            aria-controls={secure ? padId : undefined}
            className={cn(CHIP, secure && 'border-accent bg-sunken')}
            disabled={disabled}
            onClick={() => openPad(!secure)}
          >
            Secure keyboard <span className="sr-only">for {label}</span>
          </button>
        )}
      </div>

      {presets && presets.length > 0 && (
        <div role="group" aria-label={`Amounts for ${label}`} className="flex flex-wrap gap-2">
          {presets.map((amount) => (
            <button
              key={amount}
              type="button"
              className={CHIP}
              disabled={disabled}
              onClick={() => {
                commit(String(amount));
                inputRef.current?.focus();
              }}
            >
              {groupVnd(String(amount))} ₫ <span className="sr-only">for {label}</span>
            </button>
          ))}
        </div>
      )}

      {secure && (
        <div
          id={padId}
          role="group"
          aria-label={`Secure keyboard for ${label}`}
          onKeyDown={onPadKeyDown}
          className="rounded-panel border border-line bg-surface-raised p-2 shadow-raise"
        >
          <p aria-live="polite" className="mb-2 text-right text-body font-semibold tabular-nums text-ink">
            <span className="sr-only">{label}:</span>{' '}
            {value === '' ? 'Empty' : `${groupVnd(value)} ₫`}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map(({ key, hint }, index) => (
              <button
                key={key}
                ref={(node) => {
                  keyRefs.current[index] = node;
                }}
                type="button"
                tabIndex={index === active ? 0 : -1}
                aria-label={key === 'back' ? 'Delete last digit' : undefined}
                onClick={() => {
                  setActive(index);
                  press(key);
                }}
                className={cn(
                  'flex min-h-12 min-w-12 flex-col items-center justify-center rounded-control border border-line-strong bg-surface text-title-sm font-semibold tabular-nums text-ink hover:bg-sunken active:bg-sunken',
                  FOCUS,
                )}
              >
                {key === 'back' ? <Delete aria-hidden="true" className="h-5 w-5" /> : key}
                {hint && (
                  <span aria-hidden="true" className="text-caption font-normal tracking-wide text-ink-muted">
                    {hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
