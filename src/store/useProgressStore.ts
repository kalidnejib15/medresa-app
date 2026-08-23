import { create } from 'zustand';
import { getDatabase, queueSync } from '../lib/database';
import * as Crypto from 'expo-crypto';
import { triggerBackgroundSync } from '../lib/sync';

export interface ProgressRecord {
  id: string;
  student_id: string;
  ustaz_id: string;
  date: string;
  page_number: string;   // e.g. "Page 12" or "الفاتحة"
  ayah_from: string;     // starting ayah/line
  ayah_to: string;       // ending ayah/line
  lesson_details: string; // extra/additional notes
  rating: number;         // 1–5 stars (also doubles as the Kitab "bonus mark")
  ustaz_notes: string;
  level_id: string;
  session_type?: 'quran' | 'kitab'; // defaults to 'quran' for backward compatibility
}

interface ProgressState {
  saveProgress: (record: Omit<ProgressRecord, 'id'>) => Promise<boolean>;
  getDailyProgress: (date: string, level_id?: string, ustaz_id?: string, sessionType?: 'quran' | 'kitab') => Promise<ProgressRecord[]>;
  getLastProgress: (studentId: string, beforeDate: string, sessionType?: 'quran' | 'kitab') => Promise<{ page_number: string; ayah_from: string; ayah_to: string; date: string } | null>;
}

export const useProgressStore = create<ProgressState>(() => ({
  saveProgress: async (record) => {
    try {
      const db = await getDatabase();
      const sessionType = record.session_type || 'quran';

      // 🛡️ ATOMIC WRITE: the existing-record lookup and the upsert now run inside a
      // single transaction (same pattern as markAttendance's batch write). Previously
      // these were two separate statements — a save from the Teams tab (or a second
      // save firing from a background refresh) could read the "no existing record" state,
      // then have another save slip in between the SELECT and the INSERT, causing a
      // duplicate row or a lost update. Wrapping them together makes each save all-or-nothing.
      let id = '';
      let action: 'insert' | 'update' = 'insert';

      await db.withTransactionAsync(async () => {
        // 🛡️ OWNERSHIP LOCK: Separate records by Ustaz, and by session_type so a Kitab
        // bonus-mark entry never collides with (or overwrites) that same student's
        // Quran/qirat entry for the same day.
        const existing = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM student_progress WHERE student_id = ? AND date = ? AND level_id = ? AND ustaz_id = ? AND session_type = ?',
          [record.student_id, record.date, record.level_id, record.ustaz_id, sessionType]
        );

        id = existing?.id ?? Crypto.randomUUID();
        action = existing ? 'update' : 'insert';

        // UPSERT — update if exists, insert if not
        await db.runAsync(
          `INSERT INTO student_progress
             (id, student_id, ustaz_id, date, page_number, ayah_from, ayah_to, lesson_details, rating, ustaz_notes, level_id, session_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             ustaz_id       = excluded.ustaz_id,
             page_number    = excluded.page_number,
             ayah_from      = excluded.ayah_from,
             ayah_to        = excluded.ayah_to,
             lesson_details = excluded.lesson_details,
             rating         = excluded.rating,
             ustaz_notes    = excluded.ustaz_notes,
             session_type   = excluded.session_type`,
          [
            id,
            record.student_id,
            record.ustaz_id,
            record.date,
            record.page_number  ?? '',
            record.ayah_from    ?? '',
            record.ayah_to      ?? '',
            record.lesson_details ?? '',
            record.rating,
            record.ustaz_notes  ?? '',
            record.level_id,
            sessionType,
          ]
        );
      });

      // Queue for cloud sync
      await queueSync('student_progress', id, action);

      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
      return true;
    } catch (e) {
      console.error('Error saving progress:', e);
      return false;
    }
  },

  getDailyProgress: async (date, level_id, ustaz_id, sessionType) => {
    try {
      const db = await getDatabase();
      const user = (await import('./useAuthStore')).useAuthStore.getState().user;
      if (!user) return [];

      // 🛡️ MONITORING OVERRIDE: Admins can view ANY teacher's progress
      const targetUstazId = ustaz_id || user.id;

      let query = 'SELECT * FROM student_progress WHERE date = ? AND ustaz_id = ?';
      let params: any[] = [date, targetUstazId];

      if (level_id) {
        query += ' AND level_id = ?';
        params.push(level_id);
      }

      // 🛡️ Scoped to the active session (Quran/qirat vs Kitab bonus marks) so the two
      // never overwrite each other when mapped by student_id in the caller.
      if (sessionType) {
        query += ' AND session_type = ?';
        params.push(sessionType);
      }

      return db.getAllAsync<ProgressRecord>(query, params);
    } catch (e) {
      console.error('Error fetching progress:', e);
      return [];
    }
  },

  getLastProgress: async (studentId, beforeDate, sessionType) => {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<any>(
        `SELECT page_number, ayah_from, ayah_to, date FROM student_progress
         WHERE student_id = ? AND date < ? AND session_type = ?
         ORDER BY date DESC LIMIT 1`,
        [studentId, beforeDate, sessionType || 'quran']
      );
      return row || null;
    } catch (e) {
      console.error('Error fetching last progress:', e);
      return null;
    }
  },
}));
