import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';

export type NuraniyahRating = 'excellent' | 'good' | 'needs_work';

export interface NuraniyahAssessment {
  id: string;
  student_id: string;
  date: string;
  category: string; // 'Qirat', 'Azkar', 'Behaviour'
  rating: NuraniyahRating;
  ustaz_id: string;
  notes?: string;
}

const CATEGORIES = ['Qirat', 'Azkar', 'Behaviour'];

const RATING_CONFIG: Record<NuraniyahRating, { label_am: string; label_en: string; emoji: string; color: string; bg: string }> = {
  excellent:   { label_am: 'በጣም ጥሩ',  label_en: 'Excellent',   emoji: '🌟', color: '#059669', bg: '#f0fdf4' },
  good:        { label_am: 'ጥሩ',       label_en: 'Good',        emoji: '✅', color: '#2563eb', bg: '#eff6ff' },
  needs_work:  { label_am: 'ልምምድ ያስፈልጋል', label_en: 'Needs Work', emoji: '📖', color: '#d97706', bg: '#fffbeb' },
};

interface NuraniyahState {
  categories: string[];
  ratingConfig: typeof RATING_CONFIG;
  getAssessments: (studentId: string, date: string) => Promise<NuraniyahAssessment[]>;
  saveAssessment: (studentId: string, date: string, category: string, rating: NuraniyahRating, ustazId: string, notes?: string) => Promise<void>;
  getDailyClassAssessments: (date: string, levelId?: string) => Promise<any[]>;
  deleteAssessment: (studentId: string, date: string, category: string, actingUserId: string) => Promise<void>;
  getStudentNuraniyahSummary: (studentId: string, fromDate?: string) => Promise<{
    percentage: number;
    totalEntries: number;
    excellentCount: number;
    goodCount: number;
    needsWorkCount: number;
    weakCategories: string[];
  }>;
}

// 🛡️ OWNERSHIP/ROLE GUARD: mirrors the pattern used across the app (attendance.tsx
// validLevelIds, useStudentStore adminWhere, nuraniyah-daily.tsx roster query) — an
// admin can act on any student; an ustaz only on a student actually linked to them via
// teacher_student_links. Throws a descriptive error if the actor isn't authorized, so
// callers can surface it (e.g. an Alert) instead of silently writing/deleting data for
// a student the acting user doesn't own.
async function assertCanActOnStudent(actingUserId: string, studentId: string) {
  const db = await getDatabase();
  const actor = await db.getFirstAsync<{ role: string }>(
    'SELECT role FROM users WHERE id = ?',
    [actingUserId]
  );
  if (!actor) throw new Error('Acting user not found.');
  if (actor.role === 'admin') return;

  // 🛡️ FIX: Nuraniyah/Qirat assignment is level-based (an ustaz is assigned to a level
  // via teacher_levels, then teaches every student in it) — it was never recorded in
  // teacher_student_links, which is the per-subject link table used only for Kitab
  // grading. Checking only that table meant any ustaz properly assigned to a student's
  // *level* but never explicitly linked for a Kitab subject always failed this check.
  const levelMatch = await db.getFirstAsync<{ level_id: string }>(
    `SELECT tl.level_id FROM teacher_levels tl
     JOIN students s ON s.level_id = tl.level_id
     WHERE tl.teacher_id = ? AND s.id = ? LIMIT 1`,
    [actingUserId, studentId]
  );
  if (levelMatch) return;

  const link = await db.getFirstAsync<{ teacher_id: string }>(
    'SELECT teacher_id FROM teacher_student_links WHERE teacher_id = ? AND student_id = ? LIMIT 1',
    [actingUserId, studentId]
  );
  if (!link) {
    throw new Error('You are not assigned to this student, so you cannot record or change their Nuraniyah rating.');
  }
}

export const useNuraniyahStore = create<NuraniyahState>(() => ({
  categories: CATEGORIES,
  ratingConfig: RATING_CONFIG,

  getAssessments: async (studentId, date) => {
    const db = await getDatabase();
    return db.getAllAsync<NuraniyahAssessment>(
      'SELECT * FROM nuraniyah_assessments WHERE student_id = ? AND date = ? ORDER BY category ASC',
      [studentId, date]
    );
  },

  saveAssessment: async (studentId, date, category, rating, ustazId, notes = '') => {
    await assertCanActOnStudent(ustazId, studentId);

    const db = await getDatabase();
    const id = `nur_${studentId}_${date}_${category}`;
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM nuraniyah_assessments WHERE id = ?',
      [id]
    );
    const action = existing ? 'update' : 'insert';

    await db.runAsync(
      `INSERT OR REPLACE INTO nuraniyah_assessments (id, student_id, date, category, rating, ustaz_id, notes)
       VALUES (?,?,?,?,?,?,?)`,
      [id, studentId, date, category, rating, ustazId, notes]
    );
    await queueSync('nuraniyah_assessments', id, action);

    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  },

  // 🗑️ Clears a mistaken entry entirely (rather than just cycling to another rating).
  // Same ownership guard as saveAssessment. No-ops quietly if nothing exists for that
  // student/date/category, since "delete something that isn't there" isn't an error.
  deleteAssessment: async (studentId, date, category, actingUserId) => {
    await assertCanActOnStudent(actingUserId, studentId);

    const db = await getDatabase();
    const id = `nur_${studentId}_${date}_${category}`;
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM nuraniyah_assessments WHERE id = ?',
      [id]
    );
    if (!existing) return;

    await db.runAsync('DELETE FROM nuraniyah_assessments WHERE id = ?', [id]);
    await queueSync('nuraniyah_assessments', id, 'delete');

    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  getDailyClassAssessments: async (date, levelId) => {
    const db = await getDatabase();
    let query = `
      SELECT na.*, s.name_am, s.name_en, s.level_id
      FROM nuraniyah_assessments na
      JOIN students s ON na.student_id = s.id
      WHERE na.date = ? AND s.is_active = 1
    `;
    const params: any[] = [date];
    if (levelId) {
      query += ' AND s.level_id = ?';
      params.push(levelId);
    }
    return db.getAllAsync(query, params);
  },

  // 🛡️ Mirrors useAttendanceStore.getStudentAttendanceSummary. Optional fromDate
  // (YYYY-MM-DD) restricts the window, e.g. pass a date 30 days ago for "last month".
  // Omit it for an all-time summary.
  getStudentNuraniyahSummary: async (studentId, fromDate) => {
    const db = await getDatabase();
    let query = `
      SELECT category, rating, COUNT(*) as count
      FROM nuraniyah_assessments
      WHERE student_id = ?
    `;
    const params: any[] = [studentId];
    if (fromDate) {
      query += ' AND date >= ?';
      params.push(fromDate);
    }
    query += ' GROUP BY category, rating';

    const rows = await db.getAllAsync<{ category: string; rating: NuraniyahRating; count: number }>(query, params);

    let totalEntries = 0;
    let excellentCount = 0;
    let goodCount = 0;
    let needsWorkCount = 0;
    const byCategory: Record<string, { excellent: number; good: number; needs_work: number }> = {};

    rows.forEach(r => {
      totalEntries += r.count;
      if (r.rating === 'excellent') excellentCount += r.count;
      if (r.rating === 'good') goodCount += r.count;
      if (r.rating === 'needs_work') needsWorkCount += r.count;

      if (!byCategory[r.category]) byCategory[r.category] = { excellent: 0, good: 0, needs_work: 0 };
      byCategory[r.category][r.rating] += r.count;
    });

    const percentage = totalEntries > 0
      ? Math.round(((excellentCount + goodCount) / totalEntries) * 100)
      : 0;

    // A category counts as "weak" if needs_work is its most (or equally) common rating.
    const weakCategories = Object.entries(byCategory)
      .filter(([, c]) => c.needs_work > 0 && c.needs_work >= c.excellent && c.needs_work >= c.good)
      .map(([category]) => category);

    return { percentage, totalEntries, excellentCount, goodCount, needsWorkCount, weakCategories };
  },
}));
