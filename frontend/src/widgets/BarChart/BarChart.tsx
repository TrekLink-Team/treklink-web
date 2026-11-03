import React from 'react';

export interface BarSeries {
  name: string;
  // The fill of this series' bars, a Tailwind class.
  fill: string;
}

export interface BarGroup {
  label: string;
  // One value per series, in the order of `series`.
  values: number[];
}

/**
 * Horizontal bars, one group per row and one bar per series in a group (screen 9.4). The table of the same
 * rows sits beside it on the page, so the chart is never the only way to read a value; the chart has a
 * text alternative that states each group. Every bar carries its value as text and the series are named
 * in a legend, so colour is never the only difference (convention 06 §8 item 3).
 */
export const BarChart: React.FC<{
  groups: BarGroup[];
  series: BarSeries[];
  /** The value that fills the track; defaults to the largest value drawn. */
  max?: number;
  format: (value: number) => string;
  /** The text alternative, for example "Revenue by variant: treklink-v3 invoiced 18,000,000 VND, paid ...". */
  alternative: string;
}> = ({ groups, series, max, format, alternative }) => {
  const top = max ?? Math.max(0, ...groups.flatMap((group) => group.values));
  const width = (value: number) => (top > 0 ? Math.max(0, Math.min(100, (value / top) * 100)) : 0);
  return (
    <figure className="m-0">
      <div role="img" aria-label={alternative} className="flex flex-col gap-3">
        {groups.map((group) => (
          <div
            key={group.label}
            className="grid grid-cols-[8rem_1fr] items-center gap-3"
            aria-hidden="true"
          >
            <span className="truncate text-body-sm text-ink" title={group.label}>
              {group.label}
            </span>
            <div className="flex flex-col gap-1">
              {group.values.map((value, index) => (
                <div key={series[index].name} className="flex items-center gap-2">
                  <div className="h-3 min-w-0 flex-1 rounded-full bg-sunken">
                    <div
                      className={`h-3 rounded-full ${series[index].fill}`}
                      style={{ width: `${width(value)}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right font-mono text-body-sm tabular-nums text-ink">
                    {format(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <figcaption className="mt-3 flex flex-wrap gap-4 text-body-sm text-ink-muted">
          {series.map((item) => (
            <span key={item.name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-3 rounded-full ${item.fill}`}
              />
              {item.name}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
};
