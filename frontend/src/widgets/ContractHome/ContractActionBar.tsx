import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Button } from '../../shared/ui/Button';
import { cn } from '../../shared/ui/cn';
import { Menu } from '../../shared/ui/Menu';
import { PageActionBar } from '../../shared/ui/PageChrome';
import { useEdgeNode, useFocusClearOf, usePublishedHeight } from '../../shared/ui/stickyEdges';
import { LINK } from '../../shared/ui/styles';
import { Tabs, type TabItem } from '../../shared/ui/Tabs';
import type { ActionKey, HomeAction, HomeActions } from './policy';

// The tab list wraps onto more rows instead of scrolling sideways, so every section stays in view and
// no fading edge covers a label (W20B item 6). Each tab keeps its own words on one line.
const TABS_WRAP = 'flex-wrap gap-y-1 overflow-x-visible border-b-0';

export type HomeTab = 'overview' | 'devices' | 'money' | 'history' | 'documents';

interface Props {
  tabs: TabItem<HomeTab>[];
  tab: HomeTab;
  onTab: (tab: HomeTab) => void;
  /** In Review or Handover mode the tabs give way to the mode title and Back to overview. */
  modeTitle?: string;
  overviewHref: string;
  actions: HomeActions;
  onAction: (key: ActionKey) => void;
  /** The form the primary action submits, for Approve request in Review mode. */
  primaryForm?: string;
  primaryPending?: boolean;
}

/**
 * The record's sticky row (chapter 06 §10.4): the tabs, or the mode title, share one row with the
 * contract's actions: one primary action, More actions with the rest (a reason as text on an
 * unavailable one, destructive ones last after a separator). The row sticks to the top and
 * publishes its height, so a CollectionView command bar sticks under it and focus is never hidden
 * behind it (2.4.11). Below 600 px the tabs stay at the top and the actions move to a bar pinned to
 * the bottom, primary widest, a disabled action's reason on its own line above (§10.5).
 */
export const ContractActionBar: React.FC<Props> = ({
  tabs,
  tab,
  onTab,
  modeTitle,
  overviewHref,
  actions,
  onAction,
  primaryForm,
  primaryPending,
}) => {
  const phone = !useMediaQuery('(min-width: 600px)', true);
  // The sticky row is a different element below and above 600 px: the hooks follow it.
  const [rowNode, setRowNode] = useEdgeNode<HTMLDivElement>();
  const reasonId = useId();
  usePublishedHeight(rowNode, '--tl-page-header-h');
  useFocusClearOf(rowNode, 'top');

  const primary = actions.primary;
  const unavailable = primary?.reason !== undefined;
  const firstDestructive = actions.more.findIndex((action) => action.destructive);

  const more = actions.more.length > 0 && (
    <Menu
      label="More actions"
      align="end"
      triggerClassName="h-11 shrink-0 whitespace-nowrap border border-line-strong bg-surface px-4 text-body"
      items={actions.more.map((action: HomeAction, index) => ({
        key: action.key,
        label: action.label,
        destructive: action.destructive,
        disabled: action.reason !== undefined,
        disabledReason: action.reason,
        separatorBefore: index === firstDestructive,
        onSelect: () => onAction(action.key),
      }))}
    />
  );

  const primaryButton = primary && (
    <Button
      variant="primary"
      type={primaryForm && !unavailable ? 'submit' : 'button'}
      form={primaryForm && !unavailable ? primaryForm : undefined}
      aria-disabled={unavailable || undefined}
      aria-describedby={unavailable ? reasonId : undefined}
      loading={primaryPending}
      onClick={(event) => {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        if (!primaryForm) onAction(primary.key);
      }}
      className={cn(unavailable && 'cursor-not-allowed opacity-55', phone && 'flex-1')}
    >
      {primary.label}
    </Button>
  );

  const reason = unavailable && (
    <p
      id={reasonId}
      className={cn('flex items-center gap-1.5 text-body-sm text-ink-muted', phone && 'w-full')}
    >
      <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {primary?.reason}
    </p>
  );

  const idle = !primary && actions.idle && (
    <p className="text-body-sm text-ink-muted">{actions.idle}</p>
  );

  const left = modeTitle ? (
    <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2">
      <h2 className="text-title-sm text-ink">{modeTitle}</h2>
      <Link to={overviewHref} className={cn(LINK, 'inline-flex min-h-6 items-center text-body-sm')}>
        Back to overview
      </Link>
    </div>
  ) : (
    <Tabs<HomeTab>
      label="Contract sections"
      idPrefix="contract"
      items={tabs}
      value={tab}
      onChange={onTab}
      // The five sections wrap onto a second row rather than scroll: at 360 px History hid behind a
      // scroll arrow, and the fading edge cut the words at either end (W20B item 6).
      className={TABS_WRAP}
    />
  );

  if (phone) {
    // A mode with its own bottom bar (Handover keeps the counter's Back and Next) keeps More actions
    // in the top row, so the page never has two bars pinned to the bottom.
    const inTopRow = Boolean(modeTitle) && !primary;
    return (
      <>
        <div
          key="phone-row"
          ref={setRowNode}
          role="region"
          // Its own name, apart from the tablist's (review of treklink-web#349).
          aria-label="Contract navigation"
          className="sticky top-0 z-raised flex flex-wrap items-center justify-between gap-1 rounded-panel border border-line bg-surface px-1 shadow-raise"
        >
          {left}
          {inTopRow && more}
        </div>
        {!inTopRow && (primary || more || idle) && (
          <PageActionBar label="Contract actions" className="order-last" stretch>
            {reason}
            {idle}
            {more}
            {primaryButton}
          </PageActionBar>
        )}
      </>
    );
  }

  return (
    <div
      key="wide-row"
      ref={setRowNode}
      role="region"
      aria-label="Contract sections and actions"
      className="sticky top-0 z-raised flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-panel border border-line bg-surface pl-1 pr-2 shadow-raise"
    >
      <div className="min-w-0 flex-[1_1_auto]">{left}</div>
      <div className="flex flex-wrap items-center justify-end gap-2 py-1">
        {reason}
        {idle}
        {more}
        {primaryButton}
      </div>
    </div>
  );
};
