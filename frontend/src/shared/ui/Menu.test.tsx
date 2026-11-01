// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from './Menu';

afterEach(cleanup);

const items = (onSelect = vi.fn()): MenuItem[] => [
  { key: 'edit', label: 'Edit device', onSelect: () => onSelect('edit') },
  { key: 'retire', label: 'Retire device', onSelect: () => onSelect('retire'), disabled: true, disabledReason: 'Only an available device can be retired.' },
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
    const retire = screen.getByRole('menuitem', { name: 'Retire device' });
    expect(retire.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(retire.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('Only an available device can be retired.');
    expect(retire.contains(reason)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(retire);
    fireEvent.keyDown(retire, { key: 'Enter' });
    fireEvent.click(retire);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Tab and on a pointer press outside, without taking focus back', () => {
    render(
      <>
        <Menu label="Actions for TL-0042" items={items()} />
        <button type="button">Elsewhere</button>
      </>,
    );
    open();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('starts the accessible name with the visible trigger text (WCAG 2.5.3)', () => {
    render(<Menu label="Change status of TL-0042" trigger={<span>Change status</span>} items={items()} />);
    const button = screen.getByRole('button', { name: 'Change status of TL-0042' });
    expect(button.textContent).toBe('Change status');
  });
});
