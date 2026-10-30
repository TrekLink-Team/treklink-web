// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebounced } from './useDebounced';

describe('useDebounced', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles on the last value once it has been still for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), {
      initialProps: { value: '' },
    });
    rerender({ value: 'T' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: 'TL' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('TL');
  });
});
