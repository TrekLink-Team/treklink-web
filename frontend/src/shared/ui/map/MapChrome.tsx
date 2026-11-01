import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../cn';
import { MARKER_LABEL, type MarkerState } from '../status';

// Chrome that floats over the live map: legend and panels. Glass is allowed here because the map
// is textured underneath (DS-07); text contrast is checked on the strongest glass recipe.

const SWATCH: Record<MarkerState, string> = {
  fresh: 'tl-marker tl-marker--fresh',
  attention: 'tl-marker tl-marker--attention',
  stale: 'tl-marker tl-marker--stale',
  unheard: 'tl-marker tl-marker--unheard',
  sos: 'tl-marker tl-marker--sos !h-3.5 !w-3.5 ![animation:none]',
};

/** The marker legend. Each entry shows the marker shape and its text. */
export const MapLegend: React.FC<{ states?: MarkerState[]; extra?: React.ReactNode; className?: string }> = ({
  states = ['fresh', 'stale', 'sos'],
  extra,
  className,
}) => (
  <section aria-label="Map legend" className={cn('tl-glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card px-3 py-2 text-body-sm font-semibold text-ink', className)}>
    {states.map((state) => (
      <span key={state} className="flex items-center gap-2">
        <span aria-hidden="true" className={SWATCH[state]} />
        {MARKER_LABEL[state]}
      </span>
    ))}
    {extra}
  </section>
);

/** A collapsible glass panel inside the map, such as the incident queue. */
export const MapPanel: React.FC<{
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}> = ({ title, count, children, defaultOpen = true, className }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `map-panel-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-label={title} className={cn('tl-glass-strong overflow-hidden rounded-panel shadow-overlay', className)}>
      <div className="flex h-12 items-center gap-2 border-b border-line pl-4 pr-1">
        <h2 className="font-display text-body-lg font-extrabold text-ink">{title}</h2>
        {count}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          onClick={() => setOpen((value) => !value)}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-control text-ink hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {open ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
};

/**
 * The full-bleed layout of a map page (convention 06 §4 Pattern B): the map fills the content area
 * and the incident queue sits beside it from the lg breakpoint, or below it on smaller screens,
 * never under the fold of a long page. Put LiveMapWidget in `map`.
 */
export const MapWorkspace: React.FC<{ map: React.ReactNode; queue?: React.ReactNode; className?: string }> = ({
  map,
  queue,
  className,
}) => (
  <div className={cn('flex min-h-0 flex-1 flex-col gap-3 lg:flex-row', className)}>
    <div className="relative min-h-[60vh] flex-1 overflow-hidden rounded-panel border border-line lg:min-h-0">{map}</div>
    {queue && <aside aria-label="Incident queue" className="flex max-h-[50vh] flex-col lg:max-h-none lg:w-[22rem]">{queue}</aside>}
  </div>
);
