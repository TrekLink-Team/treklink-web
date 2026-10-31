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

const Harness: React.FC = () => {
  const [value, setValue] = useState('');
  return (
    <>
      <AccountPicker id="who" value={value} onChange={setValue} />
      <p data-testid="value">{value}</p>
    </>
  );
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
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 't' } });
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByRole('option')).toBeNull();

    fireEvent.change(box, { target: { value: 'tran' } });
    act(() => void vi.advanceTimersByTime(300));
    expect(queries[queries.length - 1]).toEqual({ q: 'tran', enabled: true });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Tran Thi B/ }));
    expect(screen.getByTestId('value').textContent).toBe('a-1');
    expect((box as HTMLInputElement).value).toBe('Tran Thi B');
  });

  it('clears the chosen account as soon as the text changes', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'tran' } });
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.click(screen.getByRole('button', { name: /Tran Thi B/ }));
    expect(screen.getByTestId('value').textContent).toBe('a-1');

    fireEvent.change(box, { target: { value: 'Tran Thi' } });
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('closes the list on Escape', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'tran' } });
    act(() => void vi.advanceTimersByTime(300));
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });
});
