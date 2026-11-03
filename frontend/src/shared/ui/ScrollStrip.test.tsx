// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { ScrollStrip } from './ScrollStrip';

// jsdom has no layout: a strip 300 px wide holding 900 px of content, scrolled to `left`.
const overflowing = (left: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockReturnValue(left);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ScrollStrip (chapter 06 §10.6)', () => {
  it('shows the right hint only at the start, out of the tab order and hidden from screen readers', () => {
    overflowing(0);
    render(
      <ScrollStrip role="group" aria-label="Filter by status">
        <button type="button">Available</button>
      </ScrollStrip>,
    );
    const right = document.querySelector<HTMLButtonElement>('[data-scroll-hint="right"]')!;
    expect(right).toBeTruthy();
    expect(right.tabIndex).toBe(-1);
    expect(right.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-scroll-hint="left"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Filter by status' }).parentElement?.className).toContain('relative');
  });

  it('scrolls about 70 % of the visible width per arrow, and shows both hints mid-way', () => {
    overflowing(200);
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
    render(
      <ScrollStrip>
        <button type="button">Step</button>
      </ScrollStrip>,
    );
    expect(document.querySelector('[data-scroll-hint="left"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-scroll-hint="right"]')!);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 210 }));
    delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
  });

  it('gives a strip with no focusable item a name and a tab stop while it overflows', () => {
    overflowing(0);
    render(
      <ScrollStrip scrollLabel="Handover steps">
        <span>1. Devices</span>
      </ScrollStrip>,
    );
    const strip = screen.getByLabelText('Handover steps');
    expect(strip.tabIndex).toBe(0);
  });
});

describe('Badge with detail after it (design handoff item 12)', () => {
  it('keeps the badge to its words and puts the detail beside it as text', () => {
    render(
      <Badge tone="ended" after="02 Nov 2026">
        Revoked
      </Badge>,
    );
    const badge = screen.getByText('Revoked').parentElement!;
    expect(badge.textContent).toContain('Revoked');
    expect(badge.textContent).not.toContain('02 Nov 2026');
    expect(screen.getByText('02 Nov 2026').className).toContain('text-ink-muted');
  });
});
