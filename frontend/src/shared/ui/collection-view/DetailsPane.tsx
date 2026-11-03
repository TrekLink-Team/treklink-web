import React, { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '../Button';
import { cn } from '../cn';
import { Drawer } from '../Drawer';
import { Menu } from '../Menu';
import { LINK } from '../styles';
import type { CollectionAction, CollectionDetails, CollectionField, CollectionTransition } from './types';

export type PanePlacement = 'aside' | 'drawer' | 'sheet';

interface Props<T> {
  item: T;
  itemName: string;
  placement: PanePlacement;
  fields: CollectionField<T>[];
  details?: CollectionDetails<T>;
  actions: CollectionAction<T>[];
  transitions: CollectionTransition<T>[];
  statusText?: string;
  onClose: () => void;
}

/**
 * The details pane of chapter 06 §9.8 and §10.8: the item's fields, its image slot, every item
 * action as a labelled button with any unavailable reason as text, the Change status dropdown and a
 * link to the full page. From 1100 px it is a non-modal `aside` beside the list: focus moves to its
 * heading, Escape or the close button closes it. Narrower, it is the design system's Drawer from the
 * right (600 px and up) or a bottom sheet, which trap focus and return it on close.
 */
export function DetailsPane<T>({
  item,
  itemName,
  placement,
  fields,
  details,
  actions,
  transitions,
  statusText,
  onClose,
}: Props<T>) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = details?.fields
    ? fields.filter((field) => details.fields?.includes(field.key))
    : fields;
  const href = details?.href?.(item);

  useEffect(() => {
    if (placement === 'aside') heading.current?.focus();
  }, [placement, itemName]);

  const body = (
    <div className="flex flex-col gap-4">
      {details?.image && <div>{details.image(item)}</div>}
      <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-body-sm">
        {shown.map((field) => (
          <React.Fragment key={field.key}>
            <dt className="text-ink-muted">{field.label}</dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{field.render(item)}</dd>
          </React.Fragment>
        ))}
      </dl>
      {details?.extra?.(item)}
      {(actions.length > 0 || transitions.length > 0) && (
        <div className="flex flex-col gap-2">
          {transitions.length > 0 && (
            <StatusMenu
              itemName={itemName}
              statusText={statusText}
              transitions={transitions}
              item={item}
              align="start"
            />
          )}
          {actions.map((action) => {
            const reason = action.unavailableReason?.(item);
            return (
              <div key={action.key} className="flex flex-col gap-0.5">
                <Button
                  size="md"
                  variant={action.destructive ? 'danger' : 'secondary'}
                  icon={<span className="flex [&>svg]:h-4 [&>svg]:w-4">{action.icon}</span>}
                  aria-label={action.accessibleName?.(item) ?? `${action.label} ${itemName}`}
                  disabled={reason !== undefined}
                  onClick={() => action.onSelect(item)}
                  className="justify-start"
                >
                  {action.label}
                </Button>
                {reason && <p className="text-body-sm text-ink-muted">{reason}</p>}
              </div>
            );
          })}
        </div>
      )}
      {href && (
        <Link to={href} className={cn(LINK, 'inline-flex min-h-6 items-center text-body-sm')}>
          {details?.hrefLabel ?? `Open ${itemName}`}
        </Link>
      )}
    </div>
  );

  if (placement !== 'aside') {
    return (
      <Drawer
        titleId={headingId}
        title={itemName}
        side={placement === 'sheet' ? 'bottom' : 'right'}
        onClose={onClose}
      >
        {body}
      </Drawer>
    );
  }

  return (
    <aside
      aria-labelledby={headingId}
      data-details-pane=""
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="sticky top-[calc(var(--tl-page-header-h,0px)+var(--tl-collection-bar-h,0px)+0.5rem)] flex max-h-[calc(100dvh-10rem)] w-80 shrink-0 flex-col self-start overflow-y-auto rounded-panel border border-line bg-surface p-4 shadow-raise"
    >
      <div className="mb-3 flex items-start gap-2">
        <h2
          ref={heading}
          id={headingId}
          tabIndex={-1}
          className="min-w-0 flex-1 text-title-sm text-ink outline-none [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          {itemName}
        </h2>
        <button
          type="button"
          aria-label={`Close details of ${itemName}`}
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      {body}
    </aside>
  );
}

/**
 * The Change status dropdown of §9.6: visible text with the current status, only the allowed
 * transitions, destructive ones last after a separator. Menu draws the chevron.
 */
export function StatusMenu<T>({
  item,
  items,
  itemName,
  statusText,
  transitions,
  align = 'end',
  label,
}: {
  item?: T;
  items?: T[];
  itemName: string;
  statusText?: string;
  transitions: CollectionTransition<T>[];
  align?: 'start' | 'end';
  /** Overrides the visible text, for the bulk menu ("Change status"). */
  label?: string;
}) {
  if (transitions.length === 0) return null;
  const targets = items ?? (item !== undefined ? [item] : []);
  const visible = label ?? (statusText ? `Status: ${statusText}` : 'Change status');
  const ordered = [
    ...transitions.filter((transition) => !transition.destructive),
    ...transitions.filter((transition) => transition.destructive),
  ];
  const firstDestructive = ordered.findIndex((transition) => transition.destructive);
  return (
    <Menu
      label={`${visible}. Change status of ${itemName}`}
      align={align}
      trigger={<span>{visible}</span>}
      triggerClassName="h-10 border border-line-strong bg-surface px-3 text-body-sm"
      items={ordered.map((transition, index) => ({
        key: transition.key,
        label: transition.label,
        destructive: transition.destructive,
        separatorBefore: index === firstDestructive,
        onSelect: () => transition.onSelect(targets),
      }))}
    />
  );
}
