// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { BulkActionDialog, runInSequence } from './BulkAction';
import { REASON_REQUIRED } from './StateChange';
import { useToast } from './toastStore';

beforeEach(() => useToast.getState().dismiss());
afterEach(cleanup);

const ITEMS = [
  { id: 'd-1', label: 'TL-0001' },
  { id: 'd-2', label: 'TL-0002' },
  { id: 'd-3', label: 'TL-0003' },
];

const stale = () => new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.');

describe('runInSequence', () => {
  it('runs one row at a time and keeps going after a failure', async () => {
    const order: string[] = [];
    const run = vi.fn(async (item: { id: string }) => {
      order.push(`start ${item.id}`);
      await Promise.resolve();
      order.push(`end ${item.id}`);
      if (item.id === 'd-2') throw stale();
    });
    const outcomes = await runInSequence(ITEMS, run);
    expect(order).toEqual(['start d-1', 'end d-1', 'start d-2', 'end d-2', 'start d-3', 'end d-3']);
    expect(outcomes.map((outcome) => [outcome.label, outcome.ok, outcome.reason])).toEqual([
      ['TL-0001', true, undefined],
      ['TL-0002', false, 'This was changed by someone else. Reload and try again.'],
      ['TL-0003', true, undefined],
    ]);
  });
});

describe('BulkActionDialog', () => {
  it('asks for a reason before a destructive bulk change, titled with the count', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(
      <BulkActionDialog
        title="Retire 3 devices?"
        confirmLabel="Retire 3 devices"
        destructive
        needsReason
        items={ITEMS}
        run={run}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Retire 3 devices?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retire 3 devices' }));
    expect(await screen.findByText(REASON_REQUIRED)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  it('shows the per-row summary when a row fails, with the server reason', async () => {
    const run = vi.fn((item: { id: string }) => (item.id === 'd-2' ? Promise.reject(stale()) : Promise.resolve()));
    const onFinished = vi.fn();
    render(
      <BulkActionDialog
        title="Retire 3 devices?"
        confirmLabel="Retire 3 devices"
        destructive
        needsReason
        items={ITEMS}
        run={run}
        onFinished={onFinished}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Water damage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retire 3 devices' }));
    expect(await screen.findByRole('dialog', { name: '2 of 3 done' })).toBeTruthy();
    expect(screen.getByText('TL-0002').closest('li')?.textContent).toContain('Reload and try again');
    expect(run).toHaveBeenCalledWith(ITEMS[0], 'Water damage');
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('closes with a success toast when every row succeeds', async () => {
    const onClose = vi.fn();
    render(
      <BulkActionDialog title="Approve 3 charges?" confirmLabel="Approve 3 charges" items={ITEMS} run={vi.fn().mockResolvedValue(undefined)} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve 3 charges' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useToast.getState().message).toBe('3 of 3 done.');
  });
});

describe('BulkActionDialog confirmations', () => {
  it('runs only once every step is ticked', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(
      <BulkActionDialog
        title="Record reset for 3 devices?"
        confirmLabel="Record reset for 3 devices"
        confirmations={['Key removed', 'Owner cleared']}
        items={ITEMS}
        run={run}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Key removed'));
    fireEvent.click(screen.getByRole('button', { name: 'Record reset for 3 devices' }));
    expect(await screen.findByText('Tick every step for every selected row first.')).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Owner cleared'));
    fireEvent.click(screen.getByRole('button', { name: 'Record reset for 3 devices' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
  });
});
