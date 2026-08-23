import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { triggerBackgroundSync } from '../lib/sync';
import { StudentTeam, Student } from '../types';
import { COLORS } from '../constants';

export interface TeamWithMembers extends StudentTeam {
  members: Student[];
}

export type TeamType = 'quran' | 'kitab';

interface TeamState {
  teams: TeamWithMembers[];
  isLoading: boolean;
  // 🆕 Remembers the team_type of the most recent fetchTeams call, so internal
  // refetches after rename/delete/updateTeamMembers (which only have a teamId or
  // ustazId to work with) land back on the same tab instead of defaulting to 'quran'.
  activeTeamType: TeamType;
  fetchTeams: (ustazId: string, teamType?: TeamType) => Promise<void>;
  createTeam: (name: string, ustazId: string, studentIds: string[], teamType: TeamType, levelId?: string, emoji?: string) => Promise<{ ok: boolean; error?: string }>;
  updateTeamMembers: (teamId: string, studentIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  renameTeam: (teamId: string, name: string, emoji?: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  getUnassignedStudents: (ustazId: string, teamType: TeamType, excludeTeamId?: string) => Promise<Student[]>;
  // 🆕 How many teaching days in a row the WHOLE team was present/late together.
  // Looks at the most recent dates the team has any attendance record and counts
  // backward until a day breaks (someone absent/excused, or not everyone marked).
  getTeamStreak: (memberIds: string[]) => Promise<number>;
}

// Small curated set so the picker stays simple (no color wheel / free-form input needed) —
// each emoji already implies a color tag via EMOJI_COLORS below.
export const TEAM_EMOJI_OPTIONS = ['👥', '🌟', '🌙', '🕌', '📖', '🔥', '🌿', '🦋', '⭐', '🏆'];
const EMOJI_COLORS: Record<string, string> = {
  '👥': '#64748b', '🌟': '#eab308', '🌙': '#6366f1', '🕌': '#0f766e',
  '📖': '#0284c7', '🔥': '#dc2626', '🌿': '#16a34a', '🦋': '#db2777',
  '⭐': '#d97706', '🏆': '#7c3aed',
};
export function getTeamColor(emoji?: string) {
  return EMOJI_COLORS[emoji || '👥'] || COLORS.primary;
}

export const MAX_TEAM_SIZE = 5;
export const MIN_TEAM_SIZE = 2;

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  isLoading: false,
  activeTeamType: 'quran',

  fetchTeams: async (ustazId: string, teamType?: TeamType) => {
    const resolvedType = teamType ?? get().activeTeamType;
    set({ isLoading: true, activeTeamType: resolvedType });
    const db = await getDatabase();
    const teams = await db.getAllAsync<StudentTeam>(
      `SELECT * FROM student_teams WHERE ustaz_id = ? AND team_type = ? AND is_active = 1 ORDER BY created_at ASC`,
      [ustazId, resolvedType]
    );

    const teamsWithMembers: TeamWithMembers[] = [];
    for (const team of teams) {
      const members = await db.getAllAsync<Student>(
        `SELECT s.* FROM student_team_members stm
         JOIN students s ON s.id = stm.student_id
         WHERE stm.team_id = ? AND s.is_active = 1
         ORDER BY s.name_am ASC`,
        [team.id]
      );
      teamsWithMembers.push({ ...team, members });
    }

    set({ teams: teamsWithMembers, isLoading: false });
  },

  getUnassignedStudents: async (ustazId: string, teamType: TeamType, excludeTeamId?: string) => {
    const db = await getDatabase();
    // 🛡️ FIX: Recitation Teams are a Quran/qirat feature — this used to match ANY
    // relationship to the teacher (tsl.teacher_id with no type filter, teacher_levels,
    // and even s.kitab_teacher_id), so an ustaz who only teaches a student's afternoon
    // Kitab session saw that student as a Quran team candidate too. Now scoped to the
    // same "Quran side" relationship useStudentStore uses elsewhere: s.quran_teacher_id,
    // or a teacher_student_links row explicitly typed 'morning' (the Quran session type).
    //
    // 🆕 Kitab candidates mirror useStudentStore's kitab-connection expression:
    // s.kitab_teacher_id, or a teacher_student_links row explicitly typed 'kitab'.
    //
    // The "already on a team" exclusion is scoped to teams of the SAME team_type,
    // so a student can be on one Quran team AND one Kitab team at once.
    const relationClause = teamType === 'kitab'
      ? `LEFT JOIN teacher_student_links tsl ON tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'kitab'
         WHERE s.is_active = 1
           AND (s.kitab_teacher_id = ? OR tsl.teacher_id IS NOT NULL)`
      : `LEFT JOIN teacher_student_links tsl ON tsl.student_id = s.id AND tsl.teacher_id = ? AND tsl.type = 'morning'
         WHERE s.is_active = 1
           AND (s.quran_teacher_id = ? OR tsl.teacher_id IS NOT NULL)`;

    const rows = await db.getAllAsync<Student>(
      `SELECT DISTINCT s.* FROM students s
       ${relationClause}
         AND s.id NOT IN (
           SELECT stm.student_id FROM student_team_members stm
           JOIN student_teams st ON st.id = stm.team_id
           WHERE st.is_active = 1 AND st.team_type = ? ${excludeTeamId ? 'AND st.id != ?' : ''}
         )
       ORDER BY s.name_am ASC`,
      excludeTeamId ? [ustazId, ustazId, teamType, excludeTeamId] : [ustazId, ustazId, teamType]
    );
    return rows;
  },

  createTeam: async (name, ustazId, studentIds, teamType, levelId, emoji) => {
    if (studentIds.length < MIN_TEAM_SIZE || studentIds.length > MAX_TEAM_SIZE) {
      return { ok: false, error: `A team needs ${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE} students.` };
    }

    const db = await getDatabase();

    // 🛡️ One team per student PER TYPE: reject only if a picked student is already
    // on an active team of the SAME team_type (a student can be on one Quran team
    // AND one Kitab team).
    const placeholders = studentIds.map(() => '?').join(',');
    const clashes = await db.getAllAsync<{ id: string }>(
      `SELECT s.id FROM student_team_members stm
       JOIN students s ON s.id = stm.student_id
       JOIN student_teams st ON st.id = stm.team_id
       WHERE st.is_active = 1 AND st.team_type = ? AND stm.student_id IN (${placeholders})`,
      [teamType, ...studentIds]
    );
    if (clashes.length > 0) {
      return { ok: false, error: 'One or more selected students are already on a team.' };
    }

    const id = Crypto.randomUUID();
    await db.runAsync(
      `INSERT INTO student_teams (id, name, emoji, team_type, ustaz_id, level_id, is_active, synced) VALUES (?,?,?,?,?,?,1,0)`,
      [id, name, emoji || '👥', teamType, ustazId, levelId ?? null]
    );
    await queueSync('student_teams', id, 'insert');

    for (const studentId of studentIds) {
      await db.runAsync(
        `INSERT INTO student_team_members (team_id, student_id, synced) VALUES (?,?,0)`,
        [id, studentId]
      );
      await queueSync('student_team_members', `${id},${studentId}`, 'insert');
    }

    triggerBackgroundSync(true);
    await get().fetchTeams(ustazId, teamType);
    return { ok: true };
  },

  updateTeamMembers: async (teamId, studentIds) => {
    if (studentIds.length < MIN_TEAM_SIZE || studentIds.length > MAX_TEAM_SIZE) {
      return { ok: false, error: `A team needs ${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE} students.` };
    }
    const db = await getDatabase();

    const currentTeam = await db.getFirstAsync<StudentTeam>(`SELECT * FROM student_teams WHERE id = ?`, [teamId]);
    if (!currentTeam) return { ok: false, error: 'Team not found.' };

    const placeholders = studentIds.map(() => '?').join(',');
    const clashes = await db.getAllAsync<{ id: string }>(
      `SELECT s.id FROM student_team_members stm
       JOIN students s ON s.id = stm.student_id
       JOIN student_teams st ON st.id = stm.team_id
       WHERE st.is_active = 1 AND st.team_type = ? AND st.id != ? AND stm.student_id IN (${placeholders})`,
      [currentTeam.team_type, teamId, ...studentIds]
    );
    if (clashes.length > 0) {
      return { ok: false, error: 'One or more selected students are already on a team.' };
    }

    const existing = await db.getAllAsync<{ student_id: string }>(
      `SELECT student_id FROM student_team_members WHERE team_id = ?`, [teamId]
    );
    const existingIds = existing.map(e => e.student_id);

    const toRemove = existingIds.filter(id => !studentIds.includes(id));
    const toAdd = studentIds.filter(id => !existingIds.includes(id));

    for (const studentId of toRemove) {
      await db.runAsync(`DELETE FROM student_team_members WHERE team_id = ? AND student_id = ?`, [teamId, studentId]);
      await queueSync('student_team_members', `${teamId},${studentId}`, 'delete');
    }
    for (const studentId of toAdd) {
      await db.runAsync(`INSERT INTO student_team_members (team_id, student_id, synced) VALUES (?,?,0)`, [teamId, studentId]);
      await queueSync('student_team_members', `${teamId},${studentId}`, 'insert');
    }

    await db.runAsync(`UPDATE student_teams SET updated_at = datetime('now'), synced = 0 WHERE id = ?`, [teamId]);
    await queueSync('student_teams', teamId, 'update');

    triggerBackgroundSync(true);
    await get().fetchTeams(currentTeam.ustaz_id, currentTeam.team_type);
    return { ok: true };
  },

  renameTeam: async (teamId, name, emoji) => {
    const db = await getDatabase();
    if (emoji) {
      await db.runAsync(`UPDATE student_teams SET name = ?, emoji = ?, updated_at = datetime('now'), synced = 0 WHERE id = ?`, [name, emoji, teamId]);
    } else {
      await db.runAsync(`UPDATE student_teams SET name = ?, updated_at = datetime('now'), synced = 0 WHERE id = ?`, [name, teamId]);
    }
    await queueSync('student_teams', teamId, 'update');
    triggerBackgroundSync(true);
    const team = await db.getFirstAsync<StudentTeam>(`SELECT * FROM student_teams WHERE id = ?`, [teamId]);
    if (team) await get().fetchTeams(team.ustaz_id, team.team_type);
  },

  deleteTeam: async (teamId) => {
    const db = await getDatabase();
    const team = await db.getFirstAsync<StudentTeam>(`SELECT * FROM student_teams WHERE id = ?`, [teamId]);

    const members = await db.getAllAsync<{ student_id: string }>(
      `SELECT student_id FROM student_team_members WHERE team_id = ?`, [teamId]
    );
    for (const m of members) {
      await db.runAsync(`DELETE FROM student_team_members WHERE team_id = ? AND student_id = ?`, [teamId, m.student_id]);
      await queueSync('student_team_members', `${teamId},${m.student_id}`, 'delete');
    }

    // Soft-disable rather than hard delete so history stays intact if it already synced
    await db.runAsync(`UPDATE student_teams SET is_active = 0, updated_at = datetime('now'), synced = 0 WHERE id = ?`, [teamId]);
    await queueSync('student_teams', teamId, 'update');

    triggerBackgroundSync(true);
    if (team) await get().fetchTeams(team.ustaz_id, team.team_type);
  },

  getTeamStreak: async (memberIds: string[]) => {
    if (memberIds.length === 0) return 0;
    const db = await getDatabase();
    const placeholders = memberIds.map(() => '?').join(',');
    // One row per date this team has ANY attendance record, with how many members
    // were marked present/late that day vs how many were marked at all.
    const rows = await db.getAllAsync<{ date: string; good: number; marked: number }>(
      `SELECT date,
         SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) as good,
         COUNT(*) as marked
       FROM attendance
       WHERE student_id IN (${placeholders})
       GROUP BY date
       ORDER BY date DESC
       LIMIT 30`,
      memberIds
    );

    let streak = 0;
    for (const row of rows) {
      if (row.marked === memberIds.length && row.good === memberIds.length) {
        streak++;
      } else {
        break; // first day the whole team wasn't marked present/late together ends the streak
      }
    }
    return streak;
  },
}));