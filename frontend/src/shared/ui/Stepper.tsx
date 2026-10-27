import React from 'react';
import { Check } from 'lucide-react';
import { cn } from './cn';

export interface Step {
  label: string;
  description?: string;
}

interface StepperProps {
  /** At most 4 steps, each with at most 6 fields (convention 06 §3). */
  steps: Step[];
  /** Zero-based index of the current step. */
  current: number;
  className?: string;
}

/** Progress of a multi-step form. Done steps show a tick, the current one is marked for readers. */
export const Stepper: React.FC<StepperProps> = ({ steps, current, className }) => {
  if (import.meta.env.DEV && steps.length > 4) {
    console.warn('Stepper: convention 06 §3 allows at most 4 steps.');
  }
  return (
    <nav aria-label="Progress" className={className}>
      <p className="mb-2 text-body-sm text-ink-muted sm:hidden">
        Step {current + 1} of {steps.length}: <span className="font-semibold text-ink">{steps[current]?.label}</span>
      </p>
      <ol className="hidden items-start gap-2 sm:flex">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li key={step.label} aria-current={state === 'current' ? 'step' : undefined} className="flex flex-1 items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-body-sm font-extrabold',
                  state === 'done' && 'border-transparent bg-chrome text-brand',
                  state === 'current' && 'border-transparent bg-accent text-on-accent',
                  state === 'todo' && 'border-dashed border-line-strong text-ink-muted',
                )}
              >
                {state === 'done' ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col pt-1">
                <span className={cn('text-body-sm font-semibold', state === 'todo' ? 'text-ink-muted' : 'text-ink')}>
                  <span className="sr-only">{state === 'done' ? 'Completed: ' : state === 'current' ? 'Current: ' : ''}</span>
                  {step.label}
                </span>
                {step.description && <span className="text-caption text-ink-muted">{step.description}</span>}
              </span>
              {index < steps.length - 1 && <span aria-hidden="true" className="mt-4 hidden h-px flex-1 bg-line lg:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
