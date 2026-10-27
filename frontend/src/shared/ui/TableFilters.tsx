import React from 'react';

// The in-table filter pattern: every list table carries a filter row inside its header, one control
// under each filterable column, and the same controls as a bar above the cards below 768 px. A text
// filter matches "contains", case-insensitive; a select matches exactly. Filters that the endpoint
// supports (a status, a plan) still query the server; the others narrow the rows already loaded.

export interface FilterField {
  label: string;
  kind: 'text' | 'select';
  value: string;
  onChange: (value: string) => void;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';

const CONTROL = `h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS}`;

const CLEAR = `h-9 whitespace-nowrap rounded-md px-2 text-sm font-semibold normal-case tracking-normal text-blue-700 hover:bg-blue-50 ${FOCUS}`;

const Control: React.FC<{ field: FilterField }> = ({ field }) =>
  field.kind === 'select' ? (
    <select
      aria-label={`Filter by ${field.label}`}
      className={CONTROL}
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
    >
      <option value="">All</option>
      {field.options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ) : (
    <input
      type="search"
      aria-label={`Filter by ${field.label}`}
      placeholder={field.placeholder ?? 'Filter'}
      className={CONTROL}
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
    />
  );

// A second header row: one cell per column, `null` for a column with nothing to filter. Clear sits in
// the last cell once any filter is set.
export const FilterRow: React.FC<{
  columns: (FilterField | null)[];
  onClear: () => void;
}> = ({ columns, onClear }) => {
  const active = columns.some((column) => column && column.value !== '');
  return (
    <tr className="border-t border-slate-200 bg-white">
      {columns.map((column, index) => (
        <th key={index} scope="col" className="px-2 py-2 align-top">
          <div className="flex items-center gap-1">
            {column && <Control field={column} />}
            {active && index === columns.length - 1 && (
              <button type="button" className={CLEAR} onClick={onClear}>
                Clear
              </button>
            )}
          </div>
        </th>
      ))}
    </tr>
  );
};

// The same controls above the card list of a narrow screen.
export const FilterBar: React.FC<{
  fields: FilterField[];
  onClear: () => void;
  className?: string;
}> = ({ fields, onClear, className = '' }) => {
  const active = fields.some((field) => field.value !== '');
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {fields.map((field) => (
        <div key={field.label} className="min-w-[8rem] flex-1">
          <Control field={field} />
        </div>
      ))}
      {active && (
        <button type="button" className={CLEAR} onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
};

// The body row of a table whose filters match nothing; the filter row above stays usable.
export const NoMatchRow: React.FC<{ colSpan: number; onClear: () => void }> = ({
  colSpan,
  onClear,
}) => (
  <tr className="border-t border-slate-200">
    <td colSpan={colSpan} className="px-4 py-6 text-center text-slate-700">
      No rows match these filters.{' '}
      <button type="button" className="font-semibold text-blue-700 underline" onClick={onClear}>
        Clear filters
      </button>
    </td>
  </tr>
);
