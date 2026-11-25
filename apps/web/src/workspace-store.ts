import { create } from 'zustand';

// UI preferences stay in memory; credentials and business data are never persisted.
export const useWorkspaceStore = create<{
  orderView: 'board' | 'list';
  setOrderView: (view: 'board' | 'list') => void;
  reset: () => void;
}>(set => ({
  orderView: 'board',
  setOrderView: orderView => set({ orderView }),
  reset: () => set({ orderView: 'board' }),
}));
