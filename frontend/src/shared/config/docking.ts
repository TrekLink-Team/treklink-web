// The variant a docked unit's build environment maps to (devices design section 8.3 step 3): the
// firmware reports its PlatformIO environment as `MyNodeInfo.pio_env`.
export const VARIANT_CODE_BY_PIO_ENV: Readonly<Record<string, string>> = {
  'treklink-v2': 'treklink-v2',
  'treklink-v3-tbeam': 'treklink-v3',
  'treklink-v4-supreme': 'treklink-v4',
};

// The unit reports `major.minor.build.<sha7>` (`bin/readprops.py`), a variant baseline reads
// `2.7.19-treklink.N`; they agree when the major.minor.build parts are equal (section 8.3).
export const firmwareBuildDiffers = (reported: string, baseline: string): boolean => {
  const build = (version: string) => version.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1, 4).join('.');
  const reportedBuild = build(reported);
  return !reportedBuild || reportedBuild !== build(baseline);
};
