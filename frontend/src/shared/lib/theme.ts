import { create } from 'zustand';

// Light ("Canopy") and dark ("Volt") themes of the TrekLink System (docs/design-system.md).
// The preference is the viewer's choice; `system` follows the operating system. The resolved theme
// is written to <html data-theme>, which the tokens in app/styles/tokens.css read.

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'treklink.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const readPreference = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
};

const writePreference = (preference: ThemePreference): void => {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this visit.
  }
};

const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';

export const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === 'system' ? systemTheme() : preference;

const apply = (theme: ResolvedTheme): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
};

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Switches between light and dark, leaving `system`. */
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const preference = readPreference();
  return {
    preference,
    resolved: resolveTheme(preference),
    setPreference: (next) => {
      writePreference(next);
      const resolved = resolveTheme(next);
      apply(resolved);
      set({ preference: next, resolved });
    },
    toggle: () => get().setPreference(get().resolved === 'dark' ? 'light' : 'dark'),
  };
});

// Applies the stored preference and follows the operating system while the preference is `system`.
// Called once at startup (app/main.tsx); returns the unsubscribe for tests.
export const startTheme = (): (() => void) => {
  const state = useTheme.getState();
  apply(state.resolved);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (useTheme.getState().preference !== 'system') return;
    const resolved = systemTheme();
    apply(resolved);
    useTheme.setState({ resolved });
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
