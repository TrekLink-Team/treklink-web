// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageScrollBody } from './PageChrome';
import { useScrollStop } from './scrollStop';

afterEach(cleanup);

const Region: React.FC<{ focusable: boolean; named?: boolean }> = ({ focusable, named }) => {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useScrollStop(node, 'Devices');
  return (
    <div ref={setNode} data-testid="region" aria-label={named ? 'Own name' : undefined}>
      {focusable ? <button type="button">Open</button> : <p>Text only</p>}
    </div>
  );
};

describe('useScrollStop (ui standard §7)', () => {
  it('gives a region with nothing focusable a tab stop and a name', () => {
    render(<Region focusable={false} />);
    const region = screen.getByTestId('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Devices');
  });

  it('leaves a region with a focusable child alone', () => {
    render(<Region focusable />);
    const region = screen.getByTestId('region');
    expect(region.hasAttribute('tabindex')).toBe(false);
    expect(region.hasAttribute('aria-label')).toBe(false);
  });

  it('takes the stop back once the region gains a focusable child, keeping the owner name', () => {
    const { rerender } = render(<Region focusable={false} named />);
    const region = screen.getByTestId('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Own name');
    rerender(<Region focusable named />);
    expect(region.hasAttribute('tabindex')).toBe(false);
    expect(region.getAttribute('aria-label')).toBe('Own name');
  });
});

describe('PageScrollBody', () => {
  it('is a named region and takes a tab stop only when its content has no control', () => {
    const { rerender } = render(
      <PageScrollBody label="Contract details">
        <p>Read only</p>
      </PageScrollBody>,
    );
    const body = screen.getByRole('region', { name: 'Contract details' });
    expect(body.getAttribute('tabindex')).toBe('0');
    rerender(
      <PageScrollBody label="Contract details">
        <button type="button">Edit</button>
      </PageScrollBody>,
    );
    expect(body.hasAttribute('tabindex')).toBe(false);
  });
});
