// The spec sheet of a hardware variant (specs/devices/design.md section 10): display text by key, never
// behaviour. The keys and their order are fixed; a key the sheet lacks is not shown.
export const SPEC_KEYS = [
  ['mcu', 'MCU'],
  ['radio', 'Radio'],
  ['gnss', 'GNSS'],
  ['motionSensor', 'Motion sensor'],
  ['display', 'Display'],
  ['battery', 'Battery'],
  ['sosControl', 'SOS control'],
  ['localAlarm', 'Local alarm'],
  ['enclosure', 'Enclosure'],
] as const;

export interface SpecLine {
  key: string;
  label: string;
  value: string;
}

// The lines of a spec sheet in the fixed order. The sheet is read as unknown because it is JSON from the
// server: anything that is not a non-empty string under a listed key is left out.
export const specLines = (specSheet: unknown): SpecLine[] => {
  if (typeof specSheet !== 'object' || specSheet === null) return [];
  const sheet = specSheet as Record<string, unknown>;
  return SPEC_KEYS.flatMap(([key, label]) => {
    const value = sheet[key];
    return typeof value === 'string' && value.trim() !== '' ? [{ key, label, value }] : [];
  });
};

// What a variant needs to be drawn as a card: the fields every read of the variants carries. The
// capability flags are optional so a read that predates them still draws.
export interface VariantMedia {
  name: string;
  imageUrl: string | null;
  specSheet: unknown;
  hasGps?: boolean;
  hasMotionSensor?: boolean;
  mqttCapable?: boolean;
  firmwareBaseline?: string;
}

// The capability flags as text (design section 10), or null when the read carries none of them. The
// flags stay the source of logic; this line is display only.
export const capabilityText = (variant: VariantMedia): string | null => {
  const { hasGps, hasMotionSensor, mqttCapable } = variant;
  if (hasGps === undefined && hasMotionSensor === undefined && mqttCapable === undefined) return null;
  const names = [
    hasGps ? 'GPS' : null,
    hasMotionSensor ? 'Motion sensor' : null,
    mqttCapable ? 'MQTT' : null,
  ].filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(', ') : 'None';
};

// The two renders of a variant (design section 10, "Two renders per variant"). `imageUrl` names the detail
// render; the icon render is found by name, a final `-detail.<ext>` becoming `-icon.<ext>`
// (`/variants/treklink-v3-detail.png` gives `/variants/treklink-v3-icon.png`). A value without that suffix,
// such as an https photo, serves both places. A query string or fragment keeps the value as it is.
const DETAIL_SUFFIX = /-detail(\.(?:png|jpe?g|webp))$/i;

export type VariantRender = 'detail' | 'icon';

export const iconUrlOf = (imageUrl: string): string => imageUrl.replace(DETAIL_SUFFIX, '-icon$1');

// The sources to try in order for one render: the icon falls back to the detail render, which falls back
// to the empty slot. No source at all means the variant has no image.
export const imageSources = (
  imageUrl: string | null | undefined,
  render: VariantRender,
): string[] => {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') return [];
  if (render === 'detail') return [imageUrl];
  const icon = iconUrlOf(imageUrl);
  return icon === imageUrl ? [imageUrl] : [icon, imageUrl];
};
