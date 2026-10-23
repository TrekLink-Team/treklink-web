import { SetMetadata } from '@nestjs/common';

export const SCHEDULED_JOB_KEY = 'treklink:scheduledJob';

export interface ScheduledJobOptions {
  name: string; // "incidents.tierTimeouts", unique across the backend
  cron: string; // six fields with seconds, "*/5 * * * * *"
}

// Marks a provider method as a scheduled job (specs/platform/design.md §4.6). JobRunnerService
// finds every marked method at bootstrap and runs it on its cron under a per-name advisory lock.
// The owning module registers its own jobs; a job reads its deadlines from the database, so a
// restart resumes them (REQ-EVT-06).
export const ScheduledJob = (name: string, cron: string) =>
  SetMetadata(SCHEDULED_JOB_KEY, { name, cron } satisfies ScheduledJobOptions);
