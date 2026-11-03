// CSV text for the report rows (monitoring api-design 08, `format=csv`): one header row, one row per
// record, LF line ends. A value holding a comma, a quote or a line break is quoted with its quotes
// doubled (RFC 4180). A missing value is an empty cell, and money is plain digits.
type Cell = string | number | null | undefined;

const cell = (value: Cell): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns: readonly string[], rows: readonly object[]): string =>
  [
    columns.join(','),
    ...rows.map((row) => columns.map((key) => cell((row as Record<string, Cell>)[key])).join(',')),
  ].join('\n');
