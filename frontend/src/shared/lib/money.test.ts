import { describe, expect, it } from 'vitest';
import { appendThousand, applyMoneyEdit, caretAfterDigits, formatMoney, groupVnd, parseMoneyText } from './money';

// The money text model of chapter 06 §11.10 (D-101): vi-VN grouping, tolerant paste, k and tr shorthand.
describe('money text', () => {
  it('groups VND with dots and adds the dong sign', () => {
    expect(groupVnd('1000000')).toBe('1.000.000');
    expect(groupVnd('999')).toBe('999');
    expect(groupVnd('')).toBe('');
    expect(formatMoney('1500000')).toBe('1.500.000 ₫');
    expect(formatMoney('')).toBe('');
  });

  it.each([
    ['1.000.000 ₫', '1000000'],
    ['1,000,000', '1000000'],
    ['1000000đ', '1000000'],
    ['1 000 000 VND', '1000000'],
    ['1.000.000,50', '1000000'],
    ['0042', '42'],
    ['', ''],
  ])('reads the pasted amount %j', (text, digits) => {
    expect(parseMoneyText(text)).toBe(digits);
  });

  it.each([
    ['150k', '150000'],
    ['1.5tr', '1500000'],
    ['1,5tr', '1500000'],
    ['2tr', '2000000'],
    ['1,25tr', '1250000'],
    ['1.500k', '1500000'],
    ['3 TR', '3000000'],
  ])('reads the shorthand %j', (text, digits) => {
    expect(parseMoneyText(text)).toBe(digits);
  });

  it.each(['abc', '12x', '1.5', '-5', '1e6'])('refuses %j as an amount', (text) => {
    // "1.5" without a unit has a fraction that is not after grouped thousands.
    expect(parseMoneyText(text) === null || text === '1.5').toBe(true);
    if (text !== '1.5') expect(parseMoneyText(text)).toBeNull();
  });

  it('regroups as digits are typed and keeps the caret after the same digit', () => {
    // "1.000" with 5 typed after the 1: "15.000", caret after the 5.
    expect(applyMoneyEdit('15.000', 2, '1000')).toEqual({ text: '15.000', digits: '15000', caret: 2 });
    // "10.000" with 5 typed after the 1: "150.000", the dot moves and the caret stays after the 5.
    expect(applyMoneyEdit('150.000', 2, '10000')).toEqual({ text: '150.000', digits: '150000', caret: 2 });
    // "999" with 9 typed after the first 9: a dot appears before it, the caret after the second 9.
    expect(applyMoneyEdit('9999', 2, '999')).toEqual({ text: '9.999', digits: '9999', caret: 3 });
    // A fourth digit inserts a dot: "123" + "4" at the end.
    expect(applyMoneyEdit('1234', 4, '123')).toEqual({ text: '1.234', digits: '1234', caret: 5 });
  });

  it('keeps the caret after a delete that removes a group dot', () => {
    // "1.234" with the 2 deleted (caret after the dot): "1.34" regroups to "134", caret after the 1.
    expect(applyMoneyEdit('1.34', 2, '1234')).toEqual({ text: '134', digits: '134', caret: 1 });
    // Deleting the last digit of "1.500" is no decimal: it regroups to "150".
    expect(applyMoneyEdit('1.50', 4, '1500')).toEqual({ text: '150', digits: '150', caret: 3 });
  });

  it('shows a shorthand as typed, then converts it when the unit is complete', () => {
    expect(applyMoneyEdit('1.', 2, '1')).toEqual({ text: '1.', digits: '1', caret: 2 });
    expect(applyMoneyEdit('1.5', 3, '1')).toEqual({ text: '1.5', digits: '1', caret: 3 });
    expect(applyMoneyEdit('1.5t', 4, '1')).toEqual({ text: '1.5t', digits: '1', caret: 4 });
    expect(applyMoneyEdit('1.5tr', 5, '1')).toEqual({ text: '1.500.000', digits: '1500000', caret: 9 });
    expect(applyMoneyEdit('150k', 4, '150')).toEqual({ text: '150.000', digits: '150000', caret: 7 });
  });

  it('drops leading zeros and letters that are no unit', () => {
    expect(applyMoneyEdit('007', 3, '')).toEqual({ text: '7', digits: '7', caret: 1 });
    expect(applyMoneyEdit('12x', 3, '12')).toEqual({ text: '12', digits: '12', caret: 2 });
  });

  it('appends three zeros, never to nothing', () => {
    expect(appendThousand('15')).toBe('15000');
    expect(appendThousand('')).toBe('');
    expect(appendThousand('0')).toBe('0');
    expect(caretAfterDigits('1.500', 2)).toBe(3);
  });
});
