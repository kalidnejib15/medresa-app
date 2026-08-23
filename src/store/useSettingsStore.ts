import { create } from 'zustand';
import { getDatabase } from '../lib/database';

interface SettingsState {
  defaultFee: number;
  isLoading: boolean;
  fetchSettings: () => Promise<void>;
  updateDefaultFee: (amount: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  defaultFee: 500,
  isLoading: false,

  fetchSettings: async () => {
    set({ isLoading: true });
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['default_fee']);
      if (row) {
        set({ defaultFee: parseInt(row.value) });
      }
    } catch (e) {
      console.error('Fetch Settings Error:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  updateDefaultFee: async (amount: number) => {
    try {
      const db = await getDatabase();
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['default_fee', amount.toString()]);
      set({ defaultFee: amount });
      
      // Optional: Inform other stores or sync this to cloud if we had a settings sync
    } catch (e) {
      console.error('Update Fee Error:', e);
    }
  }
}));
