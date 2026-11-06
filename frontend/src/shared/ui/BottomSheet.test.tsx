// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BottomSheet, type SheetState } from './BottomSheet';

afterEach(cleanup);

const Harness: React.FC<{ start?: SheetState }> = ({ start = 'peek' }) => {
  const [state, setState] = useState<SheetState>(start);
  return (
    <BottomSheet
      label="Devices"
      summary="3 devices, 1 SOS open"
      state={state}
      onStateChange={setState}
    >
      <p>the list</p>
    </BottomSheet>
  );
};

const handle = () => screen.getByRole('button', { name: /3 devices, 1 SOS open/ });
const sheet = () => screen.getByRole('complementary', { name: 'Devices' });

describe('BottomSheet (screen 9.1, 360 px)', () => {
  it('rests at its peek with the summary and no body', () => {
    render(<Harness />);
    expect(sheet().getAttribute('data-sheet')).toBe('peek');
    expect(handle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('the list')).toBeNull();
  });

  it('moves peek, half, full and back to peek with the handle, no dragging needed', () => {
    render(<Harness />);
    fireEvent.click(handle());
    expect(sheet().getAttribute('data-sheet')).toBe('half');
    expect(screen.getByText('the list')).toBeTruthy();
    expect(handle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(handle());
    expect(sheet().getAttribute('data-sheet')).toBe('full');
    fireEvent.click(handle());
    expect(sheet().getAttribute('data-sheet')).toBe('peek');
    expect(screen.queryByText('the list')).toBeNull();
  });

  it('tells a screen reader what the handle does next', () => {
    render(<Harness />);
    expect(handle().textContent).toContain('open the panel');
    fireEvent.click(handle());
    expect(handle().textContent).toContain('open the panel further');
    fireEvent.click(handle());
    expect(handle().textContent).toContain('close the panel');
  });

  it('closes to the peek on Escape from the handle, and ignores Escape at the peek', () => {
    render(<Harness start="full" />);
    fireEvent.keyDown(handle(), { key: 'Escape' });
    expect(sheet().getAttribute('data-sheet')).toBe('peek');
    fireEvent.keyDown(handle(), { key: 'Escape' });
    expect(sheet().getAttribute('data-sheet')).toBe('peek');
  });
});
