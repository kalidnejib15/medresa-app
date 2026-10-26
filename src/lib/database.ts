import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { migrateFeesV2 } from './feesMigration';

let _db: SQLite.SQLiteDatabase | null = null;
let _dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  // If already initialized, return immediately
  if (_db) return _db;
  // If initialization is in progress, wait for it (prevents concurrent init races)
  if (_dbInitPromise) return _dbInitPromise;
  // Start the single initialization
  _dbInitPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync('medersa_v4.db');
      // Enable WAL first so concurrent reads don't block
      await db.runAsync('PRAGMA journal_mode = WAL');
      await db.runAsync('PRAGMA foreign_keys = ON');
      await initSchema(db);
      await runMigrations(db);
      _db = db;
      return db;
    } catch (e) {
      // 🛡️ FIX: previously a failed first attempt (locked db during hot-reload, a
      // transient hiccup, etc.) left this rejected promise cached forever — every
      // later call (boot, sync, repair, the sync-status poller) just re-awaited the
      // same dead promise and rethrew the exact same stale error, making four
      // unrelated call sites look like four different bugs. Reset the cache so the
      // next call gets a genuine fresh attempt instead of an echo of this one.
      _dbInitPromise = null;
      _db = null;
      throw e;
    }
  })();
  return _dbInitPromise;
}

/**
 * Explicit helper for app boot initialization
 */
export async function initDatabase() {
  return getDatabase();
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('admin','ustaz','finance','committee')),
      password_hash TEXT NOT NULL,
      is_active   INTEGER DEFAULT 1,
      synced      INTEGER DEFAULT 0,
      kitab_teams TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS levels (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      name_am     TEXT NOT NULL,
      gender      TEXT NOT NULL CHECK(gender IN ('male','female')),
      description TEXT,
      synced      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teacher_levels (
      teacher_id  TEXT NOT NULL,
      level_id    TEXT NOT NULL,
      synced      INTEGER DEFAULT 0,
      PRIMARY KEY (teacher_id, level_id),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS time_blocks (
      id          TEXT PRIMARY KEY,
      level_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      name_am     TEXT NOT NULL,
      start_time  TEXT NOT NULL,
      end_time    TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('medresa','kitab')),
      synced      INTEGER DEFAULT 0,
      FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS students (
      id          TEXT PRIMARY KEY,
      name_am     TEXT NOT NULL,
      name_en     TEXT NOT NULL,
      dob         TEXT,
      school_level TEXT,
      gender      TEXT NOT NULL CHECK(gender IN ('male','female')),
      level_id    TEXT NOT NULL,
      enroll_date         TEXT NOT NULL,
      photo_url           TEXT,
      quran_teacher_id    TEXT,
      kitab_teacher_id    TEXT,
      is_yetim            INTEGER DEFAULT 0,
      is_active           INTEGER DEFAULT 1,
      last_page_learnt    TEXT,
      has_tutor           INTEGER DEFAULT 0,
      tutor_days          TEXT,
      tutor_arrival_time  TEXT,
      academic_year       TEXT DEFAULT '2019',
      notes               TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now')),
      synced              INTEGER DEFAULT 0,
      FOREIGN KEY (level_id) REFERENCES levels(id),
      FOREIGN KEY (quran_teacher_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (kitab_teacher_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS student_private (
      student_id        TEXT PRIMARY KEY,
      parent_name       TEXT,
      parent_phone      TEXT,
      address           TEXT,
      emergency_contact TEXT,
      medical_notes     TEXT,
      synced            INTEGER DEFAULT 0,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id            TEXT PRIMARY KEY,
      student_id    TEXT NOT NULL,
      date          TEXT NOT NULL,
      time_block_id TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      marked_by     TEXT NOT NULL,
      notes         TEXT,
      synced        INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(student_id, date, time_block_id, marked_by)
    );


    CREATE TABLE IF NOT EXISTS fees (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      amount_due  REAL NOT NULL,
      amount_paid REAL DEFAULT 0,
      due_date    TEXT,
      status      TEXT NOT NULL CHECK(status IN ('paid','partial','unpaid','exempted')),
      notes       TEXT,
      synced      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      message       TEXT NOT NULL,
      sender        TEXT NOT NULL,
      type          TEXT DEFAULT 'general',
      created_at    TEXT DEFAULT (datetime('now')),
      is_read       INTEGER DEFAULT 0,
      is_notified   INTEGER DEFAULT 0,
      color         TEXT,
      synced        INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      id               TEXT PRIMARY KEY,
      fee_id           TEXT NOT NULL,
      amount           REAL NOT NULL,
      paid_date        TEXT NOT NULL,
      received_by      TEXT NOT NULL,
      payment_method   TEXT DEFAULT 'cash', 
      reference_number TEXT,
      is_verified      INTEGER DEFAULT 1,
      notes            TEXT,
      synced           INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (fee_id) REFERENCES fees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      name_am     TEXT NOT NULL,
      level_id    TEXT,
      is_yetim    INTEGER DEFAULT 0,
      is_active   INTEGER DEFAULT 1,
      synced      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS teacher_student_links (
      teacher_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      subject_id TEXT,
      type       TEXT DEFAULT 'kitab',
      group_name TEXT,
      synced     INTEGER DEFAULT 0,
      PRIMARY KEY (teacher_id, student_id, subject_id),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS teacher_subjects (
      teacher_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      synced     INTEGER DEFAULT 0,
      PRIMARY KEY (teacher_id, subject_id),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS grade_weights (
      id          TEXT PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      level_id    TEXT,
      name        TEXT NOT NULL,
      weight      REAL NOT NULL,
      synced      INTEGER DEFAULT 0,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_grades (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      weight_id   TEXT NOT NULL,
      score       REAL NOT NULL,
      ustaz_id    TEXT NOT NULL,
      date        TEXT NOT NULL,
      synced      INTEGER DEFAULT 0,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (weight_id) REFERENCES grade_weights(id) ON DELETE CASCADE,
      FOREIGN KEY (ustaz_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS student_progress (
      id              TEXT PRIMARY KEY,
      student_id      TEXT NOT NULL,
      ustaz_id        TEXT NOT NULL,
      date            TEXT NOT NULL,
      page_number     TEXT,
      ayah_from       TEXT,
      ayah_to         TEXT,
      lesson_details  TEXT,
      rating          INTEGER DEFAULT 0,
      ustaz_notes     TEXT,
      level_id        TEXT,
      synced          INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (ustaz_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS nuraniyah_assessments (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      date        TEXT NOT NULL,
      category    TEXT NOT NULL,
      rating      TEXT NOT NULL CHECK(rating IN ('excellent','good','needs_work')),
      ustaz_id    TEXT NOT NULL,
      notes       TEXT,
      synced      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(student_id, date, category),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (ustaz_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id            TEXT PRIMARY KEY,
      teacher_id    TEXT NOT NULL,
      date          TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      arrival_time  TEXT,
      marked_by     TEXT NOT NULL,
      notes         TEXT,
      synced        INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(teacher_id, date)
    );

    CREATE TABLE IF NOT EXISTS student_teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      emoji       TEXT DEFAULT '👥',
      team_type   TEXT NOT NULL DEFAULT 'quran' CHECK(team_type IN ('quran','kitab')),
      ustaz_id    TEXT NOT NULL,
      level_id    TEXT,
      notes       TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      synced      INTEGER DEFAULT 0,
      FOREIGN KEY (ustaz_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_team_members (
      team_id     TEXT NOT NULL,
      student_id  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      synced      INTEGER DEFAULT 0,
      PRIMARY KEY (team_id, student_id),
      FOREIGN KEY (team_id) REFERENCES student_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id  TEXT NOT NULL,
      action     TEXT NOT NULL CHECK(action IN ('insert','update','delete')),
      retry_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await runMigrations(db);
  await forceSyncLevels(db);
  await seedDefaults(db);
  await seedSubjectsAndLinks(db);

  // 🛡️ LEDGER ENFORCEMENT: Ensure all non-yetim students exist in the fees table
  await db.runAsync(`
    INSERT OR IGNORE INTO fees (id, student_id, amount_due, amount_paid, status)
    SELECT 'fee_' || id, id, 500, 0, 'unpaid'
    FROM students
    WHERE is_yetim = 0 AND id NOT IN (SELECT student_id FROM fees)
  `);
}

async function seedSubjectsAndLinks(db: SQLite.SQLiteDatabase): Promise<void> {
  const SUBJECT_MAP = [
    { phone: '0911000001', subjectId: 's6' },  // Kalid  -> Adab
    { phone: '0911000002', subjectId: 's4' },  // Nurhuseen -> Aqidah
    { phone: '0911000003', subjectId: 's7' },  // Sudeys -> Sira
    { phone: '0911000004', subjectId: 's1' },  // Huzeyfa -> Quran
    { phone: '0911000005', subjectId: 's1' },  // Abdulbasit -> Quran
  ];

  for (const { phone, subjectId } of SUBJECT_MAP) {
    const teacher = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ?', [phone]);
    if (!teacher) continue;

    // 1. Link Teacher to Subject (Marked as synced=1 to avoid startup loop)
    await db.runAsync('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id, synced) VALUES (?,?,1)', [teacher.id, subjectId]);

    // 2. Link Teacher to all students (Unified Kitab Approach) (Marked as synced=1 to avoid startup loop)
    await db.runAsync(
      `INSERT OR IGNORE INTO teacher_student_links (teacher_id, student_id, subject_id, type, synced)
       SELECT ?, id, ?, 'kitab', 1 FROM students WHERE is_active = 1`,
      [teacher.id, subjectId]
    );
  }
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // 🛡️ HIGH PRIORITY SYNC ALIGNMENT: Ensure fees table has timestamps BEFORE sync starts
  try {
    const feeCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fees)');
    if (!feeCols.some(c => c.name === 'created_at')) {
      await db.runAsync(`ALTER TABLE fees ADD COLUMN created_at TEXT DEFAULT '2026-06-30'`);
      console.log('✅ [Migration] Added created_at to fees table.');
    }
    if (!feeCols.some(c => c.name === 'updated_at')) {
      await db.runAsync(`ALTER TABLE fees ADD COLUMN updated_at TEXT DEFAULT '2026-06-30'`);
      console.log('✅ [Migration] Added updated_at to fees table.');
    }
  } catch (e) { console.error('Migration pre-check error:', e); }

  // ☢️ NUCLEAR UPGRADE: Recreate users table to support 'committee' role in CHECK constraint
  try {
    const dbInfo = await db.getFirstAsync<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (dbInfo && !dbInfo.sql.includes("'committee'")) {
      console.log('☢️ [Migration] Upgrading Users table for Committee role...');
      await db.execAsync(`
          PRAGMA foreign_keys = OFF;
          BEGIN TRANSACTION;
          CREATE TABLE users_new (
            id            TEXT PRIMARY KEY,
            username      TEXT UNIQUE,
            name          TEXT NOT NULL,
            phone         TEXT NOT NULL,
            role          TEXT NOT NULL CHECK(role IN ('admin','ustaz','finance','committee')),
            password_hash TEXT NOT NULL,
            is_active     INTEGER DEFAULT 1,
            synced        INTEGER DEFAULT 0,
            kitab_teams   TEXT,
            created_at    TEXT DEFAULT (datetime('now'))
          );
          -- Copy data using named columns to be safe
          INSERT INTO users_new (id, username, name, phone, role, password_hash, is_active, synced, kitab_teams, created_at)
          SELECT id, username, name, phone, role, password_hash, is_active, synced, kitab_teams, created_at FROM users;
          
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
          
          -- 🧹 EARLY DEEP CLEAN: Ensure everything starts clean before Sync starts
          DELETE FROM sync_log WHERE table_name IN ('users', 'teacher_subjects', 'teacher_levels', 'teacher_student_links');
          UPDATE users SET synced = 1;
          UPDATE teacher_subjects SET synced = 1;
          UPDATE teacher_levels SET synced = 1;
          UPDATE teacher_student_links SET synced = 1;

          COMMIT;
          PRAGMA foreign_keys = ON;
        `);
      console.log('✅ [Migration] Users table successfully upgraded and sync state cleaned.');
    }
  } catch (e) {
    console.warn('Users role migration failed:', e);
    await db.execAsync('ROLLBACK;').catch(() => { });
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  // 🧱 STEP 1: Add the column if it somehow doesn't exist (Backup safety)
  try {
    await db.runAsync(`ALTER TABLE users ADD COLUMN username TEXT`);
  } catch (e) { }

  try {
    await db.runAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  } catch (e) { }

  // 🛡️ REPAIR STEP: Fail-safe to ensure everyone has a username
  try {
    await db.runAsync(`UPDATE users SET username = phone WHERE username IS NULL OR username = ''`);
  } catch (e) { }

  // Silent migrations for older schema versions
  const queries = [
    "ALTER TABLE users ADD COLUMN kitab_teams TEXT;",
    "ALTER TABLE teacher_student_links ADD COLUMN subject_id TEXT;",
    "ALTER TABLE teacher_student_links ADD COLUMN group_name TEXT;",
    "ALTER TABLE sync_log ADD COLUMN retry_count INTEGER DEFAULT 0;",
    "ALTER TABLE payments ADD COLUMN payment_method TEXT DEFAULT 'cash';",
    "ALTER TABLE payments ADD COLUMN reference_number TEXT;",
    "ALTER TABLE payments ADD COLUMN is_verified INTEGER DEFAULT 1;",
    "ALTER TABLE students ADD COLUMN is_yetim INTEGER DEFAULT 0;",
    "ALTER TABLE students ADD COLUMN school_level TEXT;",
    "ALTER TABLE students ADD COLUMN last_page_learnt TEXT;",
    "ALTER TABLE students ADD COLUMN has_tutor INTEGER DEFAULT 0;",
    "ALTER TABLE students ADD COLUMN tutor_days TEXT;",
    "ALTER TABLE students ADD COLUMN tutor_arrival_time TEXT;",
    "ALTER TABLE students ADD COLUMN academic_year TEXT DEFAULT '2019';",
    "ALTER TABLE student_progress ADD COLUMN ustaz_id TEXT;",
    "ALTER TABLE teacher_subjects ADD COLUMN synced INTEGER DEFAULT 0;",
    "ALTER TABLE teacher_levels ADD COLUMN synced INTEGER DEFAULT 0;",
    "ALTER TABLE teacher_student_links ADD COLUMN synced INTEGER DEFAULT 0;",
    "DELETE FROM sync_log WHERE id NOT IN (SELECT MAX(id) FROM sync_log GROUP BY table_name, record_id, action);",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_log_unique ON sync_log(table_name, record_id, action);",
    // ✅ PERMANENT FIX: Clear dirty-record loop for ALL composite-key tables.
    // Sync always completes with ✅ [Sync Success], confirming cloud has all records.
    // The old sync engine had a bug where it never marked these as synced=1 after push.
    "UPDATE teacher_subjects SET synced = 1;",
    "UPDATE teacher_levels SET synced = 1;",
    "ALTER TABLE student_teams ADD COLUMN emoji TEXT DEFAULT '👥';",
    "ALTER TABLE student_teams ADD COLUMN team_type TEXT NOT NULL DEFAULT 'quran';",
    "UPDATE teacher_student_links SET synced = 1;",
    "UPDATE users SET synced = 1;",
    "DELETE FROM sync_log WHERE table_name IN ('users', 'teacher_subjects','teacher_levels','teacher_student_links');"
  ];
  for (const q of queries) {
    try { await db.runAsync(q); } catch (_) { }
  }

  // 🛡️ UNIVERSAL SYNC SHIELD: Ensure EVERY table has the synced column to prevent prepareAsync crashes
  const syncTables = [
    'users', 'settings', 'levels', 'teacher_levels', 'time_blocks',
    'students', 'student_private', 'attendance', 'fees', 'announcements',
    'payments', 'subjects', 'teacher_student_links', 'teacher_subjects',
    'grade_weights', 'student_grades', 'student_progress',
    'nuraniyah_assessments', 'teacher_attendance'
  ];

  for (const t of syncTables) {
    try {
      const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`);

      // 🩹 ANNOUNCEMENT COLUMN REPAIR: Safely add any missing columns (no table rebuild = no locks)
      if (t === 'announcements' && info.length > 0) {
        const annCols = info.map(c => c.name);
        if (!annCols.includes('message')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN message TEXT DEFAULT ''`).catch(() => { });
        if (!annCols.includes('sender')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN sender TEXT DEFAULT 'Admin'`).catch(() => { });
        if (!annCols.includes('type')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN type TEXT DEFAULT 'general'`).catch(() => { });
        if (!annCols.includes('is_read')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN is_read INTEGER DEFAULT 0`).catch(() => { });
        if (!annCols.includes('is_notified')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN is_notified INTEGER DEFAULT 0`).catch(() => { });
        if (!annCols.includes('color')) await db.runAsync(`ALTER TABLE announcements ADD COLUMN color TEXT`).catch(() => { });
        // Backfill content -> message for old rows
        if (annCols.includes('content')) {
          await db.runAsync(`UPDATE announcements SET message = content WHERE (message IS NULL OR message = '') AND content IS NOT NULL`).catch(() => { });
          await db.runAsync(`UPDATE announcements SET sender = created_by WHERE (sender IS NULL OR sender = '') AND created_by IS NOT NULL`).catch(() => { });
        }
        console.log('✅ [Migration] Announcements columns verified/repaired.');
      }

      if (info.length > 0 && !info.some(c => (c.name || '').toLowerCase() === 'synced')) {
        await db.runAsync(`ALTER TABLE ${t} ADD COLUMN synced INTEGER DEFAULT 0`);
        console.log(`✅ [Shield] Added synced column to ${t} table.`);
      }
    } catch (e) {
      console.warn(`[Shield] Table ${t} stability check bypassed:`, e);
    }
  }

  // 🆕 KITAB PROGRESS MIGRATION: student_progress previously only ever held one record
  // per student/date/ustaz — enough for the Quran (qirat) session. Kitab sessions now
  // save their own bonus-mark entries into the same table, so a `session_type` column
  // distinguishes the two ('quran' default for all pre-existing rows, 'kitab' for new
  // afternoon-session entries) and lets a student have both on the same day without
  // one overwriting the other. Explicit PRAGMA check + loud logging instead of a
  // silently-swallowed ALTER, so a real failure here is visible instead of surfacing
  // later as a confusing "no such column" error somewhere downstream.
  try {
    const progCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(student_progress)');
    if (progCols.length > 0 && !progCols.some(c => c.name === 'session_type')) {
      await db.runAsync(`ALTER TABLE student_progress ADD COLUMN session_type TEXT NOT NULL DEFAULT 'quran'`);
      console.log('✅ [Migration] Added session_type to student_progress table.');
    }
  } catch (e) {
    console.error('❌ [Migration] Failed to add session_type to student_progress:', e);
  }

  // 🛡️ ATTENDANCE CONSTRAINT MIGRATION: Support Multi-Teacher Isolation
  try {
    const tableInfo = await db.getAllAsync<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type="table" AND name="attendance"');
    if (tableInfo.length > 0 && tableInfo[0].sql.includes('UNIQUE(student_id, date, time_block_id)') && !tableInfo[0].sql.includes('marked_by)')) {
      console.log('🩹 [Migration] Upgrading Attendance table to Multi-Teacher model...');
      await db.execAsync(`
         PRAGMA foreign_keys = OFF;
         BEGIN TRANSACTION;
         CREATE TABLE attendance_new (
           id            TEXT PRIMARY KEY,
           student_id    TEXT NOT NULL,
           date          TEXT NOT NULL,
           time_block_id TEXT NOT NULL,
           status        TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
           marked_by     TEXT NOT NULL,
           notes         TEXT,
           synced        INTEGER DEFAULT 0,
           created_at    TEXT DEFAULT (datetime('now')),
           FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
           UNIQUE(student_id, date, time_block_id, marked_by)
         );
         INSERT INTO attendance_new SELECT * FROM attendance;
         DROP TABLE attendance;
         ALTER TABLE attendance_new RENAME TO attendance;
         COMMIT;
         PRAGMA foreign_keys = ON;
       `);
      console.log('✅ [Migration] Attendance table successfully upgraded.');
    }
  } catch (e) {
    console.warn('Attendance constraint migration failed (likely already done):', e);
  }

  // 🛡️ FEES V2 MIGRATION
  try {
    await migrateFeesV2(db);
    console.log('✅ [Migration] Fees V2 schema migration executed.');
  } catch (e) {
    console.error('Fees V2 migration failed:', e);
  }
}

async function forceSyncLevels(db: SQLite.SQLiteDatabase) {
  // 1. UNIFIED SUBJECTS
  const subjects = [
    { id: 's1', name: 'Quran', name_am: 'ቁርአን' },
    { id: 's2', name: 'Nuraniya', name_am: 'ኑራኒያ' },
    { id: 's3', name: 'Fiqh', name_am: 'ፊቅህ' },
    { id: 's4', name: 'Aqidah', name_am: 'አቂዳ' },
    { id: 's5', name: 'Hadith', name_am: 'ሐዲስ' },
    { id: 's6', name: 'Adab', name_am: 'አደብ' },
    { id: 's7', name: 'Sira', name_am: 'ሲራ' },
    { id: 's8', name: 'Tawhid', name_am: 'ተውሂድ' },
  ];

  // 🛡️ THE PERMANENT SOLUTION: Nuclear Clear of legacy Nuraniya metrics
  // This breaks the sync loop by ensuring old 'Full Kitab Score' labels are purged.
  // Legacy hardcoded cleanup removed to allow Admin persistence.
  // Removed the hardcoded wipe to ensure Administrative changes persist across logins.
  // Defaults will still be seeded via INSERT OR IGNORE below without overwriting user edits.


  // Subjects: seed category names only. Admin configures all assessment weights via the UI.
  for (const s of subjects) {
    await db.runAsync('INSERT OR IGNORE INTO subjects (id, name, name_am, is_active, synced) VALUES (?,?,?,1,1)', [s.id, s.name, s.name_am]);
  }

  // 🧹 Aggressive Cleanup: If an admin has configured ANY custom 'gw_' weights for a subject,
  // completely wipe out all default seeded 'w_' weights for that specific subject.
  await db.runAsync(`
    DELETE FROM grade_weights 
    WHERE id LIKE 'w_%' 
    AND EXISTS (
      SELECT 1 FROM grade_weights gw2 
      WHERE gw2.subject_id = grade_weights.subject_id 
      AND gw2.id LIKE 'gw_%'
    )
  `);
  console.log('🧹 [Startup] Cleaned up ghost weights for admin-managed subjects.');

  // Orphan cleanup: remove grades that reference deleted weights
  await db.runAsync(`DELETE FROM student_grades WHERE weight_id NOT IN (SELECT id FROM grade_weights)`);
  await db.runAsync(`DELETE FROM sync_log WHERE table_name = 'student_grades' AND record_id NOT IN (SELECT id FROM student_grades)`);

  // 🧹 [DEACTIVATED] Deep Orphan Sweep
  // This logic was too aggressive and deleted assignments on boot before cloud sync finished.
  // We now rely on Admin UI explicitly handling deletions.
  /*
  await db.runAsync(`DELETE FROM teacher_subjects WHERE subject_id NOT IN (SELECT id FROM subjects)`);
  await db.runAsync(`DELETE FROM teacher_student_links WHERE subject_id NOT IN (SELECT id FROM subjects)`);
  await db.runAsync(`DELETE FROM grade_weights WHERE subject_id NOT IN (SELECT id FROM subjects)`);
  await db.runAsync(`DELETE FROM sync_log WHERE table_name = 'teacher_subjects' AND record_id NOT IN (SELECT teacher_id || ',' || subject_id FROM teacher_subjects)`);
  await db.runAsync(`DELETE FROM sync_log WHERE table_name = 'grade_weights' AND record_id NOT IN (SELECT id FROM grade_weights)`);
  */


  // 2. UNIFIED LEVELS (OFFICIAL NAMES)
  const levels = [
    { id: 'l1m', name: 'Nuraniya', name_am: 'ኑራኒያ', gender: 'male' },
    { id: 'l2m', name: 'Quran 1', name_am: 'ቁርአን 1', gender: 'male' },
    { id: 'l3m', name: 'Quran 2', name_am: 'ቁርአን 2', gender: 'male' },
    { id: 'l4m', name: 'Hifz', name_am: 'ሂፍዝ', gender: 'male' },
    { id: 'l1f', name: 'Nuraniya', name_am: 'ኑራኒያ', gender: 'female' },
    { id: 'l2f', name: 'Quran 1', name_am: 'ቁርአን 1', gender: 'female' },
    { id: 'l3f', name: 'Quran 2', name_am: 'ቁርአን 2', gender: 'female' },
    { id: 'l4f', name: 'Hifz', name_am: 'ሂፍዝ', gender: 'female' },
  ];

  // 🛡️ [DEACTIVATED] Forced Naming Migrations (Removed to allow Admin Customization)
  // The system used to force names like 'Nuraniya' every boot. 
  // This has been removed so Admin changes to Level names persist across restarts.

  for (const l of levels) {
    await db.runAsync('INSERT OR REPLACE INTO levels (id, name, name_am, gender, synced) VALUES (?,?,?,?,1)', [l.id, l.name, l.name_am, l.gender]);
    await db.runAsync(
      `INSERT OR IGNORE INTO time_blocks (id, level_id, name, name_am, start_time, end_time, type, synced)
       VALUES (?,?,?,?,?,?,?,1)`,
      [`tb_med_${l.id}`, l.id, 'Medresa Time', 'የምሽት ትምህርት', '08:00', '10:00', 'medresa']
    );
  }

  // 3. CLEANUP MOCK DATA ONLY (No more aggressive activity wipes)
  try {
    await db.runAsync(`DELETE FROM sync_log WHERE record_id LIKE '%mock_%'`);
    await db.runAsync(`DELETE FROM students WHERE id LIKE 'mock_%'`);

    // Cleaned up legacy identity triggers that were causing sync loops.
    // Identity verification now relies on the transactional migration block above.

    // Cleaned up legacy identity triggers that were causing sync loops.
    // Identity verification now relies on the transactional migration block above.

  } catch (e) {
    console.warn('Migration/Stability Warning:', e);
  }

  console.log('✅ Academic Foundation & Unified Identities Verified.');
}

async function seedDefaults(db: SQLite.SQLiteDatabase): Promise<void> {
  const adminHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, 'admin123');

  // 0. Default Institutional Settings
  await db.runAsync(`INSERT OR IGNORE INTO settings (key, value, synced) VALUES (?,?,1)`, ['default_fee', '500']);

  // 1. Admin Default — kept intentionally (0000 / admin123)
  await db.runAsync(
    `INSERT OR IGNORE INTO users (id, username, name, phone, role, password_hash, is_active, synced) VALUES (?,?,?,?,?,?,?,1)`,
    ['00000000-0000-0000-0000-000000000000', '0000', 'አስተዳዳሪ', '0000', 'admin', adminHash, 1]
  );

  // 🛡️ REMOVED: the hardcoded "Test Ustaz (Kalid)" and "Finance Specialist" default
  // accounts (0911000001/ustaz123 and 0001/finance123) that used to be auto-created
  // on every install. Create real ustaz/finance accounts from the admin panel
  // (Teachers screen) with your own usernames/passwords instead.

  // 2. [DEACTIVATED] Diverse Sample Students (Clean Slate)
  try {
    const hasSamples = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM students WHERE id LIKE "demo_%"');
    if (false && hasSamples?.count === 0) {
      console.log('🌱 Seeding sample students...');
      const sampleNames = [
        { en: 'Ahmed Hassan', am: 'አህመድ ሀሰን', gender: 'male', l: 'l1m' },
        { en: 'Fatima Ali', am: 'ፋጢማ አሊ', gender: 'female', l: 'l1f' },
        { en: 'Bilal Mohammed', am: 'ቢላል መሀመድ', gender: 'male', l: 'l2m' },
        { en: 'Aisha Omar', am: 'አኢሻ ዑመር', gender: 'female', l: 'l2f' },
        { en: 'Zaid Khalid', am: 'ዘይድ ካሊድ', gender: 'male', l: 'l3m' },
        { en: 'Sumaya Yasin', am: 'ሱመያ ያሲን', gender: 'female', l: 'l3f' },
        { en: 'Yusuf Ibrahim', am: 'ዩሱፍ ኢብራሂም', gender: 'male', l: 'l4m' },
        { en: 'Maryam Usman', am: 'ማርያም ኡስማን', gender: 'female', l: 'l4f' },
      ];

      for (let i = 0; i < sampleNames.length; i++) {
        const s = sampleNames[i];
        const id = `demo_std_${i}`;
        const now = new Date().toISOString();

        await db.runAsync(
          `INSERT OR REPLACE INTO students (id, name_am, name_en, dob, gender, level_id, enroll_date, quran_teacher_id, is_active, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, s.am, s.en, '2015-06-15', s.gender, s.l, now, '09110000-0001-4444-8888-000000000001', 1, now, now]
        );

        await db.runAsync(
          `INSERT OR REPLACE INTO student_private (student_id, parent_name, parent_phone, address, emergency_contact, medical_notes) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, `Parent of ${s.en}`, '0900112233', 'Addis Ababa, Bole', 'Emergency: 0900998877', 'No allergies']
        );
      }
      console.log('✅ Sample students seeded successfully.');
    }
  } catch (e) {
    console.warn('Failed to seed students:', e);
  }
}

export async function wipeAllData() {
  const db = await getDatabase();
  try {
    const { supabase } = await import('./supabase');

    // 1. GLOBAL CLOUD WIPE (Nuclear Reset)
    // We wipe the student-related tables in the cloud first
    const tablesToWipe = ['attendance', 'student_grades', 'fees', 'payments', 'student_progress', 'students'];
    for (const table of tablesToWipe) {
      const { error } = await supabase.from(table).delete().not('id', 'is', null);
      if (error) {
        console.warn(`⚠️ [Cloud Wipe Blocked] Could not delete from ${table}:`, error.message);
      }
    }

    // 2. LOCAL DEVICE WIPE
    await db.withTransactionAsync(async () => {
      const studentTables = [
        'attendance', 'student_grades', 'student_progress',
        'fees', 'payments', 'nuraniyah_assessments',
        'teacher_student_links', 'student_private', 'students', 'sync_log'
      ];
      for (const t of studentTables) {
        await db.runAsync(`DELETE FROM ${t}`);
      }
      // ONLY preserve the Staff (Admin, Ustaz, Finance)
      await db.runAsync("DELETE FROM users WHERE role NOT IN ('admin', 'ustaz', 'finance')");
    });

    console.log('☢️ GLOBAL RE-INITIALIZATION COMPLETE');
    return true;
  } catch (e) {
    console.error('Global Wipe Error:', e);
    return false;
  }
}

export async function queueSync(tableName: string, recordId: string, action: 'insert' | 'update' | 'delete' = 'insert'): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_log (table_name, record_id, action) VALUES (?,?,?)
     ON CONFLICT(table_name, record_id, action) DO UPDATE SET created_at = datetime('now'), retry_count = 0`,
    [tableName, recordId, action]
  );

  // Mark as unsynced (dirty) so the Pull logic doesn't overwrite local edits
  try {
    await db.runAsync(`UPDATE ${tableName} SET synced = 0 WHERE id = ?`, [recordId]);
  } catch (e) {
    // Some tables might not have 'synced' column or use composite PKs, handle gracefully
    if (tableName === 'teacher_student_links') {
      const [tId, sId, subId] = recordId.split(',');
      await db.runAsync('UPDATE teacher_student_links SET synced = 0 WHERE teacher_id = ? AND student_id = ? AND subject_id = ?', [tId, sId, subId]);
    } else if (tableName === 'teacher_subjects') {
      const [tId, sId] = recordId.split(',');
      await db.runAsync('UPDATE teacher_subjects SET synced = 0 WHERE teacher_id = ? AND subject_id = ?', [tId, sId]);
    } else if (tableName === 'student_team_members') {
      const [teamId, studentId] = recordId.split(',');
      await db.runAsync('UPDATE student_team_members SET synced = 0 WHERE team_id = ? AND student_id = ?', [teamId, studentId]);
    }
  }
}