// Spreads live markers whose pointer targets would overlap (WCAG 2.2, 2.5.8 Target Size Minimum). Each
// marker's target is a 24 px circle; when two centres sit closer than 24 px at the current zoom, the
// markers of that group are offset onto a small circle around their centroid, so every target keeps its
// full size and, within the reach set out below, no two intersect. Only the drawn icon moves: the
// marker's position stays the reading.

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
// starting at the top. `turn` rotates the whole ring about its centroid, in radians. Positions are
// rounded to whole pixels, as Leaflet draws them.
const layout = (
  members: SpreadPoint[],
  spacing: number,
  turn = 0,
): Map<string, { x: number; y: number }> => {
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
  const start = (Number.isNaN(first) ? -Math.PI / 2 : first) + turn;
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
const placeGroup = (
  members: SpreadPoint[],
  min: number,
  turn = 0,
): Map<string, { x: number; y: number }> => {
  let spacing = Math.max(RING_SPACING_PX, min + 1);
  let placed = layout(members, spacing, turn);
  for (let widen = 0; widen < 8 && closestPair(placed) < min; widen += 1) {
    spacing += 1;
    placed = layout(members, spacing, turn);
  }
  return placed;
};

// Steps tried per half turn of a ring, in each direction, when it lands on a neighbour.
const TURN_STEPS = 12;

// The smallest distance from a ring's placed members to the targets outside the ring, all of them or
// only those in `among`.
const clearanceOf = (
  ring: Map<string, { x: number; y: number }>,
  placed: Map<string, { x: number; y: number }>,
  among?: Set<string>,
): number => {
  let clearance = Number.POSITIVE_INFINITY;
  for (const at of ring.values())
    for (const [id, other] of placed)
      if (!ring.has(id) && (!among || among.has(id)))
        clearance = Math.min(clearance, distance(at, other));
  return clearance;
};

// Turns a ring that lands on an unspread neighbour it may not take in. Merging two groups grows the
// ring, and the larger ring can push a member onto a lone marker past the merge reach: two zoom-outs
// on the seeded Staff map left TL-0009 20.81 px from TL-0017 (review of treklink-web#367). A ring of n
// repeats every 2 pi / n, so turns up to pi / n either way are tried, smallest first; the first that
// clears every target outside the ring by `min` wins, otherwise the one that comes closest. The radius,
// and so how far an icon moves from its reading, stays the same. Two rings that touch each other stay
// as they are: that is the dense crowd past the merge reach.
const turnClear = (
  members: SpreadPoint[],
  min: number,
  placed: Map<string, { x: number; y: number }>,
  lone: Set<string>,
): Map<string, { x: number; y: number }> => {
  let best = new Map([...placed].filter(([id]) => members.some((p) => p.id === id)));
  if (clearanceOf(best, placed, lone) >= min) return best;
  let bestClearance = clearanceOf(best, placed);
  const step = Math.PI / members.length / TURN_STEPS;
  for (let k = 1; k <= TURN_STEPS; k += 1)
    for (const turn of [k * step, -k * step]) {
      const ring = placeGroup(members, min, turn);
      const clearance = clearanceOf(ring, placed);
      if (clearance >= min) return ring;
      if (clearance > bestClearance) [best, bestClearance] = [ring, clearance];
    }
  return shiftClear(best, min, placed, lone);
};

// How far a ring may shift, in all, away from lone markers no turn clears.
const MAX_SHIFT_PX = MIN_TARGET_PX / 2;

// Shifts a ring that no turn clears away from the lone markers it still lands on: a lone marker close
// to the ring's centroid is within `min` of some member at every turn. Each step moves the whole ring,
// so its spacing holds, by the shortfall to each such marker, and is kept only when it brings the ring
// nearer to clearing every target outside it. The shift stays within MAX_SHIFT_PX in all.
const shiftClear = (
  ring: Map<string, { x: number; y: number }>,
  min: number,
  placed: Map<string, { x: number; y: number }>,
  lone: Set<string>,
): Map<string, { x: number; y: number }> => {
  let best = ring;
  let bestClearance = clearanceOf(ring, placed);
  let [sx, sy] = [0, 0];
  for (let step = 0; step < 4 && bestClearance < min; step += 1) {
    let [px, py] = [0, 0];
    for (const at of best.values())
      for (const id of lone) {
        const other = placed.get(id);
        if (!other || best.has(id)) continue;
        const gap = distance(at, other);
        if (gap >= min || gap === 0) continue;
        px += ((at.x - other.x) / gap) * (min - gap);
        py += ((at.y - other.y) / gap) * (min - gap);
      }
    if (px === 0 && py === 0) break;
    let [nx, ny] = [sx + px, sy + py];
    const length = Math.hypot(nx, ny);
    if (length > MAX_SHIFT_PX)
      [nx, ny] = [(nx / length) * MAX_SHIFT_PX, (ny / length) * MAX_SHIFT_PX];
    const [dx, dy] = [Math.round(nx - sx), Math.round(ny - sy)];
    if (dx === 0 && dy === 0) break;
    const moved = new Map([...best].map(([id, at]) => [id, { x: at.x + dx, y: at.y + dy }]));
    const clearance = clearanceOf(moved, placed);
    if (clearance <= bestClearance) break;
    [best, bestClearance, sx, sy] = [moved, clearance, sx + dx, sy + dy];
  }
  return best;
};

// How far a group reaches from its first member. Grouping by "within 24 px of any member" chained, so
// after two zoom-outs all ten seeded units formed one ring with icons about 55 px from their readings
// (review of treklink-web#360). A group is the markers within 24 px of its first member, and a group
// whose ring lands on a neighbouring group takes that group in only while every member stays within two
// targets of its first member, which bounds how far an icon moves from its reading.
const MERGE_REACH_TARGETS = 2;

interface Group {
  seed: SpreadPoint;
  members: SpreadPoint[];
}

/**
 * The pixel offset of each marker whose target would come closer than `min` to another one, in whole
 * pixels. Readings are rounded first, as Leaflet rounds a marker's position, so a reading plus its offset
 * is where the target is drawn. A marker that needs no offset is left out.
 *
 * Markers are taken in id order, so the grouping is the same at every redraw. Each marker not yet in a
 * group starts one with the free markers within `min` of it. Where a ring lands on a neighbouring group,
 * the two merge if every member stays within two targets of the first group's first member. Past that
 * reach, as in a dense crowd at a low zoom, two rings may still come closer than `min`: an icon never
 * drifts far from its reading to clear them.
 */
export const spreadOffsets = (input: SpreadPoint[], min = MIN_TARGET_PX): Map<string, Offset> => {
  const points = input
    .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  let groups: Group[] = [];
  const grouped = new Set<string>();
  for (const seed of points) {
    if (grouped.has(seed.id)) continue;
    const members = points.filter((p) => !grouped.has(p.id) && distance(p, seed) < min);
    for (const p of members) grouped.add(p.id);
    groups.push({ seed, members });
  }

  const reach = MERGE_REACH_TARGETS * min;
  let placed = new Map<string, { x: number; y: number }>();
  // Each pass either ends or merges two groups, so it ends within points.length passes.
  for (let pass = 0; pass <= points.length; pass += 1) {
    placed = new Map();
    for (const { members } of groups)
      for (const [id, at] of placeGroup(members, min)) placed.set(id, at);

    let merge: [number, number] | null = null;
    for (let a = 0; a < groups.length && !merge; a += 1)
      for (let b = a + 1; b < groups.length && !merge; b += 1) {
        const union = [...groups[a].members, ...groups[b].members];
        if (union.some((p) => distance(p, groups[a].seed) >= reach)) continue;
        const collide = groups[a].members.some((p) =>
          groups[b].members.some((q) => distance(placed.get(p.id)!, placed.get(q.id)!) < min),
        );
        if (collide) merge = [a, b];
      }
    if (!merge) {
      // Rings that still land on a lone marker they may not take in turn to clear it.
      const lone = new Set(groups.filter((g) => g.members.length === 1).map((g) => g.seed.id));
      for (const { members } of groups) {
        if (members.length < 2) continue;
        for (const [id, at] of turnClear(members, min, placed, lone)) placed.set(id, at);
      }
      break;
    }
    const [a, b] = merge;
    groups = groups
      .map((group, index) =>
        index === a
          ? { seed: group.seed, members: [...group.members, ...groups[b].members] }
          : group,
      )
      .filter((_, index) => index !== b);
  }

  const offsets = new Map<string, Offset>();
  for (const p of points) {
    const at = placed.get(p.id)!;
    if (at.x !== p.x || at.y !== p.y) offsets.set(p.id, [at.x - p.x, at.y - p.y]);
  }
  return offsets;
};
