import type { Parameter, ParameterType } from './api';

// The checks and displays of a parameter value by its declared type (screen 7.4, platform api-design 03).
// The server checks the same rules; the client blocks a save before sending it (MSG02).

// PERCENT has a fixed range even when the row declares none.
const rangeOf = (parameter: Pick<Parameter, 'valueType' | 'bounds'>) => {
  const min = parameter.bounds?.min ?? (parameter.valueType === 'PERCENT' ? 0 : undefined);
  const max = parameter.bounds?.max ?? (parameter.valueType === 'PERCENT' ? 100 : undefined);
  return { min, max };
};

// "30 to 900", "at least 1", "at most 100" or null when the parameter declares no range.
export const boundsText = (parameter: Pick<Parameter, 'valueType' | 'bounds'>): string | null => {
  const { min, max } = rangeOf(parameter);
  if (min !== undefined && max !== undefined) return `${min} to ${max}`;
  if (min !== undefined) return `at least ${min}`;
  if (max !== undefined) return `at most ${max}`;
  return null;
};

export const TYPE_LABEL: Record<ParameterType, string> = {
  INT: 'Whole number',
  DURATION_SECONDS: 'Seconds',
  DECIMAL: 'Decimal',
  PERCENT: 'Percent',
  JSON: 'JSON',
};

// A value as one line: JSON compact, anything else as it is.
export const valueText = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));

// The text an edit starts from: JSON pretty-printed so a long value is readable in the text area.
export const inputText = (parameter: Pick<Parameter, 'valueType' | 'value'>): string =>
  parameter.valueType === 'JSON'
    ? (JSON.stringify(parameter.value, null, 2) ?? '')
    : valueText(parameter.value);

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export type Parsed = { value: unknown } | { error: string };

// The value typed for a parameter, or the MSG02 message that says what is wrong with it.
export const parseValue = (
  parameter: Pick<Parameter, 'key' | 'valueType' | 'bounds'>,
  text: string,
): Parsed => {
  const typed = text.trim();
  const { key, valueType } = parameter;
  if (valueType === 'JSON') {
    try {
      return { value: JSON.parse(typed) as unknown };
    } catch {
      return { error: `${key} must be valid JSON.` };
    }
  }
  const whole = valueType === 'INT' || valueType === 'DURATION_SECONDS';
  if (whole ? !/^-?\d+$/.test(typed) : !/^-?\d+(\.\d+)?$/.test(typed)) {
    return { error: `${key} must be ${whole ? 'a whole number' : 'a number'}.` };
  }
  const value = Number(typed);
  const { min, max } = rangeOf(parameter);
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    const range =
      min !== undefined && max !== undefined
        ? `between ${min} and ${max}`
        : min !== undefined
          ? `at least ${min}`
          : `at most ${max}`;
    return { error: `${key} must be ${range}.` };
  }
  return { value };
};

// The parameters grouped by owner module, modules and keys in alphabetical order.
export const groupByModule = (parameters: Parameter[]): [string, Parameter[]][] => {
  const groups = new Map<string, Parameter[]>();
  for (const parameter of parameters) {
    groups.set(parameter.ownerModule, [...(groups.get(parameter.ownerModule) ?? []), parameter]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, items]) => [module, items.sort((a, b) => a.key.localeCompare(b.key))]);
};
