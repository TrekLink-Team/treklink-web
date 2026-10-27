import type React from 'react';
import { create } from 'zustand';

// UI state of the app shell (convention 06 §2: client state in Zustand). Only the sidebar's
// collapsed state is remembered between visits.

const COLLAPSE_KEY = 'treklink.shell.navCollapsed';

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

export interface InfoPaneContent {
  /** Names the pane: the selected record ("CT-2026-0142") or the page ("Contracts"). */
  title: string;
  /** Tabs, properties, lifecycle: whatever the page shows for the selection. */
  body: React.ReactNode;
  /** Actions at the foot, primary first. */
  footer?: React.ReactNode;
  icon?: React.ReactNode;
}

interface ShellState {
  navCollapsed: boolean;
  drawerOpen: boolean;
  /** The docked pane (1280 px and wider): open unless the user closed it. */
  infoOpen: boolean;
  /** The sheet below 1280 px: closed until the user asks for the details. */
  infoSheetOpen: boolean;
  info: InfoPaneContent | null;
  quickNavOpen: boolean;
  toggleNav: () => void;
  setDrawer: (open: boolean) => void;
  setInfoOpen: (open: boolean) => void;
  setInfoSheet: (open: boolean) => void;
  setInfo: (info: InfoPaneContent | null) => void;
  setQuickNav: (open: boolean) => void;
}

export const useShell = create<ShellState>((set, get) => ({
  navCollapsed: readCollapsed(),
  drawerOpen: false,
  infoOpen: true,
  infoSheetOpen: false,
  info: null,
  quickNavOpen: false,
  toggleNav: () => {
    const next = !get().navCollapsed;
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // Remembered for this visit only.
    }
    set({ navCollapsed: next });
  },
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  setInfoOpen: (infoOpen) => set({ infoOpen }),
  setInfoSheet: (infoSheetOpen) => set({ infoSheetOpen }),
  setInfo: (info) => set({ info }),
  setQuickNav: (quickNavOpen) => set({ quickNavOpen }),
}));
