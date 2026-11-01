// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bits from './bits';
import { Badge } from './Badge';
import { Field } from './Field';
import { Toast } from './toast';
import { useToast } from './toastStore';
import { FilterChip } from './Toolbar';

beforeEach(() => useToast.getState().dismiss());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const show = (...args: Parameters<ReturnType<typeof useToast.getState>['show']>) => act(() => useToast.getState().show(...args));

describe('Toast tones', () => {
  it('keeps both live regions mounted while empty, so the first message is announced', () => {
    render(<Toast />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('announces success, info and warning politely with the tone as a word', () => {
    render(<Toast />);
    for (const [tone, word] of [
      ['success', 'Success'],
      ['info', 'Information'],
      ['warning', 'Warning'],
    ] as const) {
      show(`Message ${tone}`, { tone });
      expect(screen.getByRole('status').textContent).toBe(`${word}: Message ${tone}`);
      expect(screen.getByRole('alert').textContent).toBe('');
    }
  });

  it('announces an error assertively and keeps it until dismissed', () => {
    vi.useFakeTimers();
    render(<Toast />);
    show('Payment could not be recorded.', { tone: 'error' });
    expect(screen.getByRole('alert').textContent).toContain('Error: Payment could not be recorded.');
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => vi.advanceTimersByTime(30_000));
    expect(useToast.getState().message).toBe('Payment could not be recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useToast.getState().message).toBeNull();
  });

  it('clears a plain success after six seconds, as show(message) did before', () => {
    vi.useFakeTimers();
    render(<Toast />);
    show('Saved.');
    expect(useToast.getState().tone).toBe('success');
    act(() => vi.advanceTimersByTime(5_999));
    expect(useToast.getState().message).toBe('Saved.');
    act(() => vi.advanceTimersByTime(1));
    expect(useToast.getState().message).toBeNull();
  });

  it('keeps an actionable toast until used, then runs the action and closes', () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    render(<Toast />);
    show('Device retired.', { action: { label: 'Undo', onClick: undo } });
    act(() => vi.advanceTimersByTime(30_000));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(useToast.getState().message).toBeNull();
  });

  it('gives the dismiss button a 44 px target', () => {
    render(<Toast />);
    show('Saved.');
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toContain('h-11 w-11');
  });
});

describe('target sizes and the bits re-exports', () => {
  it('reaches 44 px on the filter chip remove button through its pseudo-element', () => {
    render(<FilterChip label="Status: Available" onRemove={() => undefined} />);
    const remove = screen.getByRole('button', { name: 'Remove filter Status: Available' });
    expect(remove.className).toContain('h-7 w-7');
    expect(remove.className).toContain('before:-inset-2');
  });

  it('gives the ErrorState retry a 44 px target', () => {
    const retry = vi.fn();
    render(<bits.ErrorState error={new Error('x')} onRetry={retry} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(retry).toHaveBeenCalled();
  });

  it('re-exports the shared Badge and Field instead of duplicating them', () => {
    expect(bits.Badge).toBe(Badge);
    expect(bits.Field).toBe(Field);
  });

  it('renders Pager as Pagination, and nothing for a single page', () => {
    const onPage = vi.fn();
    const { container, rerender } = render(<bits.Pager pageNumber={1} totalPages={1} onPage={onPage} />);
    expect(container.innerHTML).toBe('');
    rerender(<bits.Pager pageNumber={1} totalPages={3} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
