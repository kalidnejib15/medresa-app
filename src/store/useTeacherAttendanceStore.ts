import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { triggerBackgroundSync } from '../lib/sync';
import { getLocalDateString } from '../lib/dateUtils';

export type TeacherAttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface TeacherAttendance {
  id: string;
  teacher_id: string;
  date: string;
  status: TeacherAttendanceStatus;
  arrival_time?: string;
  marked_by: string;
  notes?: string;
}

interface TeacherAttendanceState {
  records: TeacherAttendance[];
  isLoading: boolean;
  fetchDailyAttendance: (date: string) => Promise<void>;
  markTeacherAttendance: (
    teacherId: string,
    status: TeacherAttendanceStatus,
    markedBy: string,
    arrivalTime?: string,
    notes?: string,
    date?: string
  ) => Promise<void>;
}

export const useTeacherAttendanceStore = create<TeacherAttendanceState>((set) => ({
  records: [],
  isLoading: false,

  fetchDailyAttendance: async (date) => {
    set({ isLoading: true });
    const db = await getDatabase();
    const rows = await db.getAllAsync<TeacherAttendance>(
      `SELECT ta.*, u.name as teacher_name 
       FROM teacher_attendance ta 
       JOIN users u ON ta.teacher_id = u.id 
       WHERE ta.date = ?`,
      [date]
    );
    set({ records: rows, isLoading: false });
  },

  markTeacherAttendance: async (teacherId, status, markedBy, arrivalTime, notes, date) => {
    const db = await getDatabase();
    // 🛡️ FIX: previously always hardcoded getLocalDateString() (today), so marking
    // attendance for a past/future date selected in the admin date picker silently
    // saved (or overwrote) TODAY's record instead. Now uses the caller's date,
    // falling back to today only when none is supplied.
    const targetDate = date || getLocalDateString();

    // Check if exists
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM teacher_attendance WHERE teacher_id = ? AND date = ?',
      [teacherId, targetDate]
    );

    const id = existing?.id ?? Crypto.randomUUID();
    const action = existing ? 'update' : 'insert';

    await db.runAsync(
      `INSERT OR REPLACE INTO teacher_attendance 
       (id, teacher_id, date, status, arrival_time, marked_by, notes) 
       VALUES (?,?,?,?,?,?,?)`,
      [id, teacherId, targetDate, status, arrivalTime || null, markedBy, notes || null]
    );

    await queueSync('teacher_attendance', id, action);
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  }
}));