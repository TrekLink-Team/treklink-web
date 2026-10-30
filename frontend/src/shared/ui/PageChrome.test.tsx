// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import {
  COMPACT_AFTER_PX,
  PageActionBar,
  PageChromeProvider,
  StickyPageHeader,
} from './PageChrome';
import { PageHeader } from './PageHeader';

// jsdom has no IntersectionObserver: this one records the options and lets a test move the sentinel.
type Observed = {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  target?: Element;
};
let observers: Observed[] = [];
class FakeIntersectionObserver {
  private record: Observed;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.record = { callback, options };
    observers.push(this.record);
  }
  observe(target: Element) {
    this.record.target = target;
  }
  disconnect() {
    observers = observers.filter((observer) => observer !== this.record);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

const scrollSentinel = (visible: boolean) =>
  act(() => {
    for (const observer of observers) {
      observer.callback(
        [{ isIntersecting: visible, target: observer.target } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    }
  });

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const regionOf = () => screen.getByRole('heading', { level: 1 }).closest('[data-compact]')!;

describe('StickyPageHeader (leader rule of 2026-10-30)', () => {
  it('starts full height and turns compact once the sentinel has scrolled out of view', () => {
    render(
      <StickyPageHeader>
        <PageHeader title="Counter handover" description="ORG-0007, monthly plan" />
      </StickyPageHeader>,
    );
    expect(regionOf().getAttribute('data-compact')).toBe('false');
    expect(regionOf().className).toContain('sticky');
    expect(regionOf().className).toContain('top-0');

    scrollSentinel(false);
    expect(regionOf().getAttribute('data-compact')).toBe('true');

    scrollSentinel(true);
    expect(regionOf().getAttribute('data-compact')).toBe('false');
  });

  it('watches one sentinel above the header, with the compact threshold as the top root margin', () => {
    render(
      <StickyPageHeader>
        <PageHeader title="Counter handover" />
      </StickyPageHeader>,
    );
    expect(observers).toHaveLength(1);
    expect(observers[0].options?.rootMargin).toBe(`${COMPACT_AFTER_PX}px 0px 0px 0px`);
    const sentinel = observers[0].target!;
    expect(
      sentinel.compareDocumentPosition(regionOf()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('marks the description and title so they shrink while compact', () => {
    render(
      <StickyPageHeader>
        <PageHeader title="Counter handover" description="ORG-0007, monthly plan" />
      </StickyPageHeader>,
    );
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'group-data-[compact=true]/chrome:text-title-sm',
    );
    expect(screen.getByText('ORG-0007, monthly plan').className).toContain(
      'group-data-[compact=true]/chrome:hidden',
    );
  });

  it("takes the shell's breadcrumb into the sticky region and gives it back on unmount", () => {
    const release = vi.fn();
    const claim = vi.fn(() => release);
    const { unmount } = render(
      <PageChromeProvider
        value={{ breadcrumb: <nav aria-label="Breadcrumb">Business / Contracts</nav>, claim }}
      >
        <StickyPageHeader>
          <PageHeader title="Counter handover" />
        </StickyPageHeader>
      </PageChromeProvider>,
    );
    expect(claim).toHaveBeenCalledTimes(1);
    expect(
      within(regionOf() as HTMLElement).getByRole('navigation', { name: 'Breadcrumb' }),
    ).toBeTruthy();
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('PageActionBar (leader rule of 2026-10-30)', () => {
  it('renders Back on the left and the primary action on the right, as a named group', () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    render(
      <PageActionBar
        label="Handover steps"
        start={
          <button type="button" onClick={onBack}>
            Back
          </button>
        }
      >
        <button type="button" onClick={onNext}>
          Next
        </button>
      </PageActionBar>,
    );
    const bar = screen.getByRole('group', { name: 'Handover steps' });
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).toContain('env(safe-area-inset-bottom)');
    const [back, next] = within(bar).getAllByRole('button');
    expect(back.textContent).toBe('Back');
    expect(next.textContent).toBe('Next');
    fireEvent.click(back);
    fireEvent.click(next);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('keeps mt-auto when a page passes its own margin, so the bar stays at the bottom', () => {
    render(
      <PageActionBar label="Steps" className="mt-5">
        <button type="button">Next</button>
      </PageActionBar>,
    );
    const classes = screen.getByRole('group', { name: 'Steps' }).className.split(' ');
    expect(classes).toContain('mt-auto');
    expect(classes).not.toContain('mt-5');
  });

  it('submits a form elsewhere on the page through the form attribute', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <>
        <form id="sign-form" onSubmit={onSubmit}>
          <input aria-label="Identity" />
        </form>
        <PageActionBar label="Sign">
          <button type="submit" form="sign-form">
            Complete handover
          </button>
        </PageActionBar>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete handover' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('PageActionBar keeps focus clear of its edge', () => {
  const rect = (top: number, bottom: number) =>
    ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top }) as DOMRect;
  // jsdom has no scrollIntoView.
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('scrolls a covered page control into view but leaves a modal dialog alone', () => {
    render(
      <>
        <input aria-label="Notes" />
        <PageActionBar label="Steps">
          <button type="button">Next</button>
        </PageActionBar>
        <Dialog titleId="confirm" title="Confirm" onClose={() => undefined}>
          <button type="button">Confirm return</button>
        </Dialog>
      </>,
    );
    // The bar covers 500 to 560; both controls end below its top edge.
    vi.spyOn(screen.getByRole('group', { name: 'Steps' }), 'getBoundingClientRect').mockReturnValue(
      rect(500, 560),
    );
    const inDialog = screen.getByRole('button', { name: 'Confirm return' });
    const onPage = screen.getByRole('textbox', { name: 'Notes' });
    vi.spyOn(inDialog, 'getBoundingClientRect').mockReturnValue(rect(520, 550));
    vi.spyOn(onPage, 'getBoundingClientRect').mockReturnValue(rect(520, 550));

    fireEvent.focusIn(inDialog);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.focusIn(onPage);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(onPage);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('still clears a control in the same dialog as the bar', () => {
    render(
      <div role="dialog" aria-modal="true" aria-label="Wizard">
        <input aria-label="Serial" />
        <PageActionBar label="Wizard steps">
          <button type="button">Next</button>
        </PageActionBar>
      </div>,
    );
    vi.spyOn(
      screen.getByRole('group', { name: 'Wizard steps' }),
      'getBoundingClientRect',
    ).mockReturnValue(rect(500, 560));
    const field = screen.getByRole('textbox', { name: 'Serial' });
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect(520, 550));
    fireEvent.focusIn(field);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('Dialog with a footer (leader rule of 2026-10-30)', () => {
  it('keeps the footer outside the scrolling body', () => {
    render(
      <Dialog
        titleId="d"
        title="Complete maintenance for TL-0042"
        onClose={() => undefined}
        footer={<button type="button">Save</button>}
      >
        <p>Long checklist</p>
      </Dialog>,
    );
    const body = screen.getByText('Long checklist').parentElement!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false);
    expect(
      body.contains(screen.getByRole('heading', { name: 'Complete maintenance for TL-0042' })),
    ).toBe(false);
  });
});
