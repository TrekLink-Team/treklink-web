import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import type { NavGroup } from '../../shared/config/navigation';
import { cn } from '../../shared/ui/cn';
import { useFocusTrap } from '../../shared/ui/useFocusTrap';
import { useShell } from './shellStore';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/**
 * "Go to" in the header: jumps to any page the user may open (Ctrl K or /). It searches page names
 * only; a search over records needs a search endpoint and joins with that task. Matching ignores
 * Vietnamese diacritics, so "hop dong" finds "Hợp đồng".
 */
export const QuickNav: React.FC<{ groups: NavGroup[] }> = ({ groups }) => {
  const open = useShell((state) => state.quickNavOpen);
  const setOpen = useShell((state) => state.setQuickNav);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return open ? <QuickNavDialog groups={groups} onClose={() => setOpen(false)} /> : null;
};

const QuickNavDialog: React.FC<{ groups: NavGroup[]; onClose: () => void }> = ({ groups, onClose }) => {
  const navigate = useNavigate();
  const { box, onKeyDown } = useFocusTrap(onClose);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    return groups
      .flatMap((group) => group.entries.map((entry) => ({ ...entry, group: group.label })))
      .filter((entry) => !q || normalize(`${entry.label} ${entry.group}`).includes(q));
  }, [groups, query]);

  const go = (route: string) => {
    onClose();
    navigate(route);
  };

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active].route);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--tl-banner-h,0px)] z-dialog flex items-start justify-center bg-scrim/[var(--tl-scrim-alpha)] px-3 pt-[12vh]">
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Go to page"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-lg overflow-hidden rounded-sheet border border-line bg-surface text-ink shadow-overlay"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden="true" className="h-5 w-5 text-ink-muted" />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls="quicknav-list"
            aria-activedescendant={results[active] ? `quicknav-${active}` : undefined}
            aria-label="Go to page"
            placeholder="Go to page, for example Contracts"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            className="h-14 flex-1 border-0 bg-transparent text-body-lg outline-none focus-visible:outline-none"
          />
          <kbd className="rounded-badge border border-line px-1.5 font-mono text-caption text-ink-muted">Esc</kbd>
        </div>
        <ul id="quicknav-list" role="listbox" aria-label="Pages" className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-body text-ink-muted">No page matches.</li>}
          {results.map((entry, index) => {
            const Icon = entry.icon;
            return (
              <li
                key={entry.route}
                id={`quicknav-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(entry.route)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3',
                  index === active && 'bg-chrome',
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 text-brand" />
                <span className="flex-1 font-semibold">{entry.label}</span>
                <span className="text-body-sm text-ink-muted">{entry.group}</span>
                {index === active && <CornerDownLeft aria-hidden="true" className="h-4 w-4 text-ink-muted" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
