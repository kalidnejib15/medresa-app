import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getDatabase } from '../lib/database';
import { User } from '../types';

const SESSION_KEY = 'medersa_user_v1';

async function hashPassword(password: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password
  );
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isFirstLaunch: boolean;
  login: (phone: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  addUser: (name: string, phone: string, password: string, role: 'admin' | 'ustaz', levelIds?: string[]) => Promise<boolean>;
  getUstazs: () => Promise<User[]>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,
  isFirstLaunch: false,

  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (raw) {
        const user = JSON.parse(raw) as User;
        // Verify user still exists and is active in DB
        const db = await getDatabase();
        const dbUser = await db.getFirstAsync<User>(
          'SELECT * FROM users WHERE id = ? AND is_active = 1',
          [user.id]
        );
        if (dbUser) {
          set({ user: dbUser, isLoading: false });
          return;
        }
      }
    } catch {}
    set({ isLoading: false });
  },

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const cleanUser = username.trim();
      const db = await getDatabase();
      const hashed = await hashPassword(password);

      let user = await db.getFirstAsync<User>(
        'SELECT * FROM users WHERE username = ? AND password_hash = ? AND is_active = 1',
        [cleanUser, hashed]
      );
      
      // 🌍 CLOUD HANDSHAKE (Seamless New Phone Support)
      if (!user) {
        try {
          const { supabase } = await import('../lib/supabase');
          // Check for profile in cloud with matching hash
          const { data: cloudUser, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', cleanUser)
            .eq('password_hash', hashed)
            .eq('is_active', true)
            .single();

          if (cloudUser) {
             // 🎯 Found on cloud! Save to local DB instantly
             await db.runAsync(
               `INSERT OR REPLACE INTO users (id, username, name, phone, role, password_hash, is_active, created_at)
                VALUES (?,?,?,?,?,?,?,?)`,
               [cloudUser.id, cloudUser.username, cloudUser.name, cloudUser.phone, cloudUser.role, cloudUser.password_hash, 1, cloudUser.created_at]
             );
             // Re-fetch to get the local object format
             user = await db.getFirstAsync<User>('SELECT * FROM users WHERE id = ?', [cloudUser.id]);
          }
        } catch (e) {
          console.warn('Cloud Handshake failed:', e);
        }
      }

      if (!user) {
        set({ error: 'loginError', isLoading: false });
        return false;
      }

      // --- HYBRID AUTH: Check Supabase for updated Role & Levels ---
      try {
        const { supabase } = await import('../lib/supabase');
        // Fetch fresh profile from cloud
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        
        // Fetch assigned levels
        const { data: levels } = await supabase
          .from('teacher_levels')
          .select('level_id')
          .eq('teacher_id', user.id);

        if (profile) user.role = profile.role;
        if (levels) user.assignedLevels = levels.map(l => l.level_id);
      } catch (e) {
        console.warn('Cloud profile fetch failed, using local data', e);
      }

      // 🛡️ LOCAL FALLBACK & ENRICHMENT
      // Fetch linked subjects from local DB
      const subRows = await db.getAllAsync<{subject_id: string}>(
        'SELECT subject_id FROM teacher_subjects WHERE teacher_id = ?',
        [user.id]
      );
      user.assignedSubjects = subRows.map(r => r.subject_id);

      // Fetch linked levels from local DB (if cloud fetch was empty/failed)
      if (!user.assignedLevels || user.assignedLevels.length === 0) {
        const lvlRows = await db.getAllAsync<{level_id: string}>(
          'SELECT level_id FROM teacher_levels WHERE teacher_id = ?',
          [user.id]
        );
        user.assignedLevels = lvlRows.map(r => r.level_id);
      }

      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(user));

      // 🔄 INITIAL INSTITUTIONAL PULSE (Ensure new phones aren't empty)
      try {
        const { syncAll } = await import('../lib/sync');
        await syncAll(true); // 🚀 INSTANT LOGIN HANDSHAKE
      } catch (e) {
        console.warn('Initial sync failed, will retry in background', e);
      }

      set({ user, isLoading: false, error: null });
      return true;
    } catch (e) {
      set({ error: 'error', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
    set({ user: null, error: null });
  },

  addUser: async (username, name, phone, password, role) => {
    try {
      const { queueSync, getDatabase } = await import('../lib/database');
      const { triggerBackgroundSync } = await import('../lib/sync');
      const db = await getDatabase();
      const id = Crypto.randomUUID();
      const hashed = await hashPassword(password);
      await db.runAsync(
        `INSERT INTO users (id, username, name, phone, role, password_hash, is_active)
         VALUES (?,?,?,?,?,?,1)`,
        [id, username.trim(), name, phone.trim(), role, hashed]
      );
      await queueSync('users', id, 'insert');
      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
      return true;
    } catch {
      return false;
    }
  },
  
  getUstazs: async () => {
    const db = await getDatabase();
    return db.getAllAsync<User>('SELECT * FROM users WHERE role IN ("ustaz", "finance", "committee") AND is_active = 1');
  },

  clearError: () => set({ error: null }),
}));
