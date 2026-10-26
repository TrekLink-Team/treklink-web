// The two labels drawn over Hoàng Sa and Trường Sa on every map (REQ-UBI-02, BR-30, D-031).
// Nghị định 174/2026/NĐ-CP Art. 93(3)(a) fines a map that does not depict sovereignty fully, so this is
// a legal constant of the build and not a business parameter: an Admin cannot edit it away from the
// parameter screen. The client renders whatever this list holds and never adds a label of its own.
export interface SovereigntyLabel {
  label: string;
  lat: number;
  lon: number;
}

export const SOVEREIGNTY_OVERLAY: readonly SovereigntyLabel[] = [
  { label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112.0 },
  { label: 'Quần đảo Trường Sa (Việt Nam)', lat: 10.0, lon: 114.0 },
];
