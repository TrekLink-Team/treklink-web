// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirmStep } from './useConfirmStep';

afterEach(cleanup);

const Harness: React.FC<{ then: () => void }> = ({ then }) => {
  const discard = useConfirmStep();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          discard.ask(
            { title: 'Discard this payment?', description: 'Nothing is recorded.', confirmLabel: 'Discard' },
            then,
          )
        }
      >
        Close
      </button>
      {discard.dialog}
    </>
  );
};

describe('useConfirmStep', () => {
  it('asks in a dialog, never window.confirm, and runs the step only on confirm', () => {
    const then = vi.fn();
    const native = vi.spyOn(window, 'confirm');
    render(<Harness then={then} />);
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.click(close);
    const dialog = screen.getByRole('dialog', { name: 'Discard this payment?' });
    expect(dialog.textContent).toContain('Nothing is recorded.');
    // Cancel, the least destructive control, closes the question and keeps editing.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(then).not.toHaveBeenCalled();

    fireEvent.click(close);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(then).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(native).not.toHaveBeenCalled();
  });
});
