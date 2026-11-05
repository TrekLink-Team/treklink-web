import React from 'react';
import { Check, ChevronDown, CornerDownRight } from 'lucide-react';
import type { ContractDetail, ContractTransition } from '../../entities/contract/api';
import { planLabel } from '../../entities/contract/api';
import { lifecycleOf, type LifecycleStep } from '../../entities/contract/lifecycle';
import { formatDate, formatDateTime, viewerTimeZone } from '../../shared/lib/format';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Badge, StatusBadge } from '../../shared/ui/Badge';
import { cn } from '../../shared/ui/cn';
import { CONTRACT_STATUS } from '../../shared/ui/status';
import { deadlineOf, nextStepOf, type Viewer } from './policy';

const shortDate = (iso: string | null) => (iso ? formatDate(iso).replace(/ \d{4}$/, '') : '');

/**
 * The compact header of a contract home (chapter 06 §10.4): title, status, the organization, plan
 * and units in one line, and the deadline that matters now. About 60 px on a laptop. The breadcrumb
 * is the shell's.
 */
export const ContractHeader: React.FC<{
  contract: ContractDetail;
  scope: 'o' | 't';
  variantName: string;
}> = ({ contract, scope, variantName }) => {
  const deadline = deadlineOf(contract);
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
      <div className="flex min-w-0 flex-[1_1_28rem] flex-wrap items-center gap-x-3 gap-y-1">
        <h1 id="contract-title" className="font-display text-title text-ink">
          {contract.code}
        </h1>
        <StatusBadge entry={CONTRACT_STATUS[contract.status]} />
        <p className="min-w-0 text-body-sm text-ink [overflow-wrap:anywhere]">
          {scope === 't' && contract.organization && (
            <span className="font-semibold">{contract.organization.legalName} · </span>
          )}
          <span className="text-ink-muted">
            {planLabel(contract)} · {contract.quantity} x {variantName}
          </span>
        </p>
      </div>
      {deadline && (
        <p className="flex flex-wrap items-baseline gap-x-2 rounded-control border border-line bg-surface px-3 py-1">
          <span className="text-label uppercase text-ink-muted">{deadline.label}</span>
          <time
            dateTime={deadline.at}
            title={viewerTimeZone()}
            className="text-body font-semibold tabular-nums text-ink"
          >
            {formatDateTime(deadline.at)}
          </time>
        </p>
      )}
    </header>
  );
};

const MARKER =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-caption font-extrabold';

const StepItem: React.FC<{ step: LifecycleStep; number: number; last: boolean; line: boolean }> = ({
  step,
  number,
  last,
  line,
}) => (
  <li
    aria-current={step.state === 'current' ? 'step' : undefined}
    className="flex min-h-8 flex-none items-center gap-1.5"
  >
    <span
      aria-hidden="true"
      className={cn(
        MARKER,
        step.state === 'done' && 'border-transparent bg-chrome text-brand',
        step.state === 'current' && 'border-transparent bg-accent text-on-accent',
        (step.state === 'todo' || step.state === 'skipped') &&
          'border-dashed border-line-strong text-ink-muted',
      )}
    >
      {step.state === 'done' ? <Check className="h-3.5 w-3.5" /> : number}
    </span>
    <span
      className={cn(
        'whitespace-nowrap text-body-sm font-semibold',
        step.state === 'todo' || step.state === 'skipped' ? 'text-ink-muted' : 'text-ink',
      )}
    >
      <span className="sr-only">
        {step.state === 'done'
          ? 'Completed: '
          : step.state === 'current'
            ? 'Current: '
            : step.state === 'skipped'
              ? 'Not reached: '
              : 'Not yet: '}
      </span>
      {step.label}
    </span>
    <span className="whitespace-nowrap text-caption tabular-nums text-ink-muted">
      {step.state === 'skipped'
        ? 'not reached'
        : step.at
          ? `${step.state === 'current' ? 'since ' : ''}${shortDate(step.at)}`
          : ''}
    </span>
    {step.exits.map((exit) => (
      <span key={exit.status} className="inline-flex items-center gap-1">
        <CornerDownRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-muted" />
        <span className="sr-only">Left the path here: </span>
        <StatusBadge entry={CONTRACT_STATUS[exit.status]} />
        {exit.at && (
          <span className="whitespace-nowrap text-caption tabular-nums text-ink-muted">
            {exit.current ? 'since ' : ''}
            {shortDate(exit.at)}
          </span>
        )}
      </span>
    ))}
    {line && !last && <span aria-hidden="true" className="h-px w-4 bg-line-strong" />}
  </li>
);

/**
 * The lifecycle strip and the Next step line in one card (§10.4, 44 to 80 px), generated from the
 * rentals state machine with exits as branch markers. Below 600 px it collapses to one line with a
 * disclosure that opens the full list (§10.5). From 600 px the steps wrap onto a second row where
 * they do not fit: a sideways scroll cut the words at the strip's fading edges (W20B item 6).
 */
export const LifecycleCard: React.FC<{
  contract: ContractDetail;
  history?: ContractTransition[];
  viewer: Viewer;
}> = ({ contract, history, viewer }) => {
  const phone = !useMediaQuery('(min-width: 600px)', true);
  const { steps, index } = lifecycleOf(contract, history);
  const next = nextStepOf(contract, viewer);
  const current = steps[index];
  const exit = current?.exits.find((each) => each.current);

  const summary = `Step ${index + 1} of ${steps.length}: ${exit ? exit.label : current?.label}${
    (exit?.at ?? current?.at) ? `, since ${shortDate(exit?.at ?? current?.at ?? null)}` : ''
  }`;

  return (
    <section
      aria-label="Contract lifecycle"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-panel border border-line bg-surface px-3 py-2 shadow-raise"
    >
      {phone ? (
        <details className="group min-w-0 flex-[1_1_100%]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              {summary}
              <span className="sr-only">. Show all steps</span>
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <ol aria-label="Lifecycle steps" className="flex flex-col gap-1 pb-1">
            {steps.map((step, position) => (
              <StepItem
                key={step.status}
                step={step}
                number={position + 1}
                last={position === steps.length - 1}
                line={false}
              />
            ))}
          </ol>
        </details>
      ) : (
        <div className="min-w-0 flex-[1_1_40rem]">
          <ol aria-label="Lifecycle steps" className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {steps.map((step, position) => (
              <StepItem
                key={step.status}
                step={step}
                number={position + 1}
                last={position === steps.length - 1}
                line
              />
            ))}
          </ol>
        </div>
      )}
      <p className="flex min-w-0 flex-[1_1_20rem] flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-label uppercase text-ink-muted">Next step</span>
        <Badge>{next.actor}</Badge>
        <span className="text-body-sm text-ink">{next.text}</span>
      </p>
    </section>
  );
};
