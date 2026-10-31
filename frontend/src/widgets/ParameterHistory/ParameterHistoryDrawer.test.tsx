// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParameterHistoryItem } from '../../entities/parameter/api';
import { ApiError } from '../../shared/api/apiClient';
import { ParameterHistoryDrawer } from './ParameterHistoryDrawer';

const KEY = 'incidents.primaryAckTimeoutSeconds';
const refetch = vi.fn();
const pages: number[] = [];
let state: {
  data?: { items: ParameterHistoryItem[]; totalPages: number; totalCount: number };
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

vi.mock('../../entities/parameter/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/parameter/api')>()),
  useParameterHistory: (_key: string, pageNumber: number) => {
    pages.push(pageNumber);
    return { ...state, refetch };
  },
}));

const item = (overrides: Partial<ParameterHistoryItem> = {}): ParameterHistoryItem => ({
  previousValue: 120,
  newValue: 90,
  changedBy: { id: 'u-1', fullName: 'TrekLink Admin' },
  reason: 'Faster escalation for the drill',
  changedAt: '2026-10-20T03:15:00.000Z',
  ...overrides,
});

const open = (onClose = vi.fn()) =>
  render(<ParameterHistoryDrawer parameterKey={KEY} onClose={onClose} />);

afterEach(() => {
  cleanup();
  refetch.mockReset();
  pages.length = 0;
});

describe('ParameterHistoryDrawer (screen 7.4)', () => {
  it('shows the previous and new value, the actor, the time and the reason', () => {
    state = {
      data: { items: [item(), item({ changedBy: null, reason: null, changedAt: '2026-10-19T03:15:00.000Z' })], totalPages: 1, totalCount: 2 },
      isPending: false,
      isError: false,
      error: null,
    };
    open();
    expect(screen.getByRole('dialog', { name: `History of ${KEY}` })).toBeTruthy();
    expect(screen.getByText('Reason: Faster escalation for the drill')).toBeTruthy();
    expect(screen.getByText(/^TrekLink Admin, /)).toBeTruthy();
    expect(screen.getByText(/^SYSTEM, /)).toBeTruthy();
    expect(screen.getAllByText('120')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('says the parameter has not changed since the seed', () => {
    state = { data: { items: [], totalPages: 1, totalCount: 0 }, isPending: false, isError: false, error: null };
    open();
    expect(screen.getByText('This parameter has not been changed since the seed.')).toBeTruthy();
  });

  it('shows skeletons while loading', () => {
    state = { isPending: true, isError: false, error: null };
    open();
    expect(screen.getByRole('status', { name: 'Loading history' })).toBeTruthy();
  });

  it('shows the error with Retry', () => {
    state = {
      isPending: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL_ERROR', 'History is unavailable.'),
    };
    open();
    expect(screen.getByText('History is unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('pages the history and closes with the button', () => {
    state = {
      data: { items: [item()], totalPages: 3, totalCount: 25 },
      isPending: false,
      isError: false,
      error: null,
    };
    const onClose = vi.fn();
    open(onClose);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(pages[pages.length - 1]).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: `Close History of ${KEY}` }));
    expect(onClose).toHaveBeenCalled();
  });
});
