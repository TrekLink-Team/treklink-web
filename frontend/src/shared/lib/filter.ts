// The text match of the in-table filters (shared/ui/TableFilters.tsx): case-insensitive "contains"
// on the joined text of a row's cells; an empty filter matches every row.
export const matchesText = (needle: string, ...haystack: (string | number | null | undefined)[]) =>
  needle.trim() === '' ||
  haystack
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase()
    .includes(needle.trim().toLowerCase());
