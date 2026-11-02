'use strict';

// Builds a `trails.ts` entry of the field simulation (specs/demo/design.md §9) from OpenStreetMap ways,
// read through the Overpass API: the ways joined end to end in the order given, simplified with
// Douglas-Peucker at 10 m, printed with the way ids, the read date and the point counts. Map data
// © OpenStreetMap contributors, ODbL.
//
//   node scripts/fetch-osm-trail.js --id fansipan-tram-ton --name "Tram Ton to Fansipan" \
//     --region "Lao Cai" --ways 123,456
//   node scripts/fetch-osm-trail.js ... --ways 123,456 --file saved-overpass.json
//
// `--file` reads an Overpass JSON answer saved earlier (query `[out:json];way(id:123,456);out geom;`)
// instead of fetching it. Paste the printed entry into backend/src/modules/gateway-sync/simulator/trails.ts.

const fs = require('node:fs');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TOLERANCE_METRES = 10;
const METRES_PER_DEGREE_LAT = 111_320;

const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
})();

const fail = (message) => {
  process.stderr.write(`fetch-osm-trail: ${message}\n`);
  process.exit(1);
};

// Planar metres around a reference latitude, enough for a trail of a few kilometres.
const toXY =
  (lat0) =>
  ([lat, lon]) => [
    lon * METRES_PER_DEGREE_LAT * Math.cos((lat0 * Math.PI) / 180),
    lat * METRES_PER_DEGREE_LAT,
  ];

const perpendicular = (p, a, b) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

// Douglas-Peucker over [lat, lon] points; keeps the first and the last point.
const simplify = (points, tolerance) => {
  if (points.length < 3) return points.slice();
  const xy = points.map(toXY(points[0][0]));
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let furthest = 0;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(xy[i], xy[first], xy[last]);
      if (d > furthest) [furthest, index] = [d, i];
    }
    if (index !== -1 && furthest > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

const lengthMetres = (points) => {
  const xy = points.map(toXY(points[0][0]));
  let total = 0;
  for (let i = 1; i < xy.length; i++)
    total += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  return total;
};

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Joins the ways in the given order, each reversed where needed so that it continues the line.
const join = (ways) => {
  let line = [];
  for (const way of ways) {
    let points = way.geometry.map((g) => [g.lat, g.lon]);
    if (line.length === 0) {
      line = points;
      continue;
    }
    const end = line[line.length - 1];
    if (same(points[points.length - 1], end)) points = points.reverse();
    else if (!same(points[0], end)) {
      if (same(line[0], points[0]) || same(line[0], points[points.length - 1]))
        line = line.reverse();
      if (same(points[points.length - 1], line[line.length - 1])) points = points.reverse();
      if (!same(points[0], line[line.length - 1]))
        fail(
          `way ${way.id} does not touch the end of the ways before it; give the ids in path order`,
        );
    }
    line = line.concat(points.slice(1));
  }
  return line;
};

const main = async () => {
  for (const key of ['id', 'name', 'region', 'ways']) if (!args[key]) fail(`--${key} is required`);
  const ids = args.ways.split(',').map((id) => Number(id.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) fail('--ways must be positive way ids');
  let answer;
  if (args.file) answer = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  else {
    const query = `[out:json][timeout:60];way(id:${ids.join(',')});out tags geom;`;
    const response = await fetch(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) fail(`Overpass answered ${response.status}`);
    answer = await response.json();
  }
  const byId = new Map(
    (answer.elements || []).filter((e) => e.type === 'way').map((e) => [e.id, e]),
  );
  const ways = ids.map(
    (id) => byId.get(id) || fail(`way ${id} is missing from the Overpass answer`),
  );
  if (ways.some((way) => !Array.isArray(way.geometry) || way.geometry.length < 2))
    fail('every way needs its geometry (out geom)');
  const raw = join(ways);
  const points = simplify(raw, TOLERANCE_METRES);
  const km = (lengthMetres(points) / 1000).toFixed(1);
  const readOn = args.readOn || new Date().toISOString().slice(0, 10);
  const tags = ways.map((w) => w.tags || {});
  const describe = tags
    .map((t) =>
      [t.highway && `highway=${t.highway}`, t.name && `name=${t.name}`].filter(Boolean).join(', '),
    )
    .join('; ');
  const lines = [
    `  // OpenStreetMap way${ids.length > 1 ? 's' : ''} ${ids.join(', ')} (${describe || 'no tags'}), read through the Overpass`,
    `  // API on ${readOn} and simplified (Douglas-Peucker, ${TOLERANCE_METRES} m) from ${raw.length} to ${points.length} points, ${km} km.`,
    '  {',
    `    id: '${args.id}',`,
    `    name: '${args.name.replace(/'/g, "\\'")}',`,
    `    region: '${args.region.replace(/'/g, "\\'")}',`,
    '    points: [',
    ...points.map(([lat, lon]) => `      [${lat.toFixed(6)}, ${lon.toFixed(6)}],`),
    '    ],',
    '    source: {',
    `      osmWayIds: [${ids.join(', ')}],`,
    `      readOn: '${readOn}',`,
    `      simplification: 'Douglas-Peucker, ${TOLERANCE_METRES} m, ${raw.length} to ${points.length} points',`,
    '    },',
    '  },',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
};

if (require.main === module) void main();

module.exports = { simplify, join, lengthMetres };
