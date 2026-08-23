import { create } from 'zustand';
import { getDatabase } from '../lib/database';

interface SyncStatusState {
  pendingCount: number;
  isSyncing: boolean;
  lastError: string | null;
  checkPending: () => Promise<void>;
  setSyncing: (val: boolean) => void;
  setLastError: (err: string | null) => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  pendingCount: 0,
  isSyncing: false,
  lastError: null,
  checkPending: async () => {
    try {
      const db = await getDatabase();
      const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sync_log');
      set({ pendingCount: result?.count || 0 });
    } catch (e) {
      console.error('Error checking sync status:', e);
    }
  },
  setSyncing: (val) => set({ isSyncing: val }),
  setLastError: (err) => set({ lastError: err }),
}));
