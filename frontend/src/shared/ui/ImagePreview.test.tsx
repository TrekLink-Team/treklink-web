// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_PREVIEW_DELAY_MS, ImagePreview } from './ImagePreview';

// The image focus view of devices design section 12.14 (REQ-EVT-51, AC-50): opened after a 500 ms rest, a click,
// a tap or Enter and Space; centred over a dimmed backdrop at no more than 90 % of the viewport; a modal dialog that
// traps focus and returns it to the image; closed by Escape, a click or tap outside, or Close.

const renderPreview = (hoverOnly = false) =>
  render(
    <>
      <button type="button">Before</button>
      <ImagePreview src="/variants/v3-detail.webp" alt="TrekLink v3 unit" caption="TrekLink v3" hoverOnly={hoverOnly}>
        <span>Thumbnail</span>
      </ImagePreview>
    </>,
  );

const view = () => screen.queryByRole('dialog', { name: 'TrekLink v3' });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ImagePreview, the image focus view', () => {
  it('waits 500 ms before opening on a pointer rest', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS - 1));
    expect(view()).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(view()).toBeTruthy();
  });

  it('cancels the delayed view when the pointer leaves early', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS - 1));
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));

    expect(view()).toBeNull();
  });

  it('opens centred, at most 90 % of the viewport, over a dimmed backdrop, with the caption', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Preview TrekLink v3 image' }));

    const dialog = view() as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('inset-0');
    expect(dialog.className).toContain('bg-scrim');
    const image = screen.getByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe('/variants/v3-detail.webp');
    expect(image.className).toContain('max-w-[90vw]');
    expect(image.className).toContain('max-h-[calc(90dvh-3rem)]');
    expect(screen.getByText('TrekLink v3').tagName).toBe('FIGCAPTION');
  });

  it('moves focus inside, keeps it there, and returns it to the image on Escape', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const close = screen.getByRole('button', { name: 'Close the TrekLink v3 image' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens on Space and closes with Close', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    fireEvent.keyDown(trigger, { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Close the TrekLink v3 image' }));
    expect(view()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens on a tap and closes on the next tap, on the image or outside it', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('img', { name: 'TrekLink v3 unit' }));
    expect(view()).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(view() as HTMLElement);
    expect(view()).toBeNull();
  });

  it('is no control of its own in hover-only mode and opens after the rest', () => {
    vi.useFakeTimers();
    renderPreview(true);
    expect(screen.queryByRole('button', { name: 'Preview TrekLink v3 image' })).toBeNull();
    fireEvent.pointerEnter(screen.getByText('Thumbnail').parentElement as HTMLElement, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));
    expect(view()).toBeTruthy();
  });

  it('returns focus to the element that had it when a hover-only view closes, never to the body', () => {
    vi.useFakeTimers();
    renderPreview(true);
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    fireEvent.pointerEnter(screen.getByText('Thumbnail').parentElement as HTMLElement, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close the TrekLink v3 image' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view()).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
