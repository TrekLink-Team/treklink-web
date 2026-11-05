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
    expect(screen.queryByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  it('cancels the delayed preview when the pointer leaves early', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS - 1));
    fireEvent.pointerLeave(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));

    expect(screen.queryByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('opens immediately on click and closes on Escape', () => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('stays open while the pointer moves onto the preview and closes after leaving it', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(IMAGE_PREVIEW_DELAY_MS));
    const preview = screen.getByRole('dialog', { name: 'TrekLink v3 image preview' });
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(preview);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeTruthy();

    fireEvent.pointerLeave(preview);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeNull();
  });

  it('keeps a click-opened preview visible after a touch pointer leaves', () => {
    vi.useFakeTimers();
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });

    fireEvent.click(trigger);
    fireEvent.pointerLeave(trigger, { pointerType: 'touch' });
    act(() => vi.runOnlyPendingTimers());

    expect(screen.getByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });

  it.each(['Enter', ' '])('opens from the %s key while the trigger has focus', (key) => {
    renderPreview();
    const trigger = screen.getByRole('button', { name: 'Preview TrekLink v3 image' });
    trigger.focus();

    fireEvent.keyDown(trigger, { key });

    expect(screen.getByRole('dialog', { name: 'TrekLink v3 image preview' })).toBeTruthy();
  });
});
