import { create } from 'zustand';
import { getDatabase } from '../lib/database';
import { Level, TimeBlock } from '../types';

interface LevelState {
  levels: Level[];
  isLoading: boolean;
  fetchLevels: () => Promise<void>;
  getTimeBlocks: (levelId: string) => Promise<TimeBlock[]>;
  getLevelsByGender: (gender: 'male' | 'female') => Level[];
  getUstazLevels: (ustazId: string) => Promise<Level[]>;
}

export const useLevelStore = create<LevelState>((set, get) => ({
  levels: [],
  isLoading: false,

  fetchLevels: async () => {
    set({ isLoading: true });
    const db = await getDatabase();
    const rows = await db.getAllAsync<Level>(
      'SELECT * FROM levels ORDER BY gender ASC, name ASC'
    );
    set({ levels: rows, isLoading: false });
  },

  getTimeBlocks: async (levelId) => {
    const db = await getDatabase();
    return db.getAllAsync<TimeBlock>(
      'SELECT * FROM time_blocks WHERE level_id = ? ORDER BY start_time ASC',
      [levelId]
    );
  },

  getLevelsByGender: (gender) => {
    return get().levels.filter(l => l.gender === gender);
  },

  getUstazLevels: async (ustazId) => {
    const db = await getDatabase();
    // Ustazs are linked to levels via a junction — for now we use a simple
    // ustaz_levels table we store in the users table notes field as JSON
    // Or we can create a separate mapping. For now all levels for ustaz.
    return db.getAllAsync<Level>(
      'SELECT * FROM levels ORDER BY gender ASC, name ASC'
    );
  },
}));
