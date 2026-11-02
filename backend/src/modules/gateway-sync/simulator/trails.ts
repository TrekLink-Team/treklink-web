// The trails of the field simulation (specs/demo/design.md §9, D-093 amendment): Vietnamese trails from
// OpenStreetMap, read through the Overpass API, simplified (Douglas-Peucker, 10 m) and compiled here, so
// no trail is fetched at run time. Each entry records its way ids, the read date and the simplification.
// Map data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright); the panel shows
// the attribution.

export type TrailPoint = readonly [number, number]; // [lat, lon], WGS-84 degrees

export interface TrailSource {
  osmWayIds: readonly number[];
  readOn: string; // ISO date the ways were read through the Overpass API
  simplification: string;
}

export interface Trail {
  id: string;
  name: string;
  region: string;
  points: readonly TrailPoint[];
  source: TrailSource;
}

// OpenStreetMap way 1164619760 (highway=path, source=bing, unnamed), the path south-east of Ta Nang toward
// Phan Dung, read through the Overpass API on 2026-11-01 and simplified (Douglas-Peucker, 10 m) from 189
// to 63 points, 7.2 km. The fixed two-node batch of D-090 walks it too (simulated-batch.ts).
export const TA_NANG_PHAN_DUNG_POINTS: readonly TrailPoint[] = [
  [11.510808, 108.562536],
  [11.509894, 108.561541],
  [11.508443, 108.561058],
  [11.507124, 108.561012],
  [11.506748, 108.561474],
  [11.506335, 108.561592],
  [11.505778, 108.562016],
  [11.505486, 108.562675],
  [11.504713, 108.563131],
  [11.503644, 108.564231],
  [11.501707, 108.565497],
  [11.500771, 108.565712],
  [11.49962, 108.566723],
  [11.498537, 108.568171],
  [11.497924, 108.568587],
  [11.497591, 108.568646],
  [11.497002, 108.569228],
  [11.496936, 108.569536],
  [11.495667, 108.571663],
  [11.494991, 108.572259],
  [11.49481, 108.573179],
  [11.494431, 108.573833],
  [11.492938, 108.574842],
  [11.491827, 108.575209],
  [11.491903, 108.575515],
  [11.492273, 108.575848],
  [11.492266, 108.576516],
  [11.49169, 108.577175],
  [11.491506, 108.577956],
  [11.491091, 108.578492],
  [11.48862, 108.579168],
  [11.487437, 108.580327],
  [11.486675, 108.580483],
  [11.486054, 108.58111],
  [11.485403, 108.582623],
  [11.484546, 108.582939],
  [11.483342, 108.582661],
  [11.482085, 108.582146],
  [11.481101, 108.582872],
  [11.480479, 108.582875],
  [11.479549, 108.584058],
  [11.479178, 108.585758],
  [11.478335, 108.587408],
  [11.478416, 108.587694],
  [11.477718, 108.588658],
  [11.476888, 108.588847],
  [11.47643, 108.588604],
  [11.476176, 108.588673],
  [11.475777, 108.588379],
  [11.475251, 108.588828],
  [11.473819, 108.589326],
  [11.471847, 108.591185],
  [11.470144, 108.591839],
  [11.468911, 108.591992],
  [11.468356, 108.592436],
  [11.467856, 108.59263],
  [11.466787, 108.592848],
  [11.466119, 108.592563],
  [11.465541, 108.592751],
  [11.464842, 108.592451],
  [11.464242, 108.592756],
  [11.463985, 108.593143],
  [11.463927, 108.593824],
];

export const TRAILS: readonly Trail[] = [
  {
    id: 'ta-nang-phan-dung',
    name: 'Ta Nang to Phan Dung',
    region: 'Lam Dong',
    points: TA_NANG_PHAN_DUNG_POINTS,
    source: {
      osmWayIds: [1164619760],
      readOn: '2026-11-01',
      simplification: 'Douglas-Peucker, 10 m, 189 to 63 points',
    },
  },
];

export const trailById = (id: string): Trail | undefined => TRAILS.find((trail) => trail.id === id);
