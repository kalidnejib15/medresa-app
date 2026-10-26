// TypeScript interfaces for the entire Medresa app

export type UserRole = 'admin' | 'teacher' | 'ustaz' | 'finance' | 'committee';

export type Gender = 'male' | 'female';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type FeeStatus = 'paid' | 'partial' | 'unpaid' | 'exempted';

export type TimeBlockType = 'medresa' | 'kitab';

export type GradeType = 'quiz' | 'exam' | 'participation' | 'memorization';

// ── Users (Admin / Ustaz) ──────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  assignedLevels?: string[]; // IDs of levels this teacher/ustaz is assigned to
  assignedSubjects?: string[]; // IDs of subjects this teacher/ustaz is assigned to
  kitab_teams?: string; // Comma-separated list of team names (Team Nuraniya, etc.)
}


// ── Recitation Teams (small 2-5 student groups) ─────────────────────────────
export interface StudentTeam {
  id: string;
  name: string;
  emoji?: string;
  team_type: 'quran' | 'kitab';
  ustaz_id: string;
  level_id?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Levels ─────────────────────────────────────────────────────────────────
export interface Level {
  id: string;
  name: string;           // e.g. "Level 1"
  name_am: string;        // e.g. "ደረጃ ፩"
  gender: Gender;         // 'male' | 'female'
  description?: string;
  created_at: string;
}

// ── Time Blocks ─────────────────────────────────────────────────────────────
export interface TimeBlock {
  id: string;
  level_id: string;
  name: string;
  name_am: string;
  start_time: string;   // "08:00"
  end_time: string;     // "10:00"
  type: TimeBlockType;
}

// ── Students ───────────────────────────────────────────────────────────────
export interface Student {
  id: string;
  name_am: string;
  name_en: string;
  dob?: string;
  school_level?: string;
  gender: Gender;
  level_id: string;
  enroll_date: string;
  photo_url?: string;
  is_yetim: number;
  is_active: number;
  notes?: string;
  quran_teacher_id?: string;
  kitab_teacher_id?: string;
  team?: string;
  level_name?: string;
  level_name_am?: string;
  level_gender?: Gender;
  gpa?: number;
  parent_name?: string;
  parent_phone?: string;
  address?: string;
  emergency_contact?: string;
  medical_notes?: string;
  fee_status?: FeeStatus;
  last_page_learnt?: string;
  has_tutor?: number;
  tutor_days?: string;
  tutor_arrival_time?: string;
  academic_year?: string;
  // joined
  level?: Level;
}

export interface StudentPrivate {
  student_id: string;
  parent_name?: string;
  parent_phone?: string;
  address?: string;
  emergency_contact?: string;
  medical_notes?: string;
}

// ── Attendance ──────────────────────────────────────────────────────────────
export interface Attendance {
  id: string;
  student_id: string;
  date: string;             // "2026-06-23"
  time_block_id: string;
  status: AttendanceStatus;
  marked_by: string;        // user id
  notes?: string;
  created_at: string;
  // joined
  student?: Student;
}

// ── Subjects ────────────────────────────────────────────────────────────────
export interface Subject {
  id: string;
  name_en: string;
  name_am: string;
  level_id: string;
}

// ── Grades ──────────────────────────────────────────────────────────────────
export interface Grade {
  id: string;
  student_id: string;
  subject_id: string;
  grade_type: GradeType;
  score: number;
  max_score: number;
  date: string;
  ustaz_id: string;
  notes?: string;
}

// ── Fees ────────────────────────────────────────────────────────────────────
export interface Fee {
  id: string;
  student_id: string;
  amount_due: number;
  amount_paid: number;
  due_date?: string;
  status: FeeStatus;
  notes?: string;
}

export interface Payment {
  id: string;
  fee_id: string;
  amount: number;
  paid_date: string;
  received_by: string;
  notes?: string;
}

// ── Announcements ───────────────────────────────────────────────────────────
export interface Announcement {
  id: string;
  title: string;
  body: string;
  created_by: string;
  created_at: string;
  target_role?: UserRole | 'all';
}

// ── Hifz Progress ───────────────────────────────────────────────────────────
export interface HifzProgress {
  id: string;
  student_id: string;
  surah: string;
  ayah_from: number;
  ayah_to: number;
  date: string;
  quality: 'excellent' | 'good' | 'needs_work';
  ustaz_id: string;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export interface AuthSession {
  user: User;
  access_token: string;
}
