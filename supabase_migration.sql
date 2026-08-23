-- ============================================================
-- MEDRESA MANAGEMENT SYSTEM - SUPABASE MIGRATION (FINAL)
-- Verified against actual Supabase schema on 2026-06-25
-- All columns use TEXT type. Run this ONCE in SQL Editor.
-- ============================================================

-- 1. Subjects
INSERT INTO subjects (id, name_en, name_am)
VALUES
  ('s4', 'Aqidah', 'አቂዳ'),
  ('s6', 'Adab', 'አደብ'),
  ('s7', 'Sira', 'ሲራ')
ON CONFLICT (id) DO UPDATE SET name_en = EXCLUDED.name_en, name_am = EXCLUDED.name_am;

-- 2. Grade Weights (new 10/15/25/50 system)
DELETE FROM grade_weights WHERE id IN (
  'w_s4_quiz', 'w_s4_midterm', 'w_s4_final',
  'w_s6_quiz', 'w_s6_midterm', 'w_s6_final',
  'w_s7_quiz', 'w_s7_midterm', 'w_s7_final',
  'w_s4_quiz_/_participation', 'w_s6_quiz_/_participation', 'w_s7_quiz_/_participation'
);

INSERT INTO grade_weights (id, subject_id, name, weight) VALUES
  ('w_s4_assignment', 's4', 'Assignment', 10),
  ('w_s4_quiz',       's4', 'Quiz',       15),
  ('w_s4_midterm',    's4', 'Mid-term Exam', 25),
  ('w_s4_final',      's4', 'Final Exam',    50),

  ('w_s6_assignment', 's6', 'Assignment', 10),
  ('w_s6_quiz',       's6', 'Quiz',       15),
  ('w_s6_midterm',    's6', 'Mid-term Exam', 25),
  ('w_s6_final',      's6', 'Final Exam',    50),

  ('w_s7_assignment', 's7', 'Assignment', 10),
  ('w_s7_quiz',       's7', 'Quiz',       15),
  ('w_s7_midterm',    's7', 'Mid-term Exam', 25),
  ('w_s7_final',      's7', 'Final Exam',    50)
ON CONFLICT (id) DO NOTHING;

-- 3. Teacher-Subject assignments
INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT id, 's6' FROM users WHERE phone = '0911000001'
ON CONFLICT DO NOTHING;

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT id, 's4' FROM users WHERE phone = '0911000002'
ON CONFLICT DO NOTHING;

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT id, 's7' FROM users WHERE phone = '0911000003'
ON CONFLICT DO NOTHING;

-- 4. Auto-link Quran 1, Quran 2, Hifz students to Kitab teachers
INSERT INTO teacher_student_links (teacher_id, student_id, type)
SELECT u.id, s.id, 'kitab'
FROM users u, students s
WHERE u.phone IN ('0911000001', '0911000002', '0911000003')
  AND s.is_active = true
  AND s.level_id NOT IN ('l1m', 'l1f')
ON CONFLICT DO NOTHING;

-- 5. Create Nuraniyah Assessments table (ALL columns are TEXT to match schema)
CREATE TABLE IF NOT EXISTS nuraniyah_assessments (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  rating      TEXT NOT NULL CHECK(rating IN ('excellent', 'good', 'needs_work')),
  ustaz_id    TEXT NOT NULL,
  notes       TEXT,
  synced      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, date, category)
);

-- 6. Enable RLS
ALTER TABLE nuraniyah_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" 
  ON nuraniyah_assessments FOR ALL TO authenticated USING (true);

-- Done! 🎉
