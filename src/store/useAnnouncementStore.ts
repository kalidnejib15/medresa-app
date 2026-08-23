import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { triggerBackgroundSync } from '../lib/sync';
import { useNoticeStore } from './useNoticeStore';

export interface Announcement {
  type: string;
  id: string;
  title: string;
  message: string;
  sender: string;
  created_at: string;
}

interface AnnouncementState {
  announcements: Announcement[];
  isLoading: boolean;
  fetchAnnouncements: () => Promise<void>;
  addAnnouncement: (title: string, message: string, type: string, userId: string) => Promise<boolean>;
}

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  announcements: [],
  isLoading: false,

  fetchAnnouncements: async () => {
    set({ isLoading: true });
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<Announcement>(
        'SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5'
      );
      set({ announcements: rows, isLoading: false });
    } catch (e) {
      console.warn('Fetch announcements failed:', e);
      set({ announcements: [], isLoading: false });
    }
  },

  addAnnouncement: async (title, message, type, userId) => {
    try {
      const db = await getDatabase();
      const id = Crypto.randomUUID();
      const now = new Date().toISOString();
      const senderName = (await import('./useAuthStore')).useAuthStore.getState().user?.name || 'Admin';

      // Try clean insert first, fall back to legacy-compatible insert if NOT NULL constraint exists
      try {
        await db.runAsync(
          'INSERT INTO announcements (id, title, message, sender, type, created_at, is_read, is_notified, synced) VALUES (?,?,?,?,?,?,1,1,0)',
          [id, title, message, senderName, type || 'general', now]
        );
      } catch (insertErr: any) {
        if (insertErr?.message?.includes('NOT NULL')) {
          // Legacy table still has NOT NULL on content/created_by — fill both
          await db.runAsync(
            'INSERT INTO announcements (id, title, content, message, created_by, sender, type, created_at, is_read, is_notified, synced) VALUES (?,?,?,?,?,?,?,?,1,1,0)',
            [id, title, message, message, senderName, senderName, type || 'general', now]
          );
        } else {
          throw insertErr;
        }
      }

      await queueSync('announcements', id, 'insert');
      await get().fetchAnnouncements();
      await useNoticeStore.getState().fetchNotices();

      triggerBackgroundSync(true);
      return true;
    } catch (e) {
      console.warn('Add announcement failed:', e);
      return false;
    }
  }
}));
