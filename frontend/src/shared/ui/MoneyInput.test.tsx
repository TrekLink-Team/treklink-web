// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from './Field';
import { MoneyInput } from './MoneyInput';

afterEach(cleanup);

// A form field as the screens use it: the form keeps plain digits.
const Harness: React.FC<{ initial?: string; onDigits?: (digits: string) => void; secure?: boolean; presets?: number[] }> = ({
  initial = '',
  onDigits,
  secure,
  presets,
}) => {
  const [value, setValue] = useState(initial);
  return (
    <Field id="amount" label="Amount received (VND)">
      <MoneyInput
        id="amount"
        label="Amount received"
        value={value}
        presets={presets}
        secureKeyboard={secure}
        onValueChange={(digits) => {
          setValue(digits);
          onDigits?.(digits);
        }}
      />
    </Field>
  );
};

const field = () => screen.getByLabelText('Amount received (VND)') as HTMLInputElement;

describe('MoneyInput (chapter 06 §11.10, D-101)', () => {
  it('groups the amount as it is typed and reports plain digits', () => {
    const onDigits = vi.fn();
    render(<Harness onDigits={onDigits} />);
    fireEvent.change(field(), { target: { value: '1500000', selectionStart: 7 } });
    expect(field().value).toBe('1.500.000');
    expect(onDigits).toHaveBeenLastCalledWith('1500000');
  });

  it('keeps the caret after the digit typed when a group dot moves', () => {
    render(<Harness initial="999" />);
    const input = field();
    input.focus();
    // "999" with a 9 typed after the first 9: a dot appears, the caret stays after the typed digit.
    // The prototype setter, so React sees the edit as the browser makes it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '9999');
    input.setSelectionRange(2, 2);
    fireEvent.change(input);
    expect(input.value).toBe('9.999');
    expect(input.selectionStart).toBe(3);
  });

  it('keeps the caret after a delete that removes a group dot', () => {
    render(<Harness initial="1234" />);
    const input = field();
    input.focus();
    // "1.234" with the 2 deleted: "1.34" regroups to "134", the caret after the 1.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '1.34');
    input.setSelectionRange(2, 2);
    fireEvent.change(input);
    expect(input.value).toBe('134');
    expect(input.selectionStart).toBe(1);
  });

  it('converts the shorthand 150k and 1,5tr', () => {
    const onDigits = vi.fn();
    render(<Harness onDigits={onDigits} />);
    fireEvent.change(field(), { target: { value: '150k' } });
    expect(field().value).toBe('150.000');
    expect(onDigits).toHaveBeenLastCalledWith('150000');
    fireEvent.change(field(), { target: { value: '1,5tr' } });
    expect(field().value).toBe('1.500.000');
    expect(onDigits).toHaveBeenLastCalledWith('1500000');
  });

  it.each([
    ['1.000.000 ₫', '1.000.000'],
    ['1,000,000', '1.000.000'],
    ['1000000đ', '1.000.000'],
  ])('reads a pasted %j', (pasted, shown) => {
    const onDigits = vi.fn();
    render(<Harness onDigits={onDigits} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => pasted } });
    expect(field().value).toBe(shown);
    expect(onDigits).toHaveBeenLastCalledWith('1000000');
  });

  it('appends three zeros from the 000 button, named after the field', () => {
    render(<Harness initial="15" />);
    fireEvent.click(screen.getByRole('button', { name: '000 for Amount received' }));
    expect(field().value).toBe('15.000');
  });

  it('sets a preset amount in one press', () => {
    const onDigits = vi.fn();
    render(<Harness presets={[500000, 1000000]} onDigits={onDigits} />);
    fireEvent.click(screen.getByRole('button', { name: '500.000 ₫ for Amount received' }));
    expect(field().value).toBe('500.000');
    expect(onDigits).toHaveBeenLastCalledWith('500000');
  });

  it('offers no Secure keyboard unless the field is a payment amount', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /^Secure keyboard/ })).toBeNull();
  });

  describe('Secure keyboard', () => {
    const open = () => {
      render(<Harness secure />);
      const toggle = screen.getByRole('button', { name: 'Secure keyboard for Amount received' });
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(toggle);
      return toggle;
    };
    const pad = () => screen.getByRole('group', { name: 'Secure keyboard for Amount received' });

    it('is off by default, and on it makes the field read only with focus on the first key', () => {
      const toggle = open();
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(field().readOnly).toBe(true);
      expect(field().getAttribute('inputmode')).toBe('none');
      expect(document.activeElement?.textContent).toBe('1');
    });

    it('has one tab stop and moves through the grid with the arrow keys', () => {
      open();
      const keys = Array.from(pad().querySelectorAll('button'));
      expect(keys).toHaveLength(12);
      expect(keys.filter((key) => key.tabIndex === 0)).toHaveLength(1);
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect(document.activeElement?.textContent).toBe('2ABC');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      expect(document.activeElement?.textContent).toBe('5JKL');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
      expect(document.activeElement?.textContent).toBe('1');
      // The edge stops the move.
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
      expect(document.activeElement?.textContent).toBe('1');
      fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Delete last digit');
    });

    it('presses keys, takes typed digits and Backspace, and reads the amount out', () => {
      open();
      fireEvent.click(screen.getByRole('button', { name: '1' }));
      fireEvent.click(screen.getByRole('button', { name: '5' }));
      fireEvent.keyDown(document.activeElement as Element, { key: '0' });
      fireEvent.click(within000());
      expect(field().value).toBe('150.000');
      const readout = pad().querySelector('[aria-live="polite"]') as HTMLElement;
      expect(readout.textContent).toBe('Amount received: 150.000 ₫');
      fireEvent.keyDown(document.activeElement as Element, { key: 'Backspace' });
      expect(field().value).toBe('15.000');
    });

    it('closes on Escape and returns focus to the toggle', () => {
      const toggle = open();
      act(() => {
        fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
      });
      expect(screen.queryByRole('group', { name: 'Secure keyboard for Amount received' })).toBeNull();
      expect(document.activeElement).toBe(toggle);
      expect(field().readOnly).toBe(false);
    });

    it('draws keys of at least 44 px', () => {
      open();
      for (const key of pad().querySelectorAll('button')) {
        expect(key.className).toContain('min-h-12');
        expect(key.className).toContain('min-w-12');
      }
    });
  });

  it('has no axe violation, with the numpad open', async () => {
    const { container } = render(<Harness secure presets={[500000]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Secure keyboard for Amount received' }));
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});

const within000 = () =>
  Array.from(screen.getByRole('group', { name: 'Secure keyboard for Amount received' }).querySelectorAll('button')).find(
    (key) => key.textContent === '000',
  ) as HTMLElement;
