// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_PREVIEW_DELAY_MS, ImagePreview } from './ImagePreview';

const renderPreview = () =>
  render(
    <ImagePreview src="/variants/v3-detail.webp" alt="TrekLink v3 unit" caption="TrekLink v3">
      <span>Thumbnail</span>
    </ImagePreview>,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ImagePreview', () => {
  it('waits 500 ms before opening on pointer rest', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS - 1));
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  it('cancels the delayed preview when the pointer leaves early', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS - 1));
    fireEvent.pointerLeave(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));

    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('opens immediately on click and closes on Escape', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.click(trigger);
    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('stays open while the pointer moves onto the preview and closes after leaving it', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));
    const preview = screen.getByRole('figure', { name: 'TrekLink v3 image preview' });
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(preview);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();

    fireEvent.pointerLeave(preview);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('keeps a click-opened preview visible after a touch pointer leaves', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.click(trigger);
    fireEvent.pointerLeave(trigger, { pointerType: 'touch' });
    act(() => vi.runOnlyPendingTimers());

    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  it.each(['Enter', ' '])('opens from the %s key while the trigger has focus', (key) => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    trigger.focus();

    fireEvent.keyDown(trigger, { key });

    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  // Review of treklink-web#405: a phone has no Escape key, so a tapped preview must close by touch.
  it('closes a tapped preview on a tap outside it, and stays open on a tap inside it', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);
    const preview = screen.getByRole('figure', { name: 'TrekLink v3 image preview' });
    fireEvent.pointerDown(preview, { pointerType: 'touch' });
    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('closes on a second click or Enter on the trigger', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('figure', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('keeps a preview opened by a mouse rest when the mouse then clicks the trigger', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));
    fireEvent.click(trigger);
    expect(screen.getByRole('figure', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  it('is a named figure with focus left on the trigger, not a dialog', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    expect(trigger.getAttribute('aria-controls')).toBe(
      screen.getByRole('figure', { name: 'TrekLink v3 image preview' }).id,
    );
    expect(document.activeElement).toBe(trigger);
  });
});
