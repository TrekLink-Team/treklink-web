// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPicker } from './AccountPicker';

const queries: { q?: string; enabled?: boolean }[] = [];

vi.mock('../../entities/account/api', () => ({
  useAccounts: (filters: { q?: string }, _page: number, options?: { enabled?: boolean }) => {
    queries.push({ q: filters.q, enabled: options?.enabled });
    return {
      data: options?.enabled
        ? {
            items: [
              { id: 'a-1', fullName: 'Tran Thi B', email: 'staff1@treklink.vn' },
              { id: 'a-2', fullName: 'Tran Van C', email: 'staff2@treklink.vn' },
            ],
          }
        : undefined,
    };
  },
}));

const Harness: React.FC<{ initial?: string; label?: string }> = ({ initial = '', label }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AccountPicker id="who" value={value} label={label} onChange={setValue} />
      <p data-testid="value">{value}</p>
    </>
  );
};

const search = (text: string) => {
  const box = screen.getByRole('combobox');
  fireEvent.change(box, { target: { value: text } });
  act(() => void vi.advanceTimersByTime(300));
  return box;
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  queries.length = 0;
});

describe('AccountPicker', () => {
  it('searches only after two characters and a pause, and resolves a pick to the account id', () => {
    render(<Harness />);
    const box = search('t');
    expect(screen.queryByRole('option')).toBeNull();

    search('tran');
    expect(queries[queries.length - 1]).toEqual({ q: 'tran', enabled: true });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.click(screen.getByRole('option', { name: /Tran Thi B/ }));
    expect(screen.getByTestId('value').textContent).toBe('a-1');
    expect((box as HTMLInputElement).value).toBe('Tran Thi B');
  });

  it('clears the chosen account as soon as the text changes', () => {
    render(<Harness />);
    const box = search('tran');
    fireEvent.click(screen.getByRole('option', { name: /Tran Thi B/ }));
    expect(screen.getByTestId('value').textContent).toBe('a-1');

    fireEvent.change(box, { target: { value: 'Tran Thi' } });
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('closes the list on Escape', () => {
    render(<Harness />);
    const box = search('tran');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves through the matches with Up and Down and picks the highlighted one with Enter', () => {
    render(<Harness />);
    const box = search('tran');
    const ids = screen.getAllByRole('option').map((option) => option.id);

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(ids[0]);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(ids[1]);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(ids[0]);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.getAttribute('aria-activedescendant')).toBe(ids[1]);
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('a-2');
    expect((box as HTMLInputElement).value).toBe('Tran Van C');
  });

  it('leaves Enter to the form when nothing is highlighted', () => {
    render(<Harness />);
    const box = search('tran');
    const notPrevented = fireEvent.keyDown(box, { key: 'Enter' });
    expect(notPrevented).toBe(true);
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('names an account set from outside by its label, else by the account list, else by its id', () => {
    render(<Harness initial="a-9" label="staff9@treklink.vn" />);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('staff9@treklink.vn');
    cleanup();

    render(<Harness initial="a-2" />);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Tran Van C');
    cleanup();

    render(<Harness initial="a-9" />);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('a-9');
  });
});
