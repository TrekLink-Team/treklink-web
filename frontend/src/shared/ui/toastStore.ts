import { create } from 'zustand';

// One toast at a time (MSG03, MSG14, MSG15, MSG20 and the like), announced politely and cleared
// after a few seconds or on dismiss.
interface ToastState {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null }),
}));
