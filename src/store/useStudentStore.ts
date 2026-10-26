import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { triggerBackgroundSync } from '../lib/sync';
import { Student } from '../types';

interface StudentState {
  students: Student[];
  isLoading: boolean;
  error: string | null;
  lastFilters: { levelIdOrName?: string, sessionType?: 'quran' | 'kitab', groupName?: string };
  fetchStudents: (levelIdOrName?: string, sessionType?: 'quran' | 'kitab', groupName?: string, targetUstazId?: string) => Promise<void>;
  addStudent: (data: Omit<Student, 'id' | 'created_at'>, privateData?: {
    parent_name?: string; parent_phone?: string;
    address?: string; emergency_contact?: string; medical_notes?: string;
  }) => Promise<string | null>;
  updateStudent: (id: string, data: Partial<Student>) => Promise<void>;
  deactivateStudent: (id: string) => Promise<void>;
  searchStudents: (query: string, sessionType?: 'quran' | 'kitab', groupName?: string) => Promise<Student[]>;
  linkTeacherStudent: (teacherId: string, studentId: string, subjectId?: string) => Promise<void>;
  unlinkTeacherStudent: (teacherId: string, studentId: string, subjectId?: string) => Promise<void>;
  getStudent: (id: string) => Promise<Student | null>;
  getTotalCount: () => Promise<number>;
  assignedGroups: string[];
  fetchAssignedGroups: () => Promise<void>;
  bulkAddStudents: (studentList: any[]) => Promise<void>;
  deleteStudent: (id: string) => Promise<void>;
  forceGlobalSync: () => Promise<void>;
}

export const useStudentStore = create<StudentState>((set, get) => ({
  students: [],
  isLoading: false,
  error: null,
  lastFilters: {},

  fetchStudents: async (levelIdOrName, sessionType, groupName, targetUstazId) => {
    const filters = get().lastFilters;
    // 🛡️ SESSION SWITCH RESET: If switching between Quran/Kitab, reset the level filter to avoid "Vanishing Students"
    const isSessionSwitch = sessionType !== undefined && sessionType !== filters.sessionType;

    // 🛡️ PERSISTENT FILTER LOCK: If no args passed, use last known filters (unless switching sessions)
    const finalLevel = (levelIdOrName !== undefined)
      ? (levelIdOrName === '' ? undefined : levelIdOrName)
      : (isSessionSwitch ? undefined : filters.levelIdOrName);

    const finalSession = sessionType !== undefined ? sessionType : filters.sessionType;
    const finalGroup = (groupName !== undefined)
      ? (groupName === '' ? undefined : groupName)
      : (isSessionSwitch ? undefined : filters.groupName);

    // Save for next internal refresh
    set({
      isLoading: true,
      error: null,
      lastFilters: { levelIdOrName: finalLevel, sessionType: finalSession, groupName: finalGroup }
    });

    const db = await getDatabase();

    try {
      const userState = (await import('./useAuthStore')).useAuthStore.getState();
      const user = userState.user;

      if (user?.role === 'ustaz') {
        const isQuranSession = finalSession === 'quran';
        let whereClause = 's.is_active = 1';
        const queryParams: any[] = [];

        if (isQuranSession) {
          whereClause += ` AND (s.quran_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'morning'))`;
          queryParams.push(user.id, user.id);
        } else {
          whereClause += ` AND (s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'kitab'))`;
          queryParams.push(user.id, user.id);
        }

        if (finalGroup) {
          const cleaned = finalGroup.replace('Team ', '').trim();
          if (cleaned === 'Hifz') {
            whereClause += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Hifz%')
              OR (
                (l.name LIKE '%Hifz%' OR l.name LIKE '%Quran 2%')
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Hifz%')
              )
            )`;
          } else if (cleaned === 'Quran 1') {
            whereClause += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Quran 1%')
              OR (
                l.name LIKE '%Quran 1%'
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Quran 1%')
              )
            )`;
          } else {
            whereClause += ` AND l.name LIKE ?`;
            queryParams.push(`%${cleaned}%`);
          }
        } else if (finalLevel) {
          whereClause += " AND (l.id = ? OR l.name = ? OR l.name_am = ?)";
          queryParams.push(finalLevel, finalLevel, finalLevel);
        }

        const ustazGpaSubquery = `
          COALESCE(
            (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id)), 0)) * 100, 0)
             FROM student_grades g WHERE g.student_id = s.id),
            0
          ) as gpa,
          COALESCE(
            (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id AND sg2.ustaz_id = ?)), 0)) * 100, 0)
             FROM student_grades g WHERE g.student_id = s.id AND g.ustaz_id = ?),
            0
          ) as subject_avg,
          (SELECT status FROM fees WHERE student_id = s.id LIMIT 1) as fee_status
        `;

        const query = `
          SELECT DISTINCT s.*, l.name as level_name, l.name_am as level_name_am,
          (s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ?)) as is_kitab_connected,
          (s.quran_teacher_id = ?) as is_quran_connected,
          ${ustazGpaSubquery}
          FROM students s 
          LEFT JOIN levels l ON s.level_id = l.id 
          WHERE ${whereClause}
        `;
        const finalParams = [user.id || '', user.id || '', user.id || '', user.id || '', user.id || '', ...queryParams];
        const rows = await db.getAllAsync<Student>(query, finalParams);
        set({ students: rows, isLoading: false });
        return;
      }

      if (user?.role !== 'admin' && user?.role !== 'finance') {
        set({ students: [], isLoading: false });
        return;
      }

      const isNameSearch = finalLevel && !finalLevel.startsWith('l');
      let adminWhere = 's.is_active = 1';
      const adminParams: any[] = [];

      if (targetUstazId) {
        const isQuran = finalSession === 'quran';
        const isKitab = finalSession === 'kitab';

        if (isQuran) {
          adminWhere += ` AND (s.quran_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'morning'))`;
          adminParams.push(targetUstazId, targetUstazId);
        } else if (isKitab) {
          adminWhere += ` AND (s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'kitab'))`;
          adminParams.push(targetUstazId, targetUstazId);
        } else {
          adminWhere += ` AND (s.quran_teacher_id = ? OR s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ?))`;
          adminParams.push(targetUstazId, targetUstazId, targetUstazId);
        }
      }

      if (finalGroup) {
        if (finalGroup.includes('Nuraniya')) {
          adminWhere += " AND (s.level_id IN ('l1m', 'l1f') OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.group_name LIKE '%Nuraniya%'))";
        } else if (finalGroup.includes('Quran 1')) {
          adminWhere += ` AND (
            EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Quran 1%')
            OR (
              s.level_id IN ('l2m', 'l2f')
              AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Quran 1%')
            )
          )`;
        } else if (finalGroup.includes('Hifz')) {
          adminWhere += ` AND (
            EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Hifz%')
            OR (
              s.level_id IN ('l3m', 'l3f', 'l4m', 'l4f')
              AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Hifz%')
            )
          )`;
        }
      } else if (finalLevel) {
        adminWhere += isNameSearch ? ' AND (l.name = ? OR l.name_am = ?)' : ' AND s.level_id = ?';
        if (isNameSearch) adminParams.push(finalLevel, finalLevel);
        else adminParams.push(finalLevel);
      }

      const adminGpaSubquery = `
        COALESCE(
          (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id)), 0)) * 100, 0)
           FROM student_grades g WHERE g.student_id = s.id),
          0
        ) as gpa,
        0 as subject_avg,
        (SELECT status FROM fees WHERE student_id = s.id LIMIT 1) as fee_status
      `;

      const adminQuery = `SELECT DISTINCT s.*, l.name as level_name, l.name_am as level_name_am, ${adminGpaSubquery}
                          FROM students s 
                          LEFT JOIN levels l ON s.level_id = l.id 
                          WHERE ${adminWhere}`;

      const rows = await db.getAllAsync<Student>(adminQuery, adminParams);
      set({ students: rows, isLoading: false });
    } catch (e) {
      console.error('Fetch error:', e);
      set({ students: [], error: 'error', isLoading: false });
    }
  },

  linkTeacherStudent: async (teacherId, studentId, subjectId) => {
    try {
      const db = await getDatabase();
      const student = await db.getFirstAsync<{ level_id: string }>('SELECT level_id FROM students WHERE id = ?', [studentId]);

      let teamName = 'Other';
      if (student?.level_id.startsWith('l1')) teamName = 'Team Nuraniya';
      else if (student?.level_id.startsWith('l2')) teamName = 'Team Quran 1';
      else if (student?.level_id.startsWith('l3') || student?.level_id.startsWith('l4')) teamName = 'Team Hifz';

      await db.runAsync(
        'INSERT OR IGNORE INTO teacher_student_links (teacher_id, student_id, type, subject_id, group_name) VALUES (?,?,?,?,?)',

        [teacherId, studentId, 'kitab', subjectId || 'none', teamName]
      );
      await queueSync('teacher_student_links', `${teacherId},${studentId},${subjectId || 'none'}`, 'insert');
      await get().fetchStudents();
      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
    } catch (e) {
      console.error('Link error:', e);
    }
  },

  unlinkTeacherStudent: async (teacherId, studentId) => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        'DELETE FROM teacher_student_links WHERE teacher_id = ? AND student_id = ?',
        [teacherId, studentId]
      );
      await get().fetchStudents();
    } catch (e) {
      console.error('Unlink error:', e);
    }
  },

  addStudent: async (data, privateData) => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin') throw new Error('Unauthorized: Admin only');

    const db = await getDatabase();
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();

    // Data Normalization (Production Hardening)
    const cleanNameAm = data.name_am.trim();
    const cleanNameEn = data.name_en.trim();
    const cleanPhone = privateData?.parent_phone?.replace(/\D/g, '') || '';

    try {
      await db.runAsync(
        `INSERT INTO students
         (id, name_am, name_en, dob, school_level, gender, level_id, enroll_date, photo_url, is_yetim, is_active, last_page_learnt, has_tutor, tutor_days, tutor_arrival_time, academic_year, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, cleanNameAm, cleanNameEn, data.dob ?? null, data.school_level ?? null, data.gender,
          data.level_id, data.enroll_date, data.photo_url ?? null,
          data.is_yetim ? 1 : 0, data.is_active ? 1 : 0,
          data.last_page_learnt ?? null, data.has_tutor ? 1 : 0, data.tutor_days ?? null, data.tutor_arrival_time ?? null,
          data.academic_year ?? '2019',
          data.notes ?? null, now, now] as any[]
      );

      if (privateData) {
        await db.runAsync(
          `INSERT OR REPLACE INTO student_private
           (student_id, parent_name, parent_phone, address, emergency_contact, medical_notes)
           VALUES (?,?,?,?,?,?)`,
          [id, privateData.parent_name?.trim() ?? null, cleanPhone,
            privateData.address?.trim() ?? null, privateData.emergency_contact?.trim() ?? null, privateData.medical_notes?.trim() ?? null]
        );
        await queueSync('student_private', id, 'insert');
      }

      const feeId = Crypto.randomUUID();
      const initialAmount = data.is_yetim ? 0 : 500;
      const initialStatus = data.is_yetim ? 'exempted' : 'unpaid';

      await db.runAsync(`INSERT INTO fees (id, student_id, amount_due, amount_paid, status, synced) VALUES (?,?,?,?,?,?)`,
        [feeId, id, initialAmount, 0, initialStatus, 0]);
      await queueSync('fees', feeId, 'insert');
      await queueSync('students', id, 'insert');

      const NURANIYAH_LEVELS = ['l1m', 'l1f'];
      if (!NURANIYAH_LEVELS.includes(data.level_id)) {
        const KITAB_PHONES = ['0911000001', '0911000002', '0911000003'];

        let teamName = 'Team Quran 1';
        if (data.level_id.startsWith('l3') || data.level_id.startsWith('l4')) {
          teamName = 'Team Hifz';
        }

        for (const phone of KITAB_PHONES) {
          const teacher = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', [phone]);
          if (teacher) {
            const defaultSubject = 's1';
            await db.runAsync(
              'INSERT OR IGNORE INTO teacher_student_links (teacher_id, student_id, type, subject_id, group_name) VALUES (?,?,?,?,?)',
              [teacher.id, id, 'kitab', defaultSubject, teamName]
            );
            await queueSync('teacher_student_links', `${teacher.id},${id},${defaultSubject}`, 'insert');
          }
        }
      } else {
        // Automatic Nuraniya Team Link
        const huzeyfa = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', ['0911000004']);
        if (huzeyfa) {
          await db.runAsync(
            'INSERT OR IGNORE INTO teacher_student_links (teacher_id, student_id, type, subject_id, group_name) VALUES (?,?,?,?,?)',
            [huzeyfa.id, id, 'kitab', 's2', 'Team Nuraniya']
          );
        }

      }

      await get().fetchStudents();
      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
      return id;
    } catch {
      return null;
    }
  },

  searchStudents: async (query, sessionType, groupName) => {
    set({ isLoading: true, error: null });
    const db = await getDatabase();
    const userState = (await import('./useAuthStore')).useAuthStore.getState();
    const user = userState.user;
    if (!user) {
      set({ isLoading: false });
      return [];
    }

    const like = `%${query}%`;
    try {
      // 🛡️ USTAZ SEARCH: Restricted to assigned students
      if (user.role === 'ustaz') {
        const isQuranSession = sessionType === 'quran';
        let whereClause = 's.is_active = 1 AND (s.name_am LIKE ? OR s.name_en LIKE ? OR sp.parent_phone LIKE ?)';
        const queryParams: any[] = [like, like, like];

        if (isQuranSession) {
          whereClause += ' AND s.quran_teacher_id = ?';
          queryParams.push(user.id);
        } else {
          whereClause += " AND (s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'kitab'))";
          queryParams.push(user.id, user.id);
        }

        if (groupName) {
          const cleaned = groupName.replace('Team ', '').trim();
          if (cleaned === 'Hifz') {
            whereClause += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Hifz%')
              OR (
                (l.name LIKE '%Hifz%' OR l.name LIKE '%Quran 2%')
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Hifz%')
              )
            )`;
          } else if (cleaned === 'Quran 1') {
            whereClause += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Quran 1%')
              OR (
                l.name LIKE '%Quran 1%'
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Quran 1%')
              )
            )`;
          } else {
            whereClause += " AND l.name LIKE ?";
            queryParams.push(`%${cleaned}%`);
          }
        }

        const ustazGpaSubquery = `
          COALESCE(
            (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id)), 0)) * 100, 0)
             FROM student_grades g WHERE g.student_id = s.id),
            0
          ) as gpa,
          COALESCE(
            (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id AND sg2.ustaz_id = ?)), 0)) * 100, 0)
             FROM student_grades g WHERE g.student_id = s.id AND g.ustaz_id = ?),
            0
          ) as subject_avg,
          (SELECT status FROM fees WHERE student_id = s.id LIMIT 1) as fee_status
        `;

        const queryStr = `
          SELECT DISTINCT s.*, l.name as level_name, l.name_am as level_name_am,
          (s.kitab_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ?)) as is_kitab_connected,
          (s.quran_teacher_id = ?) as is_quran_connected,
          ${ustazGpaSubquery}
          FROM students s 
          LEFT JOIN levels l ON s.level_id = l.id 
          LEFT JOIN student_private sp ON s.id = sp.student_id
          WHERE ${whereClause}
          ORDER BY s.name_am ASC
        `;

        const finalParams = [user.id, user.id, user.id, user.id, user.id, ...queryParams];
        const rows = await db.getAllAsync<Student>(queryStr, finalParams);
        set({ students: rows, isLoading: false });
        return rows;
      }

      // 🛡️ ADMIN / FINANCE SEARCH: Global
      if (user.role === 'admin' || user.role === 'finance') {
        let adminWhere = 's.is_active = 1 AND (s.name_am LIKE ? OR s.name_en LIKE ? OR sp.parent_phone LIKE ?)';
        const adminParams: any[] = [like, like, like];

        if (groupName) {
          if (groupName.includes('Nuraniya')) {
            adminWhere += " AND (s.level_id IN ('l1m', 'l1f') OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.group_name LIKE '%Nuraniya%'))";
          } else if (groupName.includes('Quran 1')) {
            adminWhere += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Quran 1%')
              OR (
                s.level_id IN ('l2m', 'l2f')
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Quran 1%')
              )
            )`;
          } else if (groupName.includes('Hifz')) {
            adminWhere += ` AND (
              EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name LIKE '%Hifz%')
              OR (
                s.level_id IN ('l3m', 'l3f', 'l4m', 'l4f')
                AND NOT EXISTS (SELECT 1 FROM teacher_student_links tsl2 WHERE tsl2.student_id = s.id AND tsl2.type = 'kitab' AND tsl2.group_name IS NOT NULL AND tsl2.group_name != '' AND tsl2.group_name NOT LIKE '%Hifz%')
              )
            )`;
          }
        }

        const adminGpaSubquery = `
          COALESCE(
            (SELECT ROUND((SUM(g.score) * 1.0 / NULLIF((SELECT SUM(weight) FROM grade_weights gw WHERE gw.subject_id IN (SELECT DISTINCT gw2.subject_id FROM grade_weights gw2 JOIN student_grades sg2 ON gw2.id = sg2.weight_id WHERE sg2.student_id = s.id)), 0)) * 100, 0)
             FROM student_grades g WHERE g.student_id = s.id),
            0
          ) as gpa,
          0 as subject_avg,
          (SELECT status FROM fees WHERE student_id = s.id LIMIT 1) as fee_status
        `;

        const adminQuery = `
          SELECT DISTINCT s.*, l.name as level_name, l.name_am as level_name_am, ${adminGpaSubquery}
          FROM students s 
          LEFT JOIN levels l ON s.level_id = l.id 
          LEFT JOIN student_private sp ON s.id = sp.student_id
          WHERE ${adminWhere}
          ORDER BY s.name_am ASC
        `;

        const rows = await db.getAllAsync<Student>(adminQuery, adminParams);
        set({ students: rows, isLoading: false });
        return rows;
      }

      set({ students: [], isLoading: false });
      return [];
    } catch (e) {
      console.error('Search error:', e);
      set({ error: 'Search failed', isLoading: false });
      return [];
    }
  },

  getStudent: async (id) => {
    const db = await getDatabase();
    return db.getFirstAsync<Student>(
      `SELECT s.*, l.name as level_name, l.name_am as level_name_am, l.gender as level_gender,
              sp.parent_name, sp.parent_phone, sp.address, sp.emergency_contact, sp.medical_notes
       FROM students s
       LEFT JOIN levels l ON s.level_id = l.id
       LEFT JOIN student_private sp ON sp.student_id = s.id
       WHERE s.id = ?`,
      [id]
    );
  },

  getTotalCount: async () => {
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;

    let query = 'SELECT COUNT(DISTINCT s.id) as count FROM students s WHERE s.is_active = 1';
    const params: any[] = [];

    if (user?.role === 'ustaz') {
      // 🛡️ USTAZ COUNT: Sum of unique students across both responsibilities
      query += ' AND (s.quran_teacher_id = ? OR EXISTS (SELECT 1 FROM teacher_student_links tsl WHERE tsl.student_id = s.id AND tsl.teacher_id = ?))';
      params.push(user.id, user.id);
    }

    const row = await db.getFirstAsync<{ count: number }>(query, params);
    return row?.count ?? 0;
  },
  assignedGroups: [],
  updateStudent: async (id, data: any) => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin') throw new Error('Unauthorized: Admin only');

    const db = await getDatabase();
    try {
      await db.withTransactionAsync(async () => {
        // 1. Separate core student fields and private fields
        const coreFields = ['name_am', 'name_en', 'dob', 'school_level', 'gender', 'level_id', 'enroll_date', 'photo_url', 'is_yetim', 'is_active', 'last_page_learnt', 'has_tutor', 'tutor_days', 'tutor_arrival_time', 'academic_year', 'notes', 'quran_teacher_id', 'kitab_teacher_id'];
        const privateFields = ['parent_name', 'parent_phone', 'address', 'emergency_contact', 'medical_notes'];

        const coreToUpdate = Object.keys(data).filter(k => coreFields.includes(k));
        const privateToUpdate = Object.keys(data).filter(k => privateFields.includes(k));

        if (coreToUpdate.length > 0) {
          const assignments = coreToUpdate.map(k => `${k} = ?`).join(', ');
          const values = coreToUpdate.map(k => data[k]);
          await db.runAsync(`UPDATE students SET ${assignments}, synced = 0, updated_at = datetime('now') WHERE id = ?`, [...values, id]);
          await queueSync('students', id, 'update');
        }

        if (privateToUpdate.length > 0) {
          const assignments = privateToUpdate.map(k => `${k} = ?`).join(', ');
          const values = privateToUpdate.map(k => data[k]);
          await db.runAsync(`UPDATE student_private SET ${assignments}, synced = 0 WHERE student_id = ?`, [...values, id]);
          await queueSync('student_private', id, 'update');
        }
      });
      triggerBackgroundSync();
    } catch (e) {
      console.error('Update student error:', e);
      throw e;
    }
  },

  deactivateStudent: async (id) => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin') throw new Error('Unauthorized: Admin only');

    const db = await getDatabase();
    await db.runAsync('UPDATE students SET is_active = 0, synced = 0 WHERE id = ?', [id]);
    await queueSync('students', id, 'update');
    triggerBackgroundSync();
  },

  // 🛡️ FIX: admin-only guard restored (was silently dead code before — a duplicate,
  // unguarded `deleteStudent` key later in this same object was overwriting this one).
  // 🛡️ FIX: explicitly queues a 'delete' sync entry for every child row (payments, fees,
  // grades, progress, assessments, attendance, links, private info) BEFORE the local
  // SQLite cascade wipes them. Previously only the 'students' row itself was queued for
  // deletion — if the Supabase FK on any child table wasn't ON DELETE CASCADE, the delete
  // would fail, silently retry 3x, then get dropped from sync_log and marked "synced"
  // anyway, permanently orphaning the student (and their fees/phone/medical notes) in the
  // cloud while it vanished from every local device.
  deleteStudent: async (id) => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin') throw new Error('Unauthorized: Admin only');

    const db = await getDatabase();
    try {
      await db.withTransactionAsync(async () => {
        const payments = await db.getAllAsync<{ id: string }>(
          `SELECT p.id FROM payments p JOIN fees f ON p.fee_id = f.id WHERE f.student_id = ?`, [id]
        );
        for (const p of payments) await queueSync('payments', p.id, 'delete');

        const fees = await db.getAllAsync<{ id: string }>('SELECT id FROM fees WHERE student_id = ?', [id]);
        for (const f of fees) await queueSync('fees', f.id, 'delete');

        const grades = await db.getAllAsync<{ id: string }>('SELECT id FROM student_grades WHERE student_id = ?', [id]);
        for (const g of grades) await queueSync('student_grades', g.id, 'delete');

        const progress = await db.getAllAsync<{ id: string }>('SELECT id FROM student_progress WHERE student_id = ?', [id]);
        for (const p of progress) await queueSync('student_progress', p.id, 'delete');

        const assessments = await db.getAllAsync<{ id: string }>('SELECT id FROM nuraniyah_assessments WHERE student_id = ?', [id]);
        for (const a of assessments) await queueSync('nuraniyah_assessments', a.id, 'delete');

        const attendance = await db.getAllAsync<{ id: string }>('SELECT id FROM attendance WHERE student_id = ?', [id]);
        for (const a of attendance) await queueSync('attendance', a.id, 'delete');

        const links = await db.getAllAsync<{ teacher_id: string, student_id: string, subject_id: string }>(
          'SELECT teacher_id, student_id, subject_id FROM teacher_student_links WHERE student_id = ?', [id]
        );
        for (const l of links) await queueSync('teacher_student_links', `${l.teacher_id},${l.student_id},${l.subject_id}`, 'delete');

        await queueSync('student_private', id, 'delete');

        // Local delete last — SQLite FK cascade (PRAGMA foreign_keys = ON) removes all
        // the rows above from the device in one shot, now that the cloud has explicit
        // delete instructions queued for each of them.
        await db.runAsync('DELETE FROM students WHERE id = ?', [id]);
        await queueSync('students', id, 'delete');
      });

      await get().fetchStudents();
      triggerBackgroundSync(true);
    } catch (e) {
      console.error('Delete student error:', e);
      throw e;
    }
  },

  bulkAddStudents: async (studentList: any[]) => {
    const db = await getDatabase();
    try {
      await db.withTransactionAsync(async () => {
        for (const s of studentList) {
          const id = Crypto.randomUUID();
          const now = new Date().toISOString();

          // 1. Core Student Record
          await db.runAsync(
            `INSERT INTO students (id, name_am, name_en, gender, level_id, enroll_date, dob, school_level, is_yetim, is_active, synced)
             VALUES (?,?,?,?,?,?,?,?,?,1,0)`,
            [id, s.name_am, s.name_en, s.gender.toLowerCase(), s.level_id.toLowerCase(), s.enroll_date || now, s.dob, s.school_level, s.is_yetim ? 1 : 0]
          );

          // 2. Private Registration Data (Building the address string for simplicity or keep granular if columns exist)
          const fullAddress = s.subcity ? `${s.subcity}, W.${s.woreda}, B.${s.block}, H.${s.house}` : s.address;
          const emergencyStr = s.emergency_name ? `${s.emergency_name} (${s.emergency_phone})` : '';

          await db.runAsync(
            `INSERT INTO student_private (student_id, parent_name, parent_phone, address, emergency_contact, medical_notes, synced)
             VALUES (?,?,?,?,?,?,0)`,
            [id, s.parent_name, s.parent_phone, fullAddress, emergencyStr, s.medical_notes]
          );

          // 3. Financial Fee Record (Auto-Generation)
          if (!s.is_yetim) {
            await db.runAsync(
              `INSERT INTO fees (id, student_id, amount_due, amount_paid, status, synced)
               VALUES (?,?,500,0,'unpaid',0)`,
              [`fee_${id}`, id]
            );
            await queueSync('fees', `fee_${id}`, 'insert');
          }

          await queueSync('students', id, 'insert');
          await queueSync('student_private', id, 'insert');
        }
      });
      triggerBackgroundSync();
    } catch (e) {
      console.error('Bulk add error:', e);
      throw e;
    }
  },

  forceGlobalSync: async () => {
    const db = await getDatabase();
    try {
      await db.withTransactionAsync(async () => {
        // 🔄 RE-VERIFY MASTER RECORDS
        const students = await db.getAllAsync<{ id: string }>('SELECT id FROM students');
        if (students) {
          for (const s of students) await queueSync('students', s.id, 'insert');
        }

        const privates = await db.getAllAsync<{ student_id: string }>('SELECT student_id FROM student_private');
        if (privates) {
          for (const p of privates) await queueSync('student_private', p.student_id, 'insert');
        }

        const links = await db.getAllAsync<{ teacher_id: string, student_id: string, subject_id: string }>('SELECT teacher_id, student_id, subject_id FROM teacher_student_links');
        if (links) {
          for (const l of links) await queueSync('teacher_student_links', `${l.teacher_id},${l.student_id},${l.subject_id}`, 'insert');
        }

        const fList = await db.getAllAsync<{ id: string }>('SELECT id FROM fees');
        if (fList) {
          for (const f of fList) await queueSync('fees', f.id, 'insert');
        }

        // 🎓 FORCE ACADEMIC GRADES
        const gList = await db.getAllAsync<{ id: string }>('SELECT id FROM student_grades');
        if (gList) {
          for (const g of gList) await queueSync('student_grades', g.id, 'insert');
        }

        // 📖 FORCE NURANIYAH ASSESSMENTS
        const aList = await db.getAllAsync<{ id: string }>('SELECT id FROM nuraniyah_assessments');
        if (aList) {
          for (const a of aList) await queueSync('nuraniyah_assessments', a.id, 'insert');
        }

        // 🏗️ FORCE ARCHITECTURAL METADATA (For Reports)
        const wList = await db.getAllAsync<{ id: string }>('SELECT id FROM grade_weights');
        if (wList) {
          for (const w of wList) await queueSync('grade_weights', w.id, 'insert');
        }

        const subList = await db.getAllAsync<{ id: string }>('SELECT id FROM subjects');
        if (subList) {
          for (const sb of subList) await queueSync('subjects', sb.id, 'insert');
        }

        const lList = await db.getAllAsync<{ id: string }>('SELECT id FROM levels');
        if (lList) {
          for (const l of lList) await queueSync('levels', l.id, 'insert');
        }

        // 📅 FORCE ATTENDANCE & PROGRESS
        const attList = await db.getAllAsync<{ id: string }>('SELECT id FROM attendance');
        if (attList) {
          for (const att of attList) await queueSync('attendance', att.id, 'insert');
        }

        const tAttList = await db.getAllAsync<{ id: string }>('SELECT id FROM teacher_attendance');
        if (tAttList) {
          for (const ta of tAttList) await queueSync('teacher_attendance', ta.id, 'insert');
        }

        const pList = await db.getAllAsync<{ id: string }>('SELECT id FROM student_progress');
        if (pList) {
          for (const p of pList) await queueSync('student_progress', p.id, 'insert');
        }
      });

      const { syncAll } = await import('../lib/sync');
      await syncAll(true); // 🛰️ FORCE CLOUD HANDSHAKE
      await get().fetchStudents();
    } catch (e) {
      console.error('Manual Global Sync Failure:', e);
    }
  },

  fetchAssignedGroups: async () => {
    const db = await getDatabase();
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (!user || user.role !== 'ustaz') {
      set({ assignedGroups: ['Team Nuraniya', 'Team Quran 1', 'Team Hifz'] });
      return;
    }

    // 🛡️ Smart Team Detection: Check Profile (kitab_teams), explicit link-groups, and students' actual level names
    const rows = await db.getAllAsync<{ group_name: string, level_name: string }>(`
      SELECT DISTINCT tsl.group_name, l.name as level_name
      FROM teacher_student_links tsl
      JOIN students s ON tsl.student_id = s.id
      JOIN levels l ON s.level_id = l.id
      WHERE tsl.teacher_id = ?
      UNION
      SELECT DISTINCT NULL as group_name, l.name as level_name
      FROM students s
      JOIN levels l ON s.level_id = l.id
      WHERE s.kitab_teacher_id = ?
    `, [user.id, user.id]);

    const mappedGroups = new Set<string>();

    // 1. Add teams from Profile Authorization
    if (user.kitab_teams) {
      try {
        const profileTeams = JSON.parse(user.kitab_teams);
        if (Array.isArray(profileTeams)) {
          profileTeams.forEach(t => mappedGroups.add(t));
        }
      } catch (e) { }
    }

    // 2. Add teams from active Assignments
    rows.forEach(r => {
      const g = (r.group_name || r.level_name || '').toLowerCase();
      if (g.includes('nuraniya')) mappedGroups.add('Team Nuraniya');
      else if (g.includes('quran 1')) mappedGroups.add('Team Quran 1');
      else if (g.includes('hifz') || g.includes('quran 2') || g.includes('kitab')) mappedGroups.add('Team Hifz');
    });

    const valid = ['Team Nuraniya', 'Team Quran 1', 'Team Hifz'];
    const groups = Array.from(mappedGroups).sort((a, b) => valid.indexOf(a) - valid.indexOf(b));
    set({ assignedGroups: groups });
  },
}));