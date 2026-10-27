import React from 'react';
import { Info, X } from 'lucide-react';
import { Drawer } from '../../shared/ui/Drawer';
import { useShell } from './shellStore';
import { DOCKED_QUERY } from './useInfoPane';
import { useMediaQuery } from './useMediaQuery';

/**
 * The right panel: properties of whatever is selected in the body, like a file manager's details
 * pane (DS-13). Docked from 1280 px; below that the same content opens as a sheet over the body.
 * It renders nothing until a page provides content with useInfoPane, and never on map pages.
 */
export const InfoPane: React.FC<{ docked: boolean }> = ({ docked }) => {
  const info = useShell((state) => state.info);
  const open = useShell((state) => state.infoOpen);
  const sheetOpen = useShell((state) => state.infoSheetOpen);
  const setOpen = useShell((state) => state.setInfoOpen);
  const setSheet = useShell((state) => state.setInfoSheet);
  if (!info) return null;

  if (!docked) {
    if (!sheetOpen) return null;
    return (
      <Drawer titleId="info-pane-title" title={info.title} onClose={() => setSheet(false)} side="right" footer={info.footer}>
        {info.body}
      </Drawer>
    );
  }

  if (!open) return null;
  return (
    <aside aria-labelledby="info-pane-title" className="tl-glass flex w-info shrink-0 flex-col overflow-hidden rounded-panel">
      <div className="flex min-h-[3.25rem] items-center gap-2 border-b border-line pl-4 pr-1.5">
        <span aria-hidden="true" className="text-brand [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {info.icon ?? <Info />}
        </span>
        <h2 id="info-pane-title" className="min-w-0 flex-1 truncate font-display text-body-lg font-extrabold text-ink">
          {info.title}
        </h2>
        <button
          type="button"
          aria-label="Close details"
          onClick={() => setOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-control text-ink hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{info.body}</div>
      {info.footer && <div className="border-t border-line px-4 py-3">{info.footer}</div>}
    </aside>
  );
};

/** The toolbar's Info toggle. Hidden when the page shows no Info pane. */
export const InfoPaneToggle: React.FC = () => {
  const info = useShell((state) => state.info);
  const docked = useMediaQuery(DOCKED_QUERY);
  const open = useShell((state) => (docked ? state.infoOpen : state.infoSheetOpen));
  const setDocked = useShell((state) => state.setInfoOpen);
  const setSheet = useShell((state) => state.setInfoSheet);
  const setOpen = docked ? setDocked : setSheet;
  if (!info) return null;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={open ? 'Hide details panel' : 'Show details panel'}
      title={open ? 'Hide details panel' : 'Show details panel'}
      onClick={() => setOpen(!open)}
      className={
        'flex h-9 w-9 items-center justify-center rounded-control transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ' +
        (open ? 'bg-chrome text-brand' : 'text-ink hover:bg-chrome/60')
      }
    >
      <Info aria-hidden="true" className="h-[18px] w-[18px]" />
    </button>
  );
};
