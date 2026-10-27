import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge needs the custom scales of tailwind.config.js, or it would drop `text-body`
// next to `text-ink` as if both were colours.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'body-sm', 'body', 'body-lg', 'title-sm', 'title', 'title-lg', 'display', 'kpi', 'label'] },
      ],
      shadow: [{ shadow: ['glass', 'raise', 'press', 'overlay', 'sheet'] }],
      rounded: [{ rounded: ['badge', 'control', 'card', 'panel', 'sheet'] }],
    },
  },
});

/** Joins class names and lets later Tailwind classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]): string => merge(clsx(inputs));
