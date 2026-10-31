import React from 'react';
import { formatDateTime } from '../../shared/lib/format';

export interface BatteryReading {
  at: string;
  batteryPct: number;
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD = { left: 36, right: 12, top: 10, bottom: 22 };
// An SVG path of tens of thousands of points adds nothing the eye can see; keep about this many.
const MAX_DRAWN = 600;

const thin = <T,>(items: T[]): T[] => {
  if (items.length <= MAX_DRAWN) return items;
  const step = Math.ceil(items.length / MAX_DRAWN);
  const kept = items.filter((_, index) => index % step === 0);
  return kept[kept.length - 1] === items[items.length - 1] ? kept : [...kept, items[items.length - 1]];
};

/**
 * Battery over time as a line (screen 9.2). The table of the same readings sits beside it on the page,
 * so the chart is never the only way to read a value; this one has a text alternative that states the
 * first and last reading.
 */
export const BatteryChart: React.FC<{ readings: BatteryReading[]; deviceLabel: string }> = ({
  readings,
  deviceLabel,
}) => {
  if (readings.length === 0) {
    return <p className="text-body text-ink-muted">No battery readings in this range.</p>;
  }
  const first = readings[0];
  const last = readings[readings.length - 1];
  const start = new Date(first.at).getTime();
  const span = Math.max(1, new Date(last.at).getTime() - start);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (at: string) => PAD.left + ((new Date(at).getTime() - start) / span) * plotWidth;
  const y = (pct: number) => PAD.top + (1 - Math.min(100, Math.max(0, pct)) / 100) * plotHeight;
  const drawn = thin(readings);
  const line = drawn.map((r) => `${x(r.at).toFixed(1)},${y(r.batteryPct).toFixed(1)}`).join(' ');
  const text =
    `Battery of ${deviceLabel} from ${first.batteryPct} % at ${formatDateTime(first.at)} ` +
    `to ${last.batteryPct} % at ${formatDateTime(last.at)}, ${readings.length} readings`;

  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={text}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-40 w-full text-brand"
      >
        {[0, 50, 100].map((pct) => (
          <g key={pct}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(pct)}
              y2={y(pct)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(pct) + 4} textAnchor="end" className="fill-ink-muted text-[10px]">
              {pct}
            </text>
          </g>
        ))}
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text x={PAD.left} y={HEIGHT - 6} className="fill-ink-muted text-[10px]">
          {formatDateTime(first.at)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-ink-muted text-[10px]">
          {formatDateTime(last.at)}
        </text>
      </svg>
      <figcaption className="text-body-sm text-ink-muted">Battery, % of full charge</figcaption>
    </figure>
  );
};
