import React, { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Button } from './Button';
import { buttonClasses } from './buttonStyles';
import { cn } from './cn';
import { Menu } from './Menu';
import { PageActionBar } from './PageChrome';

/** One action of a record page (a device, an incident). */
export interface RecordAction {
  key: string;
  label: string;
  /** `primary` is the record's next step; `danger` is destructive and confirms in a dialog. */
  tone?: 'primary' | 'secondary' | 'danger';
  onSelect?: () => void;
  /** A page to open in place of `onSelect`: a link on wide screens, a menu item on a phone. */
  to?: string;
  state?: unknown;
  /** Why the action is unavailable now, shown as text beside it (§9.5). */
  reason?: string;
  loading?: boolean;
}

const variantOf = (action: RecordAction) =>
  action.tone === 'danger' ? 'danger' : action.tone === 'primary' ? 'primary' : 'secondary';

/**
 * The actions of a record page. On a wide screen they stay a row of buttons where the page puts
 * them, an unavailable one disabled with its reason as text below. Below 600 px they move into a
 * bar pinned to the bottom (chapter 06 §10.5): the primary action widest, More actions beside it
 * with the rest (destructive ones last after a separator, an unavailable one with its reason), and
 * the primary action's reason on its own line above. The bar publishes its height, so the page's
 * scroll padding keeps a focused control clear of it (2.4.11).
 */
export const RecordActionBar: React.FC<{
  /** Names the group: "Device actions". */
  label: string;
  actions: RecordAction[];
  className?: string;
}> = ({ label, actions, className }) => {
  const phone = !useMediaQuery('(min-width: 600px)', true);
  const navigate = useNavigate();
  const baseId = useId();
  const reasonId = (action: RecordAction) => `${baseId}-${action.key}-reason`;
  const run = (action: RecordAction) => {
    if (action.to) navigate(action.to, { state: action.state });
    else action.onSelect?.();
  };
  if (actions.length === 0) return null;

  const button = (action: RecordAction, wide: boolean, extra?: string) =>
    action.to && !action.reason ? (
      <Link
        key={action.key}
        to={action.to}
        state={action.state}
        className={cn(buttonClasses(variantOf(action)), extra)}
      >
        {action.label}
      </Link>
    ) : (
      <Button
        key={action.key}
        variant={variantOf(action)}
        loading={action.loading}
        // Wide: disabled with its reason. Phone: kept focusable, so the reason above is read with it.
        disabled={wide && action.reason !== undefined}
        aria-disabled={!wide && action.reason !== undefined ? true : undefined}
        aria-describedby={action.reason !== undefined ? reasonId(action) : undefined}
        onClick={() => {
          if (action.reason === undefined) run(action);
        }}
        className={cn(!wide && action.reason !== undefined && 'cursor-not-allowed opacity-55', extra)}
      >
        {action.label}
      </Button>
    );

  if (!phone) {
    return (
      <div role="group" aria-label={label} className={cn('flex flex-wrap gap-3', className)}>
        {actions.map((action) => (
          <React.Fragment key={action.key}>
            {button(action, true)}
            {action.reason !== undefined && (
              <p id={reasonId(action)} className="w-full text-body-sm text-ink-muted">
                {action.reason}
              </p>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // The leading button: the primary action, else the first one that is not destructive.
  const primary =
    actions.find((action) => action.tone === 'primary') ??
    actions.find((action) => action.tone !== 'danger');
  const rest = actions.filter((action) => action !== primary);
  const ordered = [
    ...rest.filter((action) => action.tone !== 'danger'),
    ...rest.filter((action) => action.tone === 'danger'),
  ];
  const firstDanger = ordered.findIndex((action) => action.tone === 'danger');

  return (
    <PageActionBar label={label} className={cn('order-last', className)} stretch>
      {primary?.reason !== undefined && (
        <p
          id={reasonId(primary)}
          className="flex w-full items-center gap-1.5 text-body-sm text-ink-muted"
        >
          <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {primary.reason}
        </p>
      )}
      <div className="flex w-full items-center gap-2">
        {ordered.length > 0 && (
          <Menu
            label="More actions"
            align="end"
            triggerClassName="h-11 shrink-0 whitespace-nowrap border border-line-strong bg-surface px-4 text-body"
            items={ordered.map((action, index) => ({
              key: action.key,
              label: action.label,
              destructive: action.tone === 'danger',
              disabled: action.reason !== undefined,
              disabledReason: action.reason,
              separatorBefore: index === firstDanger && index > 0,
              onSelect: () => run(action),
            }))}
          />
        )}
        {/* Shrinks and wraps a long label on a narrow phone instead of pushing the bar sideways
            (ui standard §7, reflow at 320 px). */}
        {primary &&
          button(primary, false, 'h-auto min-h-11 min-w-0 flex-1 shrink whitespace-normal py-2 text-center')}
      </div>
    </PageActionBar>
  );
};
