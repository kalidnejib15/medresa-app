import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';

export interface Subject {
  id: string;
  name: string;
  name_am: string;
}

export interface GradeWeight {
  id: string;
  subject_id: string;
  name: string;
  weight: number;
  level_id?: string;
  subject_name?: string;
  subject_name_am?: string;
}

export interface Grade {
  id: string;
  student_id: string;
  weight_id: string;
  score: number;
  date: string;
  ustaz_id: string;
}

interface GradeState {
  subjects: Subject[];
  weights: GradeWeight[];
  isLoading: boolean;
  fetchSubjects: () => Promise<void>;
  fetchWeights: (subjectId?: string, studentId?: string, ustazId?: string) => Promise<void>;
  addGrade: (grade: Omit<Grade, 'id'>) => Promise<void>;
  getStudentGrades: (studentId: string, ustazId?: string) => Promise<any[]>;
  getRankings: (levelId: string) => Promise<any[]>;
}

export const useGradeStore = create<GradeState>((set, get) => ({
  subjects: [],
  weights: [],
  isLoading: false,

  fetchSubjects: async () => {
    set({ isLoading: true });
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;

    let rows: Subject[] = [];
    if (user?.role === 'admin') {
      rows = await db.getAllAsync<Subject>('SELECT * FROM subjects');
    } else {
      // 🛡️ Enhanced Subject Discovery: Master list assignments + Individual student links
      rows = await db.getAllAsync<Subject>(
        `SELECT DISTINCT s.* FROM subjects s 
         LEFT JOIN teacher_subjects ts ON s.id = ts.subject_id 
         LEFT JOIN teacher_student_links tsl ON s.id = tsl.subject_id
         WHERE (ts.teacher_id = ? OR tsl.teacher_id = ?) AND s.is_active = 1`,
        [user?.id || 'none', user?.id || 'none']
      );
    }
    set({ subjects: rows, isLoading: false });

  },

  fetchWeights: async (subjectId, studentId, ustazId) => {
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    let resolvedSubjectIds: string[] = [];

    if (subjectId) {
      resolvedSubjectIds = [subjectId];
    } else if (studentId && (ustazId || user?.id)) {
      const tid = ustazId || user?.id;
      // 🛡️ PRECISION FILTER: Identify subjects where Teacher + Student are linked AND subject is ACTIVE
      const links = await db.getAllAsync<{ subject_id: string }>(
        `SELECT DISTINCT tsl.subject_id FROM teacher_student_links tsl
         JOIN subjects s ON tsl.subject_id = s.id
         WHERE tsl.teacher_id = ? AND tsl.student_id = ? AND tsl.subject_id IS NOT NULL 
         AND tsl.subject_id != 'none' AND tsl.subject_id != '' AND s.is_active = 1`,
        [tid!, studentId!]
      );

      resolvedSubjectIds = links.map(l => l.subject_id);

      // 🛡️ TEAM-COVERAGE FALLBACK: Teachers are often authorized for a whole Kitab
      // team (e.g. "Hifz") that actually spans two levels — Hifz AND Quran 2 — but
      // the bootstrap teacher_student_links row for a given student only ever carries
      // ONE subject_id. That left every other level-appropriate subject (e.g. a
      // Quran 2 Kitab like Hadith/Seerah) invisible here even though the teacher is
      // clearly authorized for this student (proven by the kitab link existing at
      // all — that's the same check the student roster itself uses to decide this
      // student belongs to this teacher). Gating this on teacher_subjects "expertise"
      // turned out to be too strict: that table is frequently empty/incomplete for
      // real teachers, so it silently blocked the exact case it was meant to allow.
      // Once a teacher is confirmed to be this student's kitab teacher, grant every
      // active subject that matches the student's level, plus any subject that
      // isn't tied to a specific level at all (general Kitabs).
      const authRow = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM teacher_student_links WHERE teacher_id = ? AND student_id = ? AND type = 'kitab'`,
        [tid!, studentId!]
      );

      if (authRow && authRow.cnt > 0) {
        const levelSubjects = await db.getAllAsync<{ subject_id: string }>(
          `SELECT DISTINCT s.id as subject_id
           FROM subjects s
           JOIN students st ON st.id = ?
           WHERE s.is_active = 1 AND (s.level_id = st.level_id OR s.level_id IS NULL OR s.level_id = '')`,
          [studentId!]
        );
        levelSubjects.forEach(l => {
          if (!resolvedSubjectIds.includes(l.subject_id)) resolvedSubjectIds.push(l.subject_id);
        });
      }
    }

    const deduplicateWeights = (rows: GradeWeight[]) => {
      const dedupMap = new Map<string, GradeWeight>();
      rows.forEach(r => {
        const key = `${r.subject_id}_${r.name.trim().toLowerCase()}`;
        if (!dedupMap.has(key)) {
          dedupMap.set(key, r);
        } else {
          const existing = dedupMap.get(key);
          // Prefer custom/new weights (don't start with 'w_') over seeded weights
          if (existing?.id.startsWith('w_') && !r.id.startsWith('w_')) {
            dedupMap.set(key, r);
          }
        }
      });
      return Array.from(dedupMap.values()).sort((a, b) => b.weight - a.weight);
    };

    if (resolvedSubjectIds.length === 0 && user?.role === 'admin') {
      const rows = await db.getAllAsync<GradeWeight>(
        `SELECT w.*, s.name as subject_name, s.name_am as subject_name_am 
         FROM grade_weights w
         JOIN subjects s ON w.subject_id = s.id
         ORDER BY w.subject_id, w.weight DESC`
      );
      set({ weights: deduplicateWeights(rows) });
      return;
    }

    if (resolvedSubjectIds.length > 0) {
      const placeholders = resolvedSubjectIds.map(() => '?').join(',');
      const rows = await db.getAllAsync<GradeWeight>(
        `SELECT w.*, s.name as subject_name, s.name_am as subject_name_am 
         FROM grade_weights w
         JOIN subjects s ON w.subject_id = s.id
         WHERE w.subject_id IN (${placeholders})
         ORDER BY w.weight DESC`,
        resolvedSubjectIds
      );
      set({ weights: deduplicateWeights(rows) });
    } else {
      set({ weights: [] });
    }

  },


  addGrade: async (grade) => {
    const db = await getDatabase();

    // 🛡️ FIX: previously matched on student_id + weight_id only, so a second teacher
    // grading the same student on the same component silently overwrote the first
    // teacher's score. getStudentGrades/getRankings both filter/group by ustaz_id,
    // so the data model clearly expects one grade per (student, weight, teacher).
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM student_grades WHERE student_id = ? AND weight_id = ? AND ustaz_id = ?',
      [grade.student_id, grade.weight_id, grade.ustaz_id]
    );

    if (existing) {
      await db.runAsync(
        'UPDATE student_grades SET score = ?, date = ?, ustaz_id = ? WHERE id = ?',
        [grade.score, grade.date, grade.ustaz_id, existing.id]
      );
      await queueSync('student_grades', existing.id, 'update');
    } else {
      const id = Crypto.randomUUID();
      await db.runAsync(
        `INSERT INTO student_grades (id, student_id, weight_id, score, ustaz_id, date)
         VALUES (?,?,?,?,?,?)`,
        [id, grade.student_id, grade.weight_id, grade.score, grade.ustaz_id, grade.date]
      );
      await queueSync('student_grades', id, 'insert');
    }

    // Trigger sync
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  },

  getStudentGrades: async (studentId, ustazId) => {
    const db = await getDatabase();
    let query = `
      SELECT g.*, w.name as weight_name, w.weight as component_max, s.name as subject_name, w.subject_id
      FROM student_grades g 
      JOIN grade_weights w ON g.weight_id = w.id
      JOIN subjects s ON w.subject_id = s.id
      WHERE g.student_id = ?
    `;
    const params: any[] = [studentId];

    if (ustazId) {
      query += ' AND g.ustaz_id = ?';
      params.push(ustazId);
    }

    // Sort by date ASC so the most RECENT ones appear at the bottom of the list
    query += ' ORDER BY g.date ASC';
    return db.getAllAsync<any>(query, params);
  },

  getRankings: async (levelId: string) => {
    const db = await getDatabase();

    let query = `
      SELECT 
        s.id as student_id, 
        s.name_am as student_name, 
        s.gender, 
        s.level_id, 
        l.name as level_name, 
        sub.name as subject_name_en,
        sub.name_am as subject_name_am,
        g.ustaz_id,
        COALESCE(u.name, 'Kitab Ustaz') as ustaz_name,
        ROUND((SUM(g.score) * 1.0 / NULLIF(SUM(gw.weight), 0)) * 100, 0) as subject_score,
        COUNT(DISTINCT g.weight_id) as component_count,
        MAX(g.date) as latest_date,
        (SELECT tsl3.group_name FROM teacher_student_links tsl3 WHERE tsl3.student_id = s.id AND tsl3.type = 'kitab' AND tsl3.group_name IS NOT NULL AND tsl3.group_name != '' LIMIT 1) as kitab_group_override
      FROM student_grades g
      JOIN students s ON s.id = g.student_id
      JOIN grade_weights gw ON g.weight_id = gw.id
      LEFT JOIN users u ON g.ustaz_id = u.id
      LEFT JOIN subjects sub ON gw.subject_id = sub.id
      LEFT JOIN levels l ON s.level_id = l.id
      WHERE s.is_active = 1
    `;

    const params: any[] = [];
    if (levelId !== 'all') {
      const tid = levelId.toLowerCase();
      if (tid.includes('nuraniya')) {
        query += " AND s.level_id IN ('l1m', 'l1f')";
      } else if (tid.includes('quran 1')) {
        query += ` AND (
          EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Quran 1%')
          OR (
            s.level_id IN ('l2m', 'l2f')
            AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Quran 1%')
          )
        )`;
      } else if (tid.includes('hifz') || tid.includes('quran 2')) {
        query += ` AND (
          EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Hifz%')
          OR (
            s.level_id IN ('l3m', 'l3f', 'l4m', 'l4f')
            AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Hifz%')
          )
        )`;
      } else {
        query += ' AND s.level_id = ?';
        params.push(levelId);
      }
    }

    query += ` GROUP BY s.id, sub.name, sub.name_am, g.ustaz_id ORDER BY subject_score DESC`;

    const rows = await db.getAllAsync<any>(query, params);

    return rows;
  }
}));