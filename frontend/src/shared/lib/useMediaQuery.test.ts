// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

const stubMatchMedia = (initial: boolean) => {
  let listener: (() => void) | undefined;
  const list = {
    matches: initial,
    addEventListener: vi.fn((_type: string, next: () => void) => {
      listener = next;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list),
  );
  return {
    list,
    change: (matches: boolean) => {
      list.matches = matches;
      listener?.();
    },
  };
};

describe('useMediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers the fallback when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useMediaQuery('(min-width: 768px)', true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery('(min-width: 768px)')).result.current).toBe(false);
  });

  it('starts with the current match and follows the change event', () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
    act(() => media.change(false));
    expect(result.current).toBe(false);
    act(() => media.change(true));
    expect(result.current).toBe(true);
  });

  it('stops listening when the component unmounts', () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    unmount();
    expect(media.list.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
