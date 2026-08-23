import { getDatabase } from './database';
import * as Crypto from 'expo-crypto';

async function hash(p: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, p);
}

// Mapping: teacher phone -> subject they teach
const TEACHER_SUBJECT_MAP: Record<string, string> = {
  '0911000001': 'Adab',    // Kalid Nejib      → Adab (s6)
  '0911000002': 'Aqidah',  // Nurhuseen Mohammed → Aqidah (s4)
  '0911000003': 'Sira',    // Sudeys Ibrahim    → Sira (s7)
};

// These three are auto-linked Kitab teachers for EVERY student
const KITAB_TEACHER_PHONES = ['0911000001', '0911000002', '0911000003'];

export async function seedMedresaData() {
  const db = await getDatabase();

  // 1. SEED USTAZS
  const teachers = [
    { name: 'Kalid Nejib',        phone: '0911000001', pass: 'pass001', teams: 'Team Quran 1, Team Hifz' },
    { name: 'Nurhuseen Mohammed', phone: '0911000002', pass: 'pass002', teams: 'Team Quran 1, Team Hifz' },
    { name: 'Sudeys Ibrahim',     phone: '0911000003', pass: 'pass003', teams: 'Team Hifz' },
    { name: 'Huzeyfa Mohammed',   phone: '0911000004', pass: 'pass004', teams: 'Team Nuraniya' },
    { name: 'Abdulbasit',         phone: '0911000005', pass: 'pass005', teams: 'Team Quran 1, Team Hifz' },

  ];

  for (const t of teachers) {
    const passwordHash = await hash(t.pass);
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', [t.phone]);
    if (existing) {
      await db.runAsync('UPDATE users SET password_hash = ?, name = ?, kitab_teams = ? WHERE id = ?', [passwordHash, t.name, t.teams, existing.id]);
    } else {
      const id = Crypto.randomUUID();
      await db.runAsync('INSERT INTO users (id, name, phone, password_hash, role, is_active, kitab_teams) VALUES (?,?,?,?,?,1,?)', [id, t.name, t.phone, passwordHash, 'ustaz', t.teams]);
    }
  }

  // 2. ENSURE ALL SUBJECTS HAVE WEIGHTS (Quiz, Mid, Final)
  const allCurrentSubjects = await db.getAllAsync<any>('SELECT * FROM subjects WHERE is_active = 1');
  
  const stdWeights = [
    { name: 'Quiz',          weight: 10 },
    { name: 'Assignment',    weight: 10 },
    { name: 'Participation', weight: 15 },
    { name: 'Mid Exam',      weight: 25 },
    { name: 'Final Exam',    weight: 40 },
  ];

  for (const s of allCurrentSubjects) {
     const existingCount = await db.getFirstAsync<{count:number}>(
       `SELECT COUNT(*) as count FROM grade_weights WHERE subject_id = ?`,
       [s.id]
     );
     
     if (existingCount && existingCount.count === 0) {
       for (const w of stdWeights) {
         const wId = `gw_${s.id.substring(0,4)}_${w.name.toLowerCase().replace(/\s/g, '_')}`;
         await db.runAsync('INSERT OR IGNORE INTO grade_weights (id, subject_id, name, weight, synced) VALUES (?,?,?,?,0)', [wId, s.id, w.name, w.weight]);
         await queueSync('grade_weights', wId, 'insert');
       }
     }
  }
  console.log(`✅ Verified standard weights for ${allCurrentSubjects.length} subjects.`);

  // 3. ASSIGN SUBJECTS TO TEACHERS (Using Unified IDs s1-s8)
  const TEACHER_LINKING = [
    { phone: '0911000001', subjectId: 's6' }, // Kalid -> Adab
    { phone: '0911000002', subjectId: 's4' }, // Nurhuseen -> Aqidah
    { phone: '0911000003', subjectId: 's7' }, // Sudeys -> Sira
    { phone: '0911000004', subjectId: 's2' }, // Huzeyfa -> Nuraniya
    { phone: '0911000005', subjectId: 's1' }, // Abdulbasit -> Quran
  ];

  for (const link of TEACHER_LINKING) {
    const teacher = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', [link.phone]);
    if (teacher) {
      await db.runAsync('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?,?)', [teacher.id, link.subjectId]);
      console.log(`✅ Assigned ${link.phone} to subject ${link.subjectId}`);
    }
  }

  // 4. AUTO-LINK ALL STUDENTS TO KALID, NURHUSEEN, SUDEYS
  const allStudents = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM students WHERE is_active = 1 AND level_id NOT IN ('l1m','l1f')"
  );

  for (const phone of KITAB_TEACHER_PHONES) {
    const teacher = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', [phone]);
    if (!teacher) continue;

    for (const student of allStudents) {
      await db.runAsync(
        'INSERT OR IGNORE INTO teacher_student_links (teacher_id, student_id, type) VALUES (?,?,?)',
        [teacher.id, student.id, 'kitab']
      );
    }
    console.log(`✅ Linked ${phone} to ${allStudents.length} students`);
  }

  console.log('✅ Medresa Core Data Seeded & Auto-Linked Successfully');
}
