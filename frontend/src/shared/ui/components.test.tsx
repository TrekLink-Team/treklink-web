// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, StatusBadge } from './Badge';
import { ConfirmDialog } from './Dialog';
import { CONTRACT_STATUS, DEVICE_STATUS, INCIDENT_STATE, INVOICE_STATUS, TONE_CLASSES } from './status';
import { Tabs } from './Tabs';
import { Switch } from './Field';

afterEach(cleanup);

describe('status palettes (convention 06 §8.3)', () => {
  it('give every state a human label, never the raw enum', () => {
    for (const palette of [DEVICE_STATUS, CONTRACT_STATUS, INVOICE_STATUS, INCIDENT_STATE]) {
      for (const [key, entry] of Object.entries(palette)) {
        expect(entry.label).not.toBe(key);
        expect(entry.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('render the label with a glyph hidden from screen readers', () => {
    render(<StatusBadge entry={CONTRACT_STATUS.OVERDUE} />);
    const badge = screen.getByText('Overdue').parentElement!;
    expect(badge.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲');
  });

  it('recognise an entity tone class string and still show the glyph', () => {
    render(<Badge tone={TONE_CLASSES.done}>Paid</Badge>);
    expect(screen.getByText('Paid').parentElement!.textContent).toBe('✓Paid');
  });
});

const TabsHarness: React.FC = () => {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return (
    <Tabs
      label="Views"
      idPrefix="t"
      value={value}
      onChange={setValue}
      items={[
        { key: 'a', label: 'All' },
        { key: 'b', label: 'Active' },
        { key: 'c', label: 'Closed' },
      ]}
    />
  );
};

describe('Tabs (convention 06 §5.5)', () => {
  it('moves with the arrow keys, Home and End, keeping one tab stop', () => {
    render(<TabsHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Active' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Active' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Closed' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('ConfirmDialog (convention 06 §5.3, §8.1)', () => {
  it('names the object, starts on Cancel, closes on Escape and returns focus', () => {
    const onCancel = vi.fn();
    const Harness: React.FC = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Retire
          </button>
          {open && (
            <ConfirmDialog
              titleId="c"
              title="Retire device TL-0042?"
              description="It leaves the fleet."
              confirmLabel="Retire device"
              destructive
              onConfirm={() => setOpen(false)}
              onCancel={() => {
                onCancel();
                setOpen(false);
              }}
            />
          )}
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Retire' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Retire device TL-0042?' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Switch', () => {
  it('exposes its state as a switch', () => {
    const onChange = vi.fn();
    render(<Switch label="Email me" checked={false} onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Email me' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
