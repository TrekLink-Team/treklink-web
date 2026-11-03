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
