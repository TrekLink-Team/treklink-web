// Spreads live markers whose pointer targets would overlap (WCAG 2.2, 2.5.8 Target Size Minimum). Each
// marker's target is a 24 px circle; when two centres sit closer than 24 px at the current zoom, the
// markers of that group are offset onto a small circle around their centroid, so every target keeps its
// full size and no two intersect. Only the drawn icon moves: the marker's position stays the reading.

/** Smallest pointer target, and so the smallest distance between two target centres, in CSS px. */
export const MIN_TARGET_PX = 24;
// Neighbours on a ring are laid out one pixel further apart than the minimum, because Leaflet places
// icons on whole pixels: a ring at exactly 24 px measured 23.98 px between its closest pair once drawn.
const RING_SPACING_PX = MIN_TARGET_PX + 1;

export interface SpreadPoint {
  id: string;
  /** Centre of the marker's target in layer pixels at the current zoom. */
  x: number;
  y: number;
}

type Offset = [number, number];

// Radius of a circle on which `count` points sit `min` apart from their neighbours: the chord between
// two neighbours is 2 r sin(pi / count).
const radiusFor = (count: number, min: number): number =>
  count < 2 ? 0 : min / (2 * Math.sin(Math.PI / count));

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

// Places one group on its circle, `spacing` apart. Members keep their order around the centroid, so a
// pair stays on the line through the two readings; members that share one spot are ordered by id,
// starting at the top. Positions are rounded to whole pixels, as Leaflet draws them.
const layout = (members: SpreadPoint[], spacing: number): Map<string, { x: number; y: number }> => {
  const placed = new Map<string, { x: number; y: number }>();
  if (members.length === 1) {
    placed.set(members[0].id, { x: members[0].x, y: members[0].y });
    return placed;
  }
  const cx = members.reduce((sum, p) => sum + p.x, 0) / members.length;
  const cy = members.reduce((sum, p) => sum + p.y, 0) / members.length;
  const angleOf = (p: SpreadPoint) =>
    Math.hypot(p.x - cx, p.y - cy) < 1e-6 ? Number.NaN : Math.atan2(p.y - cy, p.x - cx);
  const sorted = [...members].sort((a, b) => {
    const [ta, tb] = [angleOf(a), angleOf(b)];
    if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a.id.localeCompare(b.id);
    return ta - tb;
  });
  const first = angleOf(sorted[0]);
  const start = Number.isNaN(first) ? -Math.PI / 2 : first;
  const radius = radiusFor(members.length, spacing);
  sorted.forEach((p, index) => {
    const angle = start + (2 * Math.PI * index) / members.length;
    placed.set(p.id, {
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
    });
  });
  return placed;
};

const closestPair = (placed: Map<string, { x: number; y: number }>): number => {
  const at = [...placed.values()];
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < at.length; i += 1)
    for (let j = i + 1; j < at.length; j += 1) closest = Math.min(closest, distance(at[i], at[j]));
  return closest;
};

// A group on its ring, widened a pixel at a time while rounding still leaves a pair under `min`.
const placeGroup = (members: SpreadPoint[], min: number): Map<string, { x: number; y: number }> => {
  let spacing = Math.max(RING_SPACING_PX, min + 1);
  let placed = layout(members, spacing);
  for (let widen = 0; widen < 8 && closestPair(placed) < min; widen += 1) {
    spacing += 1;
    placed = layout(members, spacing);
  }
  return placed;
};

/**
 * The pixel offset of each marker whose target would come closer than `min` to another one, in whole
 * pixels. Readings are rounded first, as Leaflet rounds a marker's position, so a reading plus its offset
 * is where the target is drawn. A marker that needs no offset is left out. Groups are merged until no two
 * placed targets are closer than `min`, so a spread group never lands on a neighbour.
 */
export const spreadOffsets = (input: SpreadPoint[], min = MIN_TARGET_PX): Map<string, Offset> => {
  const points = input.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) }));
  const parent = points.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < points.length; i += 1)
    for (let j = i + 1; j < points.length; j += 1)
      if (distance(points[i], points[j]) < min) join(i, j);

  let placed = new Map<string, { x: number; y: number }>();
  // Each pass either ends or merges two groups, so it ends within points.length passes.
  for (let pass = 0; pass <= points.length; pass += 1) {
    const groups = new Map<number, SpreadPoint[]>();
    points.forEach((p, index) => {
      const root = find(index);
      groups.set(root, [...(groups.get(root) ?? []), p]);
    });
    placed = new Map();
    for (const members of groups.values())
      for (const [id, at] of placeGroup(members, min)) placed.set(id, at);

    let merged = false;
    for (let i = 0; i < points.length && !merged; i += 1)
      for (let j = i + 1; j < points.length && !merged; j += 1) {
        if (find(i) === find(j)) continue;
        if (distance(placed.get(points[i].id)!, placed.get(points[j].id)!) < min) {
          join(i, j);
          merged = true;
        }
      }
    if (!merged) break;
  }

  const offsets = new Map<string, Offset>();
  for (const p of points) {
    const at = placed.get(p.id)!;
    if (at.x !== p.x || at.y !== p.y) offsets.set(p.id, [at.x - p.x, at.y - p.y]);
  }
  return offsets;
};
