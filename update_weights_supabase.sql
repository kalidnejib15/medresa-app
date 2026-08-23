-- 🛡️ MASTER CLOUD HARMONIZATION SCRIPT (V2 - CLEAN IDS)
-- This script aligns Supabase with the final Clean-ID 5-Pillar system.

-- 1. DELETE OLD/STALE WEIGHTS
DELETE FROM grade_weights;

-- 2. SEED UNIFIED SUBJECTS
INSERT INTO subjects (id, name, name_am, is_active) VALUES
  ('s1', 'Quran', 'ቁርአን', 1),
  ('s2', 'Nuraniya', 'ኑራኒያ', 1),
  ('s3', 'Fiqh', 'ፊቅህ', 1),
  ('s4', 'Aqidah', 'አቂዳ', 1),
  ('s5', 'Hadith', 'ሐዲስ', 1),
  ('s6', 'Adab', 'አደብ', 1),
  ('s7', 'Sira', 'ሲራ', 1),
  ('s8', 'Tawhid', 'ተውሂድ', 1)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, name_am = EXCLUDED.name_am;

-- 3. SEED NURANIYA (s2) - CLEAN IDS
INSERT INTO grade_weights (id, subject_id, name, weight) VALUES
  ('w_s2_participation_adab', 's2', 'Participation & Adab', 25),
  ('w_s2_makhraj_assignment', 's2', 'Makhraj Assignment', 10),
  ('w_s2_makhraj_quiz', 's2', 'Makhraj Quiz', 15),
  ('w_s2_midterm_exam', 's2', 'Mid-term Exam', 20),
  ('w_s2_final_exam', 's2', 'Final Exam', 30);

-- 4. SEED ALL OTHER SUBJECTS - CLEAN IDS
DO $$
DECLARE
    sid TEXT;
    subjects TEXT[] := ARRAY['s1', 's3', 's4', 's5', 's6', 's7', 's8'];
BEGIN
    FOREACH sid IN ARRAY subjects LOOP
        INSERT INTO grade_weights (id, subject_id, name, weight) VALUES
          ('w_' || sid || '_participation_kitab_mark', sid, 'Participation / Kitab Mark', 15),
          ('w_' || sid || '_midterm_exam', sid, 'Mid-term Exam', 25),
          ('w_' || sid || '_final_exam', sid, 'Final Exam', 40),
          ('w_' || sid || '_assignment', sid, 'Assignment', 10),
          ('w_' || sid || '_quiz', sid, 'Quiz', 10);
    END LOOP;
END $$;
