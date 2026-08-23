import { create } from 'zustand';
import { getDatabase } from '../lib/database';
import { getLocalDateString } from '../lib/dateUtils';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

interface ReportState {
  generateCSVReport: (levelId?: string) => Promise<void>;
  getStudentHistorySummary: (studentId: string) => Promise<any>;
  getFullStudentReport: (studentId: string) => Promise<any>;
  getMonthlyStudentReport: (studentId: string) => Promise<any>;
  exportStudentReport: (studentId: string) => Promise<void>;
  getDefaultersReport: () => Promise<any[]>;
  getDailyJournal: (date: string) => Promise<any[]>;
}

export const useReportStore = create<ReportState>(() => ({
  getStudentHistorySummary: async (studentId: string) => {
    const db = await getDatabase();
    const attendance = await db.getAllAsync(`SELECT date, status FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 5`, [studentId]);
    const progress = await db.getAllAsync(`SELECT date, page_number, rating FROM student_progress WHERE student_id = ? AND session_type = 'quran' ORDER BY date DESC LIMIT 5`, [studentId]);
    // 🆕 Kitab bonus-mark entries (session_type = 'kitab') live in the same table but
    // represent a different thing (a note + bonus mark, no page/ayah), so they're kept
    // in their own list instead of being mixed into `progress` above.
    const kitabNotes = await db.getAllAsync(`SELECT date, lesson_details, rating FROM student_progress WHERE student_id = ? AND session_type = 'kitab' ORDER BY date DESC LIMIT 5`, [studentId]);
    return { attendance, progress, kitabNotes };
  },

  getFullStudentReport: async (studentId: string) => {
    const db = await getDatabase();

    // 1. Attendance
    const attendance = await db.getAllAsync(`
      SELECT date, status FROM attendance 
      WHERE student_id = ? ORDER BY date DESC LIMIT 20
    `, [studentId]);

    // 2. Qirat Progress (Quran session only — Kitab bonus notes are separate, see below)
    const progress = await db.getAllAsync(`
      SELECT date, page_number, ayah_from, ayah_to, lesson_details, rating 
      FROM student_progress 
      WHERE student_id = ? AND session_type = 'quran' ORDER BY date DESC LIMIT 20
    `, [studentId]);

    // 2b. Kitab Bonus Notes — same table, session_type = 'kitab': a note + bonus mark
    // entered during the afternoon Kitab session, kept separate from Qirat progress.
    const kitabNotes = await db.getAllAsync(`
      SELECT date, lesson_details, rating 
      FROM student_progress 
      WHERE student_id = ? AND session_type = 'kitab' ORDER BY date DESC LIMIT 20
    `, [studentId]);

    // 3. Grades (Updated for Weighted Schema)
    const grades = await db.getAllAsync(`
      SELECT g.*, w.name as weight_name, s.name as subject_name 
      FROM student_grades g 
      JOIN grade_weights w ON g.weight_id = w.id
      JOIN subjects s ON w.subject_id = s.id
      WHERE g.student_id = ? ORDER BY g.date DESC
    `, [studentId]);

    // 4. Fees
    const fees = await db.getAllAsync(`
      SELECT * FROM fees WHERE student_id = ?
    `, [studentId]);

    // 5. Recent Payments
    const payments = await db.getAllAsync(`
      SELECT p.*, f.amount_due FROM payments p 
      JOIN fees f ON p.fee_id = f.id 
      WHERE f.student_id = ? ORDER BY p.paid_date DESC
    `, [studentId]);

    return { attendance, progress, grades, fees, payments, kitabNotes };
  },

  // 🆕 Same shape as getFullStudentReport but scoped to the trailing 30 days, for the
  // new "Month" PDF button next to the existing weekly one.
  getMonthlyStudentReport: async (studentId: string) => {
    const db = await getDatabase();
    const attendance = await db.getAllAsync(`
      SELECT date, status FROM attendance
      WHERE student_id = ? AND date >= date('now', '-30 days') ORDER BY date DESC
    `, [studentId]);
    const progress = await db.getAllAsync(`
      SELECT date, page_number, ayah_from, ayah_to, lesson_details, rating
      FROM student_progress
      WHERE student_id = ? AND session_type = 'quran' AND date >= date('now', '-30 days') ORDER BY date DESC
    `, [studentId]);
    const kitabNotes = await db.getAllAsync(`
      SELECT date, lesson_details, rating
      FROM student_progress
      WHERE student_id = ? AND session_type = 'kitab' AND date >= date('now', '-30 days') ORDER BY date DESC
    `, [studentId]);
    const grades = await db.getAllAsync(`
      SELECT g.*, w.name as weight_name, s.name as subject_name
      FROM student_grades g
      JOIN grade_weights w ON g.weight_id = w.id
      JOIN subjects s ON w.subject_id = s.id
      WHERE g.student_id = ? AND g.date >= date('now', '-30 days') ORDER BY g.date DESC
    `, [studentId]);
    return { attendance, progress, grades, kitabNotes };
  },

  exportStudentReport: async (studentId: string) => {
    const db = await getDatabase();
    const student = await db.getFirstAsync<any>('SELECT name_en FROM students WHERE id = ?', [studentId]);
    if (!student) return;

    const data = await (useReportStore.getState() as any).getFullStudentReport(studentId);

    let csv = `Report for: ${student.name_en}\n\n`;

    csv += '--- ATTENDANCE ---\nDate,Status\n';
    data.attendance.forEach((a: any) => csv += `${a.date},${a.status}\n`);

    csv += '\n--- QIRAT PROGRESS ---\nDate,Page,AyahFrom,AyahTo,Lesson\n';
    data.progress.forEach((p: any) => csv += `${p.date},${p.page_number},${p.ayah_from},${p.ayah_to},"${p.lesson_details}"\n`);

    csv += '\n--- GRADES (WEIGHTED) ---\nSubject,Component,Score,Date\n';
    data.grades.forEach((g: any) => csv += `${g.subject_name},${g.weight_name},${g.score},${g.date}\n`);

    csv += '\n--- PAYMENTS ---\nDate,Amount\n';
    data.payments.forEach((py: any) => csv += `${py.paid_date},${py.amount}\n`);

    const filename = `Report_${student.name_en.replace(/\s/g, '_')}.csv`;
    const filepath = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(filepath, csv, { encoding: 'utf8' });
    await Sharing.shareAsync(filepath);
  },

  generateCSVReport: async (levelId?: string) => {
    const db = await getDatabase();

    let query = `
      SELECT s.name_en, s.name_am, l.name as level, a.date, a.status, 
             p.page_number, p.ayah_from, p.ayah_to, p.lesson_details, p.rating
      FROM students s
      JOIN levels l ON s.level_id = l.id
      LEFT JOIN attendance a ON s.id = a.student_id
      LEFT JOIN student_progress p ON (s.id = p.student_id AND a.date = p.date)
      WHERE s.is_active = 1
    `;
    const params: any[] = [];

    if (levelId) {
      query += ` AND s.level_id = ?`;
      params.push(levelId);
    }

    query += ` ORDER BY a.date DESC, s.name_en ASC`;

    const rows = await db.getAllAsync<any>(query, params);

    if (rows.length === 0) return;

    // Build CSV Content
    let csv = 'Name,Name(Am),Level,Date,Attendance,Page,AyahFrom,AyahTo,Lesson,Rating\n';
    rows.forEach(r => {
      csv += `${r.name_en},${r.name_am},${r.level},${r.date},${r.status},${r.page_number || ''},${r.ayah_from || ''},${r.ayah_to || ''},"${r.lesson_details || ''}",${r.rating || ''}\n`;
    });

    const filename = `Medresa_Report_${getLocalDateString()}.csv`;
    const filepath = `${FileSystem.documentDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(filepath, csv, { encoding: 'utf8' });
    await Sharing.shareAsync(filepath);
  },
  getDefaultersReport: async () => {
    try {
      const { getDatabase } = require('../lib/database');
      const db = await getDatabase();
      return db.getAllAsync(`
        SELECT 
          s.name_am, 
          s.name_en, 
          sp.parent_name, 
          sp.parent_phone, 
          sp.emergency_contact,
          f.amount_due, 
          f.amount_paid, 
          (f.amount_due - f.amount_paid) as balance,
          l.name as level_name,
          f.due_date
        FROM fees f
        JOIN students s ON f.student_id = s.id
        LEFT JOIN student_private sp ON s.id = sp.student_id
        LEFT JOIN levels l ON s.level_id = l.id
        WHERE f.status != 'paid' AND f.amount_due > f.amount_paid AND s.is_active = 1
        ORDER BY l.id ASC, s.name_am ASC
      `);
    } catch (e) {
      console.error('Error fetching defaulters:', e);
      return [];
    }
  },
  getDailyJournal: async (date: string) => {
    try {
      const { getDatabase } = require('../lib/database');
      const db = await getDatabase();
      return db.getAllAsync(`
        SELECT 
          s.name_am, s.name_en, 
          a.status, a.notes as att_notes,
          p.page_number, p.ayah_from, p.ayah_to, p.ustaz_notes, p.rating,
          l.name as level_name,
          u.name as ustaz_name
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
        LEFT JOIN student_progress p ON s.id = p.student_id AND p.date = ?
        LEFT JOIN levels l ON s.level_id = l.id
        LEFT JOIN users u ON (a.marked_by = u.id OR p.ustaz_id = u.id)
        WHERE a.id IS NOT NULL OR p.id IS NOT NULL
        ORDER BY a.created_at DESC
      `, [date, date]);
    } catch (e) {
      console.error('Error fetching journal:', e);
      return [];
    }
  }
}));