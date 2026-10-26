-- ============================================================
-- ABUBEKER MEDRESA - 2019 INTAKE SUPABASE MIGRATION
-- Run this ONCE in your Supabase SQL Editor before syncing.
-- ============================================================

-- 1. Add new columns to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_page_learnt TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS has_tutor INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS tutor_days TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS tutor_arrival_time TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_year TEXT DEFAULT '2019';

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_students_academic_year ON students(academic_year);
CREATE INDEX IF NOT EXISTS idx_students_has_tutor ON students(has_tutor);

-- 3. Automatic Fee Initializer Trigger for Web Registrations
-- When staff registers a student via web or API, this trigger automatically
-- generates the corresponding fee record so the ledger is always complete!
CREATE OR REPLACE FUNCTION handle_new_student_fee()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO fees (id, student_id, amount_due, amount_paid, status, created_at, updated_at)
  VALUES (
    gen_random_uuid()::text,
    NEW.id,
    CASE WHEN NEW.is_yetim = 1 THEN 0 ELSE 500 END,
    0,
    CASE WHEN NEW.is_yetim = 1 THEN 'exempted' ELSE 'unpaid' END,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_student_fee ON students;
CREATE TRIGGER trg_new_student_fee
AFTER INSERT ON students
FOR EACH ROW
EXECUTE FUNCTION handle_new_student_fee();

-- Done! 🎉
