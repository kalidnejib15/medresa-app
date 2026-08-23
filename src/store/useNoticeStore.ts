import { create } from 'zustand';
import { getDatabase } from '../lib/database';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  sender: string;
  created_at: string;
  is_read: number;
}

interface NoticeState {
  notices: Announcement[];
  unreadCount: number;
  fetchNotices: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  addNotice: (notice: Omit<Announcement, 'is_read'>) => Promise<void>;
}

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],
  unreadCount: 0,

  fetchNotices: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<Announcement>('SELECT * FROM announcements ORDER BY created_at DESC');
    const unread = rows.filter(n => !n.is_read).length;
    set({ notices: rows, unreadCount: unread });
  },

  markAsRead: async (id: string) => {
    const db = await getDatabase();
    await db.runAsync('UPDATE announcements SET is_read = 1 WHERE id = ?', [id]);
    get().fetchNotices();
  },

  addNotice: async (notice) => {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR IGNORE INTO announcements (id, title, message, sender, created_at, is_read) VALUES (?, ?, ?, ?, ?, 0)',
      [notice.id, notice.title, notice.message, notice.sender, notice.created_at]
    );
    get().fetchNotices();
  }
}));
