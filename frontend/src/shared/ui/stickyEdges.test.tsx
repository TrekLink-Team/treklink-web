// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractActionBar } from '../../widgets/ContractHome/ContractActionBar';
import { CollectionView } from './collection-view';

// jsdom has no ResizeObserver: this one reports the element once, when it is observed.
class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

// A matchMedia whose width the test changes, with the change events the hooks listen to.
let width = 1280;
const listeners = new Set<() => void>();
const media = (query: string) => ({
  get matches() {
    return width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  },
  media: query,
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
});
const resizeTo = (next: number) =>
  act(() => {
    width = next;
    listeners.forEach((listener) => listener());
  });

const published = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  width = 1280;
  listeners.clear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', media);
  // Each sticky element reports its own height: the command bar 52, the wide row 54, the phone row 46.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.matches('[role="region"][aria-label="Contract sections and actions"]')) return 54;
    if (this.matches('[role="region"]')) return 46;
    if (this.querySelector(':scope > [role="group"][aria-label$=": commands"]')) return 52;
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--tl-collection-bar-h');
  document.documentElement.style.removeProperty('--tl-page-header-h');
});

interface Row {
  id: string;
}
const ROWS: Row[] = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

const list = (items: Row[] | undefined) => (
  <MemoryRouter>
    <CollectionView<Row>
      label="Invoices"
      items={items}
      itemId={(row) => row.id}
      itemName={(row) => row.id}
      fields={[]}
      noun={{ one: 'invoice', other: 'invoices' }}
      emptyState={{ title: 'None' }}
    />
  </MemoryRouter>
);

describe('sticky edges follow their element (review of treklink-web#349, 2.4.11)', () => {
  it('leaves the CollectionView command bar out: it is not sticky, so it publishes no height (W30)', () => {
    // The bar sits above the items and is never sticky (chapter 06 §9.3, §11.1); a sticky bar with
    // the page-header offset floated over the rows of a list inside a PageScrollBody.
    const { rerender } = render(list(ROWS.slice(0, 2)));
    rerender(list(ROWS));
    expect(screen.getByRole('group', { name: 'Invoices: commands' })).toBeTruthy();
    expect(published('--tl-collection-bar-h')).toBe('');
  });

  it('moves no focus for a CollectionView command bar (W30)', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    render(list(ROWS));
    const bar = screen.getByRole('group', { name: 'Invoices: commands' }).parentElement!;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 60 } as DOMRect);
    const below = screen.getByRole('button', { name: 'Show details of b' });
    vi.spyOn(below, 'getBoundingClientRect').mockReturnValue({ top: 30, bottom: 70 } as DOMRect);
    fireEvent.focusIn(below);
    expect(scrollIntoView).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('publishes the contract row again when it is swapped across 768 px', () => {
    render(
      <MemoryRouter>
        <ContractActionBar
          tabs={[{ key: 'overview', label: 'Overview' }]}
          tab="overview"
          onTab={() => undefined}
          overviewHref="/t/contracts/c-1"
          actions={{ primary: null, idle: 'No action due', more: [] }}
          onAction={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(published('--tl-collection-bar-h')).toBe('54px');
    // 700 px is a phone layout now (chapter 06 §11.1, treklink-web#450).
    resizeTo(700);
    expect(screen.queryByRole('region', { name: 'Contract sections and actions' })).toBeNull();
    expect(published('--tl-collection-bar-h')).toBe('46px');
    // The phone row's name differs from its tablist's (review of treklink-web#349).
    expect(screen.getByRole('region', { name: 'Contract navigation' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Contract sections' })).toBeTruthy();
    resizeTo(1280);
    expect(published('--tl-collection-bar-h')).toBe('54px');
  });
});
