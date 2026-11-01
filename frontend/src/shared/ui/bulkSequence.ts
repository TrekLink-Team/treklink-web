import { messageOf } from './errors';

// The client-side sequence behind a bulk action (BulkAction.tsx): the single-row endpoint once per row.

export interface BulkItem {
  id: string;
  /** Readable name: an asset tag, an email, a charge's device and contract. */
  label: string;
}

export interface BulkOutcome extends BulkItem {
  ok: boolean;
  /** The server's message for a failed row. */
  reason?: string;
}

/** Runs `run` for each item in order and reports every outcome; a failure does not stop the rest. */
export async function runInSequence(
  items: readonly BulkItem[],
  run: (item: BulkItem) => Promise<unknown>,
  onProgress?: (done: number) => void,
): Promise<BulkOutcome[]> {
  const outcomes: BulkOutcome[] = [];
  for (const item of items) {
    try {
      await run(item);
      outcomes.push({ ...item, ok: true });
    } catch (error) {
      outcomes.push({ ...item, ok: false, reason: messageOf(error) });
    }
    onProgress?.(outcomes.length);
  }
  return outcomes;
}
