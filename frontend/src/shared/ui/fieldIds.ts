/** Ids of the hint and error of a field, for aria-describedby on its control. */
export const describedBy = (id: string, hint?: string, error?: string): string | undefined =>
  [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

