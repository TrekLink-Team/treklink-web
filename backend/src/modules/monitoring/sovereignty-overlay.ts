// The two labels drawn over Hoàng Sa and Trường Sa on every map (REQ-UBI-02, BR-30, D-031).
// Nghị định 174/2026/NĐ-CP Art. 93(3)(a) fines a map that does not depict sovereignty fully, so this is
// a legal constant of the build and not a business parameter: an Admin cannot edit it away from the
// parameter screen. The client renders whatever this list holds and never adds a label of its own.
//
// `mask` is the area under each label that the client covers with an opaque fill, so the basemap's own
// labels there never show (D-085, dry run defect 11): OpenTopoMap and OpenStreetMap-derived tiles print
// PRC district and reef names ("西沙区", "南沙区", "华光礁") over both archipelagos from zoom 6. Each
// polygon is [lat, lon] pairs, Leaflet order, and spans every such label checked on 2026-10-30 at zooms 5
// to 10, plus the margin a label's text runs past its anchor at zoom 6. Keep the label inside its mask.
export interface SovereigntyLabel {
  label: string;
  lat: number;
  lon: number;
  mask: [number, number][];
}

export const SOVEREIGNTY_OVERLAY: readonly SovereigntyLabel[] = [
  {
    label: 'Quần đảo Hoàng Sa (Việt Nam)',
    lat: 16.5,
    lon: 112.0,
    mask: [
      [17.7, 110.6],
      [17.7, 113.6],
      [15.2, 113.6],
      [15.2, 110.6],
    ],
  },
  {
    label: 'Quần đảo Trường Sa (Việt Nam)',
    lat: 10.0,
    lon: 114.0,
    mask: [
      [12.3, 111.1],
      [12.3, 117.7],
      [10.2, 117.7],
      [8.6, 116.9],
      [7.6, 116.5],
      [7.0, 115.2],
      [7.0, 111.1],
    ],
  },
];
