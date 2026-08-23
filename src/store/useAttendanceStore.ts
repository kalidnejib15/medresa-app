import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { getLocalDateString } from '../lib/dateUtils';
import { Attendance, AttendanceStatus } from '../types';

interface TodayStats {
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

interface AttendanceState {
  attendance: Attendance[];
  todayStats: TodayStats;
  isLoading: boolean;
  fetchAttendance: (date: string, timeBlockId: string, targetUstazId?: string) => Promise<void>;
  markAttendance: (
    records: { studentId: string; status: AttendanceStatus; notes?: string }[],
    date: string,
    timeBlockId: string,
    markedBy: string,
    targetUstazId?: string
  ) => Promise<void>;
  clearAttendance: (studentId: string, date: string, timeBlockId: string, markedBy: string, targetUstazId?: string) => Promise<void>;
  fetchTodayStats: (levelId?: string) => Promise<void>;
  getStudentHistory: (studentId: string, limit?: number) => Promise<Attendance[]>;
  getClassAttendanceForDate: (levelId: string, date: string, timeBlockId: string) => Promise<Attendance[]>;
  getDailyAttendance: (date: string, timeBlock: string, ustazId?: string) => Promise<any[]>;
  getStudentAttendanceSummary: (studentId: string) => Promise<{ percentage: number; totalDays: number; presentDays: number }>;
}

const emptyStats: TodayStats = { present: 0, absent: 0, late: 0, excused: 0, total: 0, rate: 0 };

export const useAttendanceStore = create<AttendanceState>((set) => ({
  attendance: [],
  todayStats: emptyStats,
  isLoading: false,

  fetchAttendance: async (date, timeBlockId, targetUstazId) => {
    set({ isLoading: true });
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (!user) return set({ isLoading: false });

    // 🛡️ MONITORING OVERRIDE: Admins can view ANY teacher's attendance
    const actingUstazId = targetUstazId || user.id;

    const db = await getDatabase();
    const rows = await db.getAllAsync<Attendance>(
      `SELECT a.*, s.name_am, s.name_en, s.photo_url, s.level_id
       FROM attendance a JOIN students s ON a.student_id = s.id
       WHERE a.date = ? AND a.time_block_id = ? AND a.marked_by = ?
       ORDER BY s.name_am ASC`,
      [date, timeBlockId, actingUstazId]
    );
    set({ attendance: rows, isLoading: false });
    return rows;
  },

  markAttendance: async (records, date, timeBlockId, markedBy, targetUstazId) => {
    const db = await getDatabase();
    const actingUstazId = targetUstazId || markedBy;
    // 🛡️ ATOMIC WRITE: all records in this batch succeed together or none do.
    // Without this, marking a whole team (2-5 students) at once from the Teams
    // tab could fail halfway through and leave the team's attendance half
    // written — some students marked, some not — which then shows up as an
    // inconsistent/confusing state back on the main Attendance tab.
    await db.withTransactionAsync(async () => {
      for (const r of records) {
        // 🛡️ OWNERSHIP CONFLICT CHECK: Only find records belonging to THIS teacher
        const existing = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM attendance WHERE student_id = ? AND date = ? AND time_block_id = ? AND marked_by = ?',
          [r.studentId, date, timeBlockId, actingUstazId]
        );

        const id = existing?.id ?? Crypto.randomUUID();
        const action = existing ? 'update' : 'insert';

        await db.runAsync(
          `INSERT OR REPLACE INTO attendance
           (id, student_id, date, time_block_id, status, marked_by, notes, synced)
           VALUES (?,?,?,?,?,?,?,0)`,
          [id, r.studentId, date, timeBlockId, r.status, actingUstazId, r.notes ?? null]
        );
        await queueSync('attendance', id, action);
      }
    });

    // START SYNC IMMEDIATELY
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  },

  // 🛡️ UN-MARK FIX: toggling a status off (tapping the same color again) must delete
  // the row, not just clear it on screen. Without this, the database still holds the
  // old status, so the next reload (tab switch, focus refetch) brings it right back —
  // which looked like the app "forgetting" or "reverting" a mark.
  clearAttendance: async (studentId, date, timeBlockId, markedBy, targetUstazId) => {
    const db = await getDatabase();
    const actingUstazId = targetUstazId || markedBy;
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM attendance WHERE student_id = ? AND date = ? AND time_block_id = ? AND marked_by = ?',
      [studentId, date, timeBlockId, actingUstazId]
    );
    if (!existing) return; // nothing saved yet, nothing to clear

    await db.runAsync('DELETE FROM attendance WHERE id = ?', [existing.id]);
    await queueSync('attendance', existing.id, 'delete');

    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  fetchTodayStats: async (levelId?: string) => {
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    const today = getLocalDateString();
    
    // 🛡️ STATS OWNERSHIP: Ustazs see their own progress, Admins see the whole school
    let query = `SELECT status, COUNT(*) as count FROM attendance WHERE date = ?`;
    const params: any[] = [today];
    
    if (user?.role === 'ustaz') {
      query += ` AND marked_by = ?`;
      params.push(user.id);
    }
    
    if (levelId) {
      query += ` AND student_id IN (SELECT id FROM students WHERE level_id = ?)`;
      params.push(levelId);
    }
    query += ' GROUP BY status';

    const rows = await db.getAllAsync<{ status: string; count: number }>(query, params);
    const stats = { ...emptyStats };
    rows.forEach(r => {
      (stats as any)[r.status] = r.count;
      stats.total += r.count;
    });
    stats.rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
    set({ todayStats: stats });
  },

  getStudentHistory: async (studentId, limit = 30) => {
    const db = await getDatabase();
    return db.getAllAsync<Attendance>(
      'SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT ?',
      [studentId, limit]
    );
  },

  getClassAttendanceForDate: async (levelId, date, timeBlockId) => {
    const db = await getDatabase();
    return db.getAllAsync<Attendance>(
      `SELECT a.*, s.name_am, s.name_en
       FROM attendance a JOIN students s ON a.student_id = s.id
       WHERE s.level_id = ? AND a.date = ? AND a.time_block_id = ?
       ORDER BY s.name_am ASC`,
      [levelId, date, timeBlockId]
    );
  },

  getDailyAttendance: async (date: string, timeBlock: string, ustazId?: string) => {
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (!user) return [];

    // 🛡️ ADMIN MODE: Flexible filtering
    if (user.role === 'admin' || user.role === 'finance') {
      if (ustazId) {
        return db.getAllAsync<any>(
          'SELECT * FROM attendance WHERE date = ? AND time_block_id = ? AND marked_by = ?',
          [date, timeBlock, ustazId]
        );
      }
      // Global Consolidated View: Show the latest mark for each student
      return db.getAllAsync<any>(
        `SELECT * FROM attendance 
         WHERE date = ? AND time_block_id = ? 
         ORDER BY updated_at ASC`,
        [date, timeBlock]
      );
    }

    // 🛡️ USTAZ MODE: Strictly locked to own records
    return db.getAllAsync<any>(
      'SELECT * FROM attendance WHERE date = ? AND time_block_id = ? AND marked_by = ?',
      [date, timeBlock, user.id]
    );
  },

  getStudentAttendanceSummary: async (studentId: string) => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ status: string; count: number }>(
      'SELECT status, COUNT(*) as count FROM attendance WHERE student_id = ? GROUP BY status',
      [studentId]
    );

    let totalDays = 0;
    let presentDays = 0;

    rows.forEach(r => {
      totalDays += r.count;
      if (r.status === 'present') presentDays += r.count;
      if (r.status === 'late') presentDays += r.count; // Late counts as present for percentage usually
    });

    const percentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
    return { percentage, totalDays, presentDays };
  },
}));
