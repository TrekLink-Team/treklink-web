// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from './Menu';

afterEach(cleanup);

const items = (onSelect = vi.fn()): MenuItem[] => [
  { key: 'edit', label: 'Edit device', onSelect: () => onSelect('edit') },
  {
    key: 'retire',
    label: 'Retire device',
    onSelect: () => onSelect('retire'),
    disabled: true,
    disabledReason: 'Only an available device can be retired.',
  },
  { key: 'history', label: 'Show history', onSelect: () => onSelect('history') },
];

const open = () => {
  const button = screen.getByRole('button', { name: 'Actions for TL-0042' });
  fireEvent.click(button);
  return button;
};

describe('Menu (menu button pattern)', () => {
  it('names the button and links it to the open menu', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    const button = screen.getByRole('button', { name: 'Actions for TL-0042' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Actions for TL-0042' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('opens on the first item, moves with the arrows, Home and End, and keeps one tab stop', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    open();
    const [first, second, third] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(first);
    expect([first, second, third].map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    expect([first, second, third].map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(second, { key: 'End' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 's' });
    expect(document.activeElement).toBe(third);
  });

  it('opens on the last item with Up Arrow and on the first with Down Arrow', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    const button = screen.getByRole('button', { name: 'Actions for TL-0042' });
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Show history');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Edit device');
  });

  it('closes on Escape and returns focus to the button', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    const button = open();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('chooses with Enter, Space or a click, then closes on the button', () => {
    const onSelect = vi.fn();
    render(<Menu label="Actions for TL-0042" items={items(onSelect)} />);
    const button = open();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('edit');
    expect(document.activeElement).toBe(button);
    open();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('history');
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit device' }));
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a disabled item focusable, refuses it, and reads its reason as the description', () => {
    const onSelect = vi.fn();
    render(<Menu label="Actions for TL-0042" items={items(onSelect)} />);
    open();
    const retire = screen.getByRole('menuitem', {
      name: 'Retire device',
      description: 'Only an available device can be retired.',
    });
    expect(retire.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(retire.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('Only an available device can be retired.');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(retire);
    fireEvent.keyDown(retire, { key: 'Enter' });
    fireEvent.click(retire);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('shows the reason after a disabled click without relying on browser focus', () => {
    const onSelect = vi.fn();
    render(<Menu label="Actions for TL-0042" items={items(onSelect)} />);
    open();
    const retire = screen.getByRole('menuitem', { name: 'Retire device' });
    const reason = document.getElementById(retire.getAttribute('aria-describedby')!);
    expect(reason?.classList.contains('sr-only')).toBe(true);
    fireEvent.click(retire);
    expect(reason?.classList.contains('sr-only')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('shows a disabled reason on hover and hides it when the pointer leaves', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    open();
    const retire = screen.getByRole('menuitem', { name: 'Retire device' });
    const edit = screen.getByRole('menuitem', { name: 'Edit device' });
    const reason = document.getElementById(retire.getAttribute('aria-describedby')!);
    expect(reason?.classList.contains('sr-only')).toBe(true);
    fireEvent.mouseOver(retire);
    expect(reason?.classList.contains('sr-only')).toBe(false);
    fireEvent.mouseOut(retire, { relatedTarget: edit });
    expect(reason?.classList.contains('sr-only')).toBe(true);
  });

  it('closes on Tab and on a pointer press outside, without taking focus back', () => {
    render(
      <>
        <Menu label="Actions for TL-0042" items={items()} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const button = open();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    // Focus is back on the button before the browser's Tab moves on, so Tab continues after it.
    expect(document.activeElement).toBe(button);
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('focuses the first item on every open, the first included, and closes on Escape from the button', () => {
    render(<Menu label="Actions for TL-0042" items={items()} />);
    const button = open();
    expect(document.activeElement?.textContent).toBe('Edit device');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    open();
    expect(document.activeElement?.textContent).toBe('Edit device');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    // A menu open while focus is still on its button closes on Escape there too.
    fireEvent.click(button);
    button.focus();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('shows a header above the items that is no item and takes no focus', () => {
    render(
      <Menu label="Actions for TL-0042" items={items()} header={<p>Signed in as Tran Thi B</p>} />,
    );
    open();
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Signed in as Tran Thi B');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    expect(menu.firstElementChild?.getAttribute('role')).toBe('presentation');
  });

  it('starts the accessible name with the visible trigger text (WCAG 2.5.3)', () => {
    render(
      <Menu
        label="Change status of TL-0042"
        trigger={<span>Change status</span>}
        items={items()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Change status of TL-0042' });
    expect(button.textContent).toBe('Change status');
  });
});

// The list stays inside the viewport (re-check of treklink-web#350): a window 800 px high, a list
// whose items need 600 px.
describe('Menu placement in the viewport', () => {
  it('repositions when focusing a disabled item makes its reason widen the menu', () => {
    vi.stubGlobal('innerWidth', 800);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('role') !== 'menu') return 0;
      return this.querySelector('[id*="-reason-"]:not(.sr-only)') ? 320 : 160;
    });
    render(<Menu label="Actions for TL-0042" items={items()} />);
    const button = screen.getByRole('button', { name: 'Actions for TL-0042' });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 720,
      right: 780,
      width: 60,
      height: 40,
      x: 720,
      y: 100,
      toJSON: () => ({}),
    });
    open();
    expect(screen.getByRole('menu').style.left).toBe('620px');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Retire device' }));
    expect(screen.getByRole('menu').style.left).toBe('460px');
  });
  const place = (buttonTop: number, side: 'auto' | 'below' = 'auto', viewportHeight = 800) => {
    vi.stubGlobal('innerHeight', viewportHeight);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menu' ? 600 : 0;
    });
    render(<Menu label="Actions for TL-0042" items={items()} side={side} />);
    const button = screen.getByRole('button', { name: 'Actions for TL-0042' });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: buttonTop,
      bottom: buttonTop + 40,
      left: 100,
      right: 200,
      width: 100,
      height: 40,
    } as DOMRect);
    fireEvent.click(button);
    return screen.getByRole('menu').style;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens below and scrolls inside the room left when the list is longer', () => {
    // Below the button: 800 - 8 - (240 + 4) = 548 px, more than the 196 px above.
    const style = place(200);
    expect(style.top).toBe('244px');
    expect(style.maxHeight).toBe('548px');
  });

  it('keeps a header menu below its trigger at 400 percent reflow so the SOS banner cannot hide it', () => {
    const style = place(120, 'below', 236);
    expect(style.top).toBe('164px');
    expect(style.maxHeight).toBe('64px');
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  it('opens above a button low on the screen, held to the room there', () => {
    // Below: 800 - 8 - 744 = 48 px. Above: 700 - 4 - 8 = 688 px, enough for the whole list.
    const style = place(700);
    expect(style.maxHeight).toBe('688px');
    expect(style.top).toBe(`${700 - 4 - 600}px`);
  });

  it('never reaches past the bottom of the window', () => {
    const style = place(400);
    // Below: 800 - 8 - 444 = 348 px; above: 388 px, so it opens above and scrolls.
    expect(Number.parseFloat(style.top) + Number.parseFloat(style.maxHeight)).toBeLessThanOrEqual(
      800 - 8,
    );
    expect(Number.parseFloat(style.top)).toBeGreaterThanOrEqual(8);
  });
});
