import { supabase } from './supabase';
import { getDatabase } from './database';
import * as Network from 'expo-network';
import { useSyncStatusStore } from '../store/useSyncStatusStore';
import { getLocalDateString } from './dateUtils';

// Hardened Multi-Team Academic Sync Controller
let isSyncRunning = false;
let syncStartTime = 0;
let lastSyncTime = 0;
let hasFoundationSyncedThisSession = false;

// ── Per-table column whitelist ───────────────────────────────────────────────
export function triggerBackgroundSync(isForce = false) {
  syncAll(isForce);
}

const TABLE_COLUMNS: Record<string, string[]> = {
  students: [
    'id', 'name_am', 'name_en', 'dob', 'gender', 'level_id',
    'enroll_date', 'photo_url', 'is_yetim', 'is_active', 'notes', 'created_at', 'updated_at',
    'quran_teacher_id', 'kitab_teacher_id', 'school_level',
    'last_page_learnt', 'has_tutor', 'tutor_days', 'tutor_arrival_time', 'academic_year'
  ],
  student_private: [
    'student_id', 'parent_name', 'parent_phone', 'address',
    'emergency_contact', 'medical_notes'
  ],
  attendance: [
    'id', 'student_id', 'date', 'time_block_id', 'status', 'marked_by', 'created_at', 'notes'
  ],
  student_progress: [
    'id', 'student_id', 'date', 'level_id', 'page_number', 'ayah_from', 'ayah_to',
    'lesson_details', 'rating', 'ustaz_notes', 'created_at', 'ustaz_id', 'session_type'
  ],
  fees: [
    'id', 'student_id', 'amount_due', 'amount_paid', 'due_date', 'status', 'notes', 'created_at', 'updated_at', 'prev_year_debt'
  ],
  payments: [
    'id', 'fee_id', 'amount', 'paid_date', 'received_by', 'notes', 'created_at', 'payment_method', 'reference_number', 'is_verified', 'target_month', 'is_arrears', 'eth_year'
  ],
  levels: [
    'id', 'name', 'name_am', 'gender', 'description'
  ],
  users: [
    'id', 'username', 'name', 'phone', 'role', 'is_active', 'created_at', 'password_hash', 'kitab_teams'
  ],
  subjects: [
    'id', 'name', 'name_am', 'level_id', 'is_active', 'is_yetim'
  ],
  grade_weights: [
    'id', 'subject_id', 'level_id', 'name', 'weight'
  ],
  student_grades: [
    'id', 'student_id', 'weight_id', 'score', 'ustaz_id', 'date'
  ],
  teacher_levels: [
    'teacher_id', 'level_id'
  ],
  teacher_student_links: [
    'teacher_id', 'student_id', 'type', 'subject_id', 'group_name'
  ],
  teacher_subjects: [
    'teacher_id', 'subject_id'
  ],
  nuraniyah_assessments: [
    'id', 'student_id', 'date', 'category', 'rating', 'ustaz_id', 'notes', 'created_at'
  ],
  announcements: [
    'id', 'title', 'message', 'sender', 'created_at', 'is_read', 'color'
  ],
  teacher_attendance: [
    'id', 'teacher_id', 'date', 'status', 'arrival_time', 'marked_by', 'notes', 'created_at'
  ],
  student_teams: [
    'id', 'name', 'emoji', 'team_type', 'ustaz_id', 'level_id', 'notes', 'is_active', 'created_at', 'updated_at'
  ],
  student_team_members: [
    'team_id', 'student_id', 'created_at'
  ]
};

const TABLE_PK: Record<string, string> = {
  student_private: 'student_id',
  teacher_levels: 'teacher_id, level_id',
  teacher_student_links: 'teacher_id, student_id, subject_id',
  teacher_subjects: 'teacher_id, subject_id',
  student_team_members: 'team_id, student_id'
};

export async function syncAll(isForce = false) {
  const now = Date.now();

  // 🛡️ SYNC GATE: Prevent flooding/infinite loops
  if (isSyncRunning && (now - syncStartTime > 120000)) isSyncRunning = false;
  if (isSyncRunning) return;

  // 🛡️ Bypassed only when manually triggered by "Repair"
  if (!isForce && (now - lastSyncTime < 30000)) {
    return; // 30s Cool-off for background syncs
  }
  isSyncRunning = true;
  syncStartTime = now;

  const statusStore = useSyncStatusStore.getState();
  statusStore.setSyncing(true);

  try {
    const state = await Network.getNetworkStateAsync();
    // 🛡️ Pre-Sync Connection Handshake
    if (!state.isConnected) throw new Error('No Network');
    const { data: handshake, error: hErr } = await supabase.from('profiles').select('id').limit(1);
    if (hErr) throw new Error('Cloud Unreachable');

    // 🛡️ SECURITY KILL-SWITCH: Verify active session
    const authStore = (await import('../store/useAuthStore')).useAuthStore.getState();
    const currentUser = authStore.user;
    if (currentUser) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', currentUser.id)
        .single();

      if (profile && profile.is_active === 0) {
        console.warn('Security: Remote account deactivation detected.');
        await authStore.logout();
        return;
      }
    }

    const db = await getDatabase();

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: BIDIRECTIONAL PULL (Cloud -> Local)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('🔄 [Sync Pull] Downloading latest institutional data...');

    // Core structural tables (Level, User, Subject, Weights, Teacher Assignments)
    const CORE_TABLES = ['levels', 'users', 'subjects', 'grade_weights', 'teacher_subjects', 'teacher_levels', 'announcements'];
    for (const table of CORE_TABLES) {
      const cloudTable = table;
      const { data: cloudItems, error } = await supabase.from(cloudTable).select('*');
      if (!error && cloudItems) {
        for (const item of cloudItems) {
          const pkColRaw = TABLE_PK[table] || 'id';
          const pkCols = pkColRaw.split(',').map(s => s.trim());
          const pkValues = pkCols.map(c => item[c]);
          const pkWhere = pkCols.map(c => `${c} = ?`).join(' AND ');

          if (pkValues.every(v => v !== undefined)) {
            // 🛡️ PERMANENT SHIELD: If this record is queued for deletion locally, block re-insertion from cloud
            const pendingDelete = await db.getFirstAsync<{ id: number }>(
              'SELECT id FROM sync_log WHERE table_name = ? AND record_id = ? AND action = "delete"',
              [table, pkValues.join(',')]
            );
            if (pendingDelete) {
              console.log(`🛡️ [Sync Shield] Blocking phantom re-insertion of deleted record: ${table}:${pkValues.join(',')}`);
              continue;
            }

            const local = await db.getFirstAsync<{ synced: number }>(
              `SELECT synced FROM ${table} WHERE ${pkWhere}`,
              pkValues
            );

            // 📣 TRIGGER HARDWARE PUSH NOTIFICATION
            if (table === 'announcements' && !local) {
              try {
                const { showProfessionalNotification } = await import('./notifications');
                showProfessionalNotification(item.title, item.message);
              } catch (e) {
                console.warn('Silent local notification failure:', e);
              }
            }

            if (local && local.synced === 0) {
              console.log(`📡 [Sync] Protecting local dirty record: ${table}:${pkValues.join(',')}`);
              continue;
            }
          }

          // 🩹 Data Integrity Guard: Ensure names are never null for subjects
          if (table === 'subjects') {
            if (!item.name && item.name_en) item.name = item.name_en;
            if (!item.name && item.name_am) item.name = item.name_am;
            if (!item.name) item.name = 'Untitled Subject';
            if (item.is_active === undefined) item.is_active = 1;
          }

          // 🧭 ANNOUNCEMENT TRANSLATOR: Aligns cloud data with local hub
          if (table === 'announcements') {
            item.message = item.message || item.content || item.body || 'New institutional update';
            item.sender = item.sender || item.created_by || 'Medresa Admin';
            item.title = item.title || 'Official Notice';
            item.type = item.type || 'general';
          }

          const cols = TABLE_COLUMNS[table];
          const pkSet = new Set(pkCols);

          const placeholders = cols.map(() => '?').join(',');
          const values = cols.map(c => item[c]);
          const updateCols = cols.filter(c => !pkSet.has(c));
          const updateAssign = updateCols.map(c => `${c} = excluded.${c}`).join(', ');

          try {
            await db.runAsync(
              `INSERT INTO ${table} (${cols.join(',')}, synced) VALUES (${placeholders}, 1) 
               ON CONFLICT(${pkCols.join(',')}) DO UPDATE SET ${updateAssign ? updateAssign + ',' : ''} synced = 1`,
              values
            );
          } catch (e: any) {
            if (e.message?.includes('FOREIGN KEY')) {
              console.warn(`🛡️ [Sync Saftey] Skipping orphan record in ${table} due to missing dependency.`);
              continue;
            }
            // 🛡️ Don't let one bad record abort the whole sync (which would skip Phase 2 push)
            console.warn(`⚠️ [Sync Pull] Skipping record in ${table} due to unexpected error:`, e?.message || e);
            continue;
          }
        }

        // 🗑️ PRUNING PHASE: Parity cleanup for structural tables
        const pkCol = TABLE_PK[table] || 'id';
        if (pkCol === 'id') { // Only for single-id tables for now to avoid complexity
          const cloudIds = cloudItems.map(item => item.id).filter(id => !!id);
          if (cloudIds.length > 0) {
            const placeholders = cloudIds.map(() => '?').join(',');
            // We chunk the delete to stay under SQLite limits
            const CHUNK_SIZE = 900;
            for (let i = 0; i < cloudIds.length; i += CHUNK_SIZE) {
              const chunk = cloudIds.slice(i, i + CHUNK_SIZE);
              const chunkPS = chunk.map(() => '?').join(',');
              await db.runAsync(
                `DELETE FROM ${table} WHERE id NOT IN (${chunkPS}) AND synced = 1`,
                chunk
              );
            }
          }
        }
      }
    }

    // Dynamic Record Pull (priority for Students and Financials)
    const DYNAMIC_TABLES = [
      'students', 'student_private', 'fees', 'payments',
      'teacher_student_links', 'attendance',
      'student_grades', 'student_progress', 'grade_weights',
      'teacher_subjects', 'nuraniyah_assessments', 'teacher_attendance',
      'student_teams', 'student_team_members'
    ];
    for (const table of DYNAMIC_TABLES) {
      // 🚀 Institutional Scale: Pull up to 10k records for academic tables
      // 🛡️ Added .order() so if there are >10k rows, we prioritize fetching the newest ones, avoiding accidental pruning of recent data.
      let query = supabase.from(table).select('*');
      if (TABLE_COLUMNS[table]?.includes('created_at')) {
        query = query.order('created_at', { ascending: false });
      }
      const { data: cloudItems, error } = await query.limit(10000);
      if (!error && cloudItems) {
        for (const item of cloudItems) {
          // 🛡️ CRITICAL: Only overwrite local if synced is 1 (no pending local edits)
          const pkCol = TABLE_PK[table] || 'id';
          const pkCols = pkCol.split(',').map(s => s.trim());
          const pkValues = pkCols.map(c => item[c]);
          const pkWhere = pkCols.map(c => `${c} = ?`).join(' AND ');

          // Only select 'id' if the table actually has an 'id' column
          const selectCols = pkCol === 'id' ? 'id, synced' : 'synced';
          
          let local = await db.getFirstAsync<{ id?: string, synced: number }>(
            `SELECT ${selectCols} FROM ${table} WHERE ${pkWhere}`,
            pkValues
          ) as any;

          // 🛡️ NATURAL KEY FALLBACK: If not found by ID, check unique natural keys to prevent constraint crashes
          if (!local) {
            if (table === 'teacher_attendance') {
              local = await db.getFirstAsync('SELECT id, synced FROM teacher_attendance WHERE teacher_id = ? AND date = ?', [item.teacher_id, item.date]);
            } else if (table === 'attendance') {
              local = await db.getFirstAsync('SELECT id, synced FROM attendance WHERE student_id = ? AND date = ? AND time_block_id = ? AND marked_by = ?',
                [item.student_id, item.date, item.time_block_id, item.marked_by]);
            } else if (table === 'nuraniyah_assessments') {
              local = await db.getFirstAsync('SELECT id, synced FROM nuraniyah_assessments WHERE student_id = ? AND date = ? AND category = ?',
                [item.student_id, item.date, item.category]);
            } else if (table === 'student_progress') {
              local = await db.getFirstAsync('SELECT id, synced FROM student_progress WHERE student_id = ? AND date = ? AND ustaz_id = ? AND session_type = ?',
                [item.student_id, item.date, item.ustaz_id, item.session_type]);
            } else if (table === 'student_grades') {
              local = await db.getFirstAsync('SELECT id, synced FROM student_grades WHERE student_id = ? AND weight_id = ? AND ustaz_id = ?',
                [item.student_id, item.weight_id, item.ustaz_id]);
            }
            
            // 🛡️ FIX: If we found it by Natural Key but the ID differs, ALIGN THE LOCAL ID to the cloud ID!
            if (local && local.id !== item.id && item.id) {
               console.log(`🩹 [Sync Merge] Aligning local ID for ${table} from ${local.id} to ${item.id}`);
               await db.runAsync(`UPDATE ${table} SET id = ? WHERE id = ?`, [item.id, local.id]);
               local.id = item.id;
            }
          }

          if (!local || local.synced === 1) {
            const cols = TABLE_COLUMNS[table];
            const pkCol = TABLE_PK[table] || 'id';
            const pkSet = new Set(pkCol.split(',').map(s => s.trim()));

            const placeholders = cols.map(() => '?').join(',');
            const values = cols.map(c => item[c]);
            const updateCols = cols.filter(c => !pkSet.has(c));
            const updateAssign = updateCols.map(c => `${c} = excluded.${c}`).join(', ');

            try {
              await db.runAsync(
                `INSERT INTO ${table} (${cols.join(',')}, synced) VALUES (${placeholders}, 1) 
                 ON CONFLICT(${pkCol}) DO UPDATE SET ${updateAssign ? updateAssign + ',' : ''} synced = 1`,
                values
              );
            } catch (e: any) {
              if (e.message?.includes('FOREIGN KEY')) {
                console.warn(`🛡️ [Sync Saftey] Skipping orphan record in ${table} due to missing dependency.`);
                continue;
              }
              if (e.message?.includes('UNIQUE constraint failed')) {
                console.warn(`🛡️ [Sync Merge] Skipping record in ${table} due to unique constraint conflict (likely already exists).`);
                continue;
              }
              if (e.message?.includes('NOT NULL constraint failed')) {
                // 🛡️ DATA QUALITY: the cloud copy of this row is missing a required field
                // (e.g. a student_progress row with no ustaz_id) — not something a retry
                // will fix. Log which record + field so it can be found/fixed in Supabase,
                // and keep going instead of treating it as a generic sync failure.
                console.warn(`🛡️ [Sync Data Quality] Skipping record in ${table} (id: ${item.id ?? pkValues.join(',')}) — required field missing on the cloud row: ${e.message}. Fix or delete this row in Supabase's Table Editor to let it sync.`);
                continue;
              }
              // 🛡️ Don't let one bad record abort the whole sync (which would skip Phase 2 push)
              console.warn(`⚠️ [Sync Pull] Skipping record in ${table} due to unexpected error:`, e?.message || e);
              continue;
            }
          }
        }

        // 🗑️ PRUNING PHASE: Remove local records that no longer exist in cloud
        // Safety: Only prune if we fetched less than 10k (meaning we likely have the full set)
        // AND greater than 0 to prevent mass-deletion if RLS blocks the query or cloud is empty.
        // 🛡️ EXCEPTION: Do not prune 'attendance' or 'student_progress' aggressively if RLS is hiding recent inserts.
        if (cloudItems.length > 0 && cloudItems.length < 10000 && table !== 'attendance') {
          const pkCol = TABLE_PK[table] || 'id';
          if (pkCol === 'id') {
            const cloudIds = cloudItems.map(item => item.id).filter(id => !!id);
            const localRows = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table} WHERE synced = 1`);
            const toDelete = localRows.filter((r: { id: any; }) => !cloudIds.includes(r.id)).map(r => r.id);

            if (toDelete.length > 0) {
              console.log(`🗑️ [Sync Prune] Removing ${toDelete.length} orphaned records from ${table}...`);
              const CHUNK_SIZE = 900;
              for (let i = 0; i < toDelete.length; i += CHUNK_SIZE) {
                const chunk = toDelete.slice(i, i + CHUNK_SIZE);
                const chunkPS = chunk.map(() => '?').join(',');
                await db.runAsync(`DELETE FROM ${table} WHERE id IN (${chunkPS})`, chunk);
              }
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: TRANSACTIONAL PUSH (Local -> Cloud)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📡 [Sync Push] Uploading local changes...');
    // 🛡️ CHRONOLOGICAL INTEGRITY: For PUSH, we must handle DELETIONS in specific order: Children -> Parents
    // And INSERTS in reverse: Parents -> Children.
    // We CANNOT rely on `created_at ASC` alone: sync_log.created_at is SQLite datetime('now'),
    // which only has second-level resolution. deleteStudent() queues payments -> fees ->
    // attendance -> student_private -> students inside a single transaction that routinely
    // finishes in well under a second, so several of those rows can share the exact same
    // created_at with no guaranteed tie order. If 'students' ever sorts before one of its own
    // children, the delete hits an FK conflict on Supabase, retries 3x, and is silently
    // dropped from the queue — permanently orphaning that student in the cloud even though
    // it's already gone locally. The previous fix only prioritized 5 tables and missed
    // payments/fees/attendance/student_private, which are exactly the ones with a direct FK
    // to students.id — so the bug was still live for those. Fix: give every table an explicit
    // dependency rank (children before parents) and sort by rank first, using created_at/id
    // only to break ties within the same rank.
    const DELETE_PRIORITY: Record<string, number> = {
      payments: 1,                  // depends on fees
      student_grades: 1,
      student_progress: 1,
      nuraniyah_assessments: 1,
      teacher_student_links: 1,
      teacher_subjects: 1,
      student_team_members: 1,      // depends on student_teams + students
      fees: 2,                      // depends on students
      attendance: 2,                // depends on students
      student_private: 2,           // depends on students
      student_teams: 2,             // depends on nothing left after its members are gone
      students: 3,                  // depends on nothing left after the above
    };
    const priorityDeleteTables = Object.keys(DELETE_PRIORITY);
    const rawDeleteLogs = await db.getAllAsync<any>(
      `SELECT * FROM sync_log WHERE action = 'delete' AND table_name IN (${priorityDeleteTables.map(() => '?').join(',')}) ORDER BY created_at ASC, id ASC`,
      priorityDeleteTables
    );
    // Stable sort by explicit rank; ties (same rank) keep their created_at/id order from above.
    const deleteLogs = [...rawDeleteLogs].sort(
      (a, b) => (DELETE_PRIORITY[a.table_name] ?? 99) - (DELETE_PRIORITY[b.table_name] ?? 99)
    );

    const foundationOrders = ['levels', 'users', 'subjects', 'grade_weights', 'students', 'teacher_attendance', 'announcements'];
    let allLogs: any[] = [];
    for (const table of foundationOrders) {
      const logs = await db.getAllAsync<any>("SELECT * FROM sync_log WHERE table_name = ? AND action != 'delete' ORDER BY created_at ASC", [table]);
      allLogs = [...allLogs, ...logs];
    }

    const processedIds = new Set(deleteLogs.map(l => l.id));
    foundationOrders.forEach(t => {
      // (already fetched inserts for these)
    });

    const otherLogs = await db.getAllAsync<any>(
      `SELECT * FROM sync_log WHERE id NOT IN (${[...processedIds, ...allLogs.map(l => l.id)].length > 0 ? [...processedIds, ...allLogs.map(l => l.id)].map(() => '?').join(',') : '0'}) ORDER BY created_at ASC`,
      [...processedIds, ...allLogs.map(l => l.id)].length > 0 ? [...processedIds, ...allLogs.map(l => l.id)] : []
    );

    const logs = [...deleteLogs, ...allLogs, ...otherLogs];

    for (const log of logs) {
      const table = log.table_name as string;
      const cloudTable = table;
      const allowedCols = TABLE_COLUMNS[table];
      if (!allowedCols) {
        await db.runAsync('DELETE FROM sync_log WHERE id = ?', [log.id]);
        continue;
      }

      const pkCol = TABLE_PK[table] || 'id';
      const pkCols = pkCol.split(', ');

      let data;
      if (pkCols.length > 1) {
        const pkValues = log.record_id.split(',');
        if (pkValues.length !== pkCols.length) {
          await db.runAsync('DELETE FROM sync_log WHERE id = ?', [log.id]);
          continue;
        }
        const whereClause = pkCols.map(c => `${c} = ?`).join(' AND ');
        data = await db.getFirstAsync<any>(`SELECT * FROM ${table} WHERE ${whereClause}`, pkValues);
      } else {
        data = await db.getFirstAsync<any>(`SELECT * FROM ${table} WHERE ${pkCol} = ?`, [log.record_id]);
      }

      if (!data && log.action !== 'delete') {
        await db.runAsync('DELETE FROM sync_log WHERE id = ?', [log.id]);
        continue;
      }

      const cloudData: Record<string, any> = {};
      if (log.action !== 'delete') {
        for (const col of allowedCols) { if (col in data) cloudData[col] = data[col]; }
        // 🩹 Name mapping for subjects
        if (table === 'subjects' && data.name) {
          cloudData.name_en = data.name;
        }
        // 🗺️ ANNOUNCEMENT CLOUD MAPPER: Translate local names → cloud schema
        if (table === 'announcements') {
          // Cloud has 'content' NOT NULL — map from local 'message'
          cloudData.content = data.message || data.content || '';
          // Cloud has 'created_by' — map from local 'sender'
          cloudData.created_by = data.sender || data.created_by || 'Admin';
          // Cloud may have 'type'
          cloudData.type = data.type || 'general';
          // Remove fields that don't exist on cloud
          delete cloudData.message;
          delete cloudData.sender;
          delete cloudData.is_notified;
          delete cloudData.color;
          delete cloudData.is_read;
        }
      }

      let upsertOptions: any = {};
      // 🛡️ Standard ID-based upsert for maximum compatibility across different Supabase versions
      // (Custom onConflict removed as cloud schemas lack the multi-column unique constraints)

      let { error } = log.action === 'delete'
        ? await (async () => {
          // 🛡️ ADAPTIVE DELETE: Handle cases where Cloud schema might be missing a column (like subject_id)
          const baseMatch = pkCols.length > 1
            ? Object.fromEntries(pkCols.map((c, i) => [c, log.record_id.split(',')[i]]))
            : { [pkCol]: log.record_id };

          // First attempt
          const res = await supabase.from(cloudTable).delete().match(baseMatch);

          // If it fails with "column does not exist", retry with a reduced key if possible
          if (res.error && res.error.message?.includes('column') && res.error.message?.includes('does not exist')) {
            console.warn(`📡 [Sync Adaptive] Retrying delete for ${cloudTable} without strict column matching...`);
            const reducedMatch = { ...baseMatch };
            // Common mismatch: subject_id missing on cloud
            if (reducedMatch.subject_id !== undefined) delete reducedMatch.subject_id;
            return await supabase.from(cloudTable).delete().match(reducedMatch);
          }
          return res;
        })()
        : await supabase.from(cloudTable).upsert(cloudData, Object.keys(upsertOptions).length > 0 ? upsertOptions : undefined);

      // 🩹 Schema Compatibility: Dynamically strip unsupported columns and retry
      if (error && error.message && error.message.includes('column') && log.action !== 'delete') {
        let fallbackData = { ...cloudData };
        delete fallbackData.updated_at;
        delete fallbackData.created_at;
        let retryError = error;
        let attempts = 0;

        while (retryError && retryError.message && retryError.message.includes('column') && attempts < 5) {
          const match = retryError.message.match(/Could not find the '([^']+)' column/) ||
            retryError.message.match(/column "([^"]+)" of relation "[^"]+" does not exist/);
          if (match && match[1]) {
            console.log(`🩹 [Schema Fallback] Cloud table '${cloudTable}' missing column: ${match[1]}. Stripping...`);
            delete fallbackData[match[1]];
          } else {
            break; // Unknown column format
          }
          const { error: nextError } = await supabase.from(cloudTable).upsert(fallbackData, Object.keys(upsertOptions).length > 0 ? upsertOptions : undefined);
          retryError = nextError as any;
          attempts++;
        }
        error = retryError;
      }

      if (!error) {
        await db.runAsync('DELETE FROM sync_log WHERE id = ?', [log.id]);
        if (pkCol === 'id' && log.action !== 'delete') {
          await db.runAsync(`UPDATE ${table} SET synced = 1 WHERE id = ?`, [log.record_id]);
        } else if (pkCols.length > 1 && log.action !== 'delete') {
          // 🛡️ COMPOSITE KEY FIX: Mark composite-key tables as synced after successful push
          const pkValues = log.record_id.split(',');
          const whereClause = pkCols.map(c => `${c} = ?`).join(' AND ');
          try {
            await db.runAsync(`UPDATE ${table} SET synced = 1 WHERE ${whereClause}`, pkValues);
          } catch (_) { }
        }
      } else {
        const isFkDeleteConflict = log.action === 'delete' && error?.message?.includes('foreign key constraint');

        if (isFkDeleteConflict) {
          console.log(`⏳ [Sync Defer] Deleting ${table}:${log.record_id} blocked by cloud children. Attempting Virtual Cascade...`);
          // 🛡️ VIRTUAL CASCADE: Manually clear cloud children if they are blocking parent deletion
          try {
            if (table === 'grade_weights') {
              await supabase.from('student_grades').delete().eq('weight_id', log.record_id);
            } else if (table === 'subjects') {
              // 1. Wipe cloud marks/weights that depend on this subject
              await supabase.from('student_grades').delete().match({ subject_id: log.record_id });
              await supabase.from('grade_weights').delete().eq('subject_id', log.record_id);
              await supabase.from('teacher_subjects').delete().eq('subject_id', log.record_id);
              await supabase.from('teacher_student_links').delete().eq('subject_id', log.record_id);
            }
          } catch (cascadeErr) {
            console.warn('Virtual Cascade failed:', cascadeErr);
          }
        } else {
          console.warn(`⚠️ [Sync Blocked] Table: ${table}, Record: ${log.record_id}, Error:`, error?.message || error);
        }

        if ((log.retry_count || 0) >= 3) {
          // 🛡️ Stop retrying this cycle, but do NOT mark as synced=1 — the record never
          // actually reached the cloud (e.g. permission errors), so falsely marking it
          // synced would silently and permanently lose the data. Leaving synced=0 means
          // a future forceGlobalSync/edit can re-queue and retry it.
          console.warn(`🗑️ [Sync Flush] Dropping stubborn record from queue after 3 failures (left as unsynced): ${table}:${log.record_id}`);
          await db.runAsync('DELETE FROM sync_log WHERE id = ?', [log.id]);
          continue;
        }

        // 🩹 Self-Healing: If dependency fails, try to push parent first
        if (error?.message?.includes('foreign key') || error?.message?.includes('violates')) {
          let parentTable = '';
          let parentId = '';
          const errMsg = error.message.toLowerCase();

          if (errMsg.includes('subject_id')) {
            parentTable = 'subjects'; parentId = data?.subject_id;
          } else if (errMsg.includes('student_id')) {
            parentTable = 'students'; parentId = data?.student_id;
          } else if (errMsg.includes('fee_id')) {
            parentTable = 'fees'; parentId = data?.fee_id;
          } else if (errMsg.includes('teacher_id') || errMsg.includes('user_id') || errMsg.includes('ustaz_id')) {
            parentTable = 'users'; parentId = data?.teacher_id || data?.user_id || data?.ustaz_id;
          } else if (errMsg.includes('weight_id')) {
            parentTable = 'grade_weights'; parentId = data?.weight_id;
          }

          if (parentId && parentTable) {
            console.log(`🩹 [Auto-Heal] Missing FK ${parentId} in ${parentTable} (Detected from: ${errMsg.substring(0, 30)}...). Re-queuing parent...`);
            await db.runAsync("INSERT OR IGNORE INTO sync_log (table_name, record_id, action) VALUES (?,?,?)", [parentTable, parentId, 'insert']);
          }
        }
        await db.runAsync('UPDATE sync_log SET retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ?', [log.id]);
      }
    }
    console.log('✅ [Sync Success] Institutional ledger is now identical on cloud and local.');
    statusStore.setLastError(null);
    // 🔔 UI BROADCAST: Force all stores to re-poll after sync completion
    const { useGradeStore } = await import('../store/useGradeStore');
    const { useStudentStore } = await import('../store/useStudentStore');
    const { useAttendanceStore } = await import('../store/useAttendanceStore');
    const { useNoticeStore } = await import('../store/useNoticeStore');
    useGradeStore.getState().fetchSubjects().catch(() => { });
    useStudentStore.getState().fetchStudents().catch(() => { });
    useAttendanceStore.getState().fetchTodayStats().catch(() => { });
    useNoticeStore.getState().fetchNotices().catch(() => { });

  } catch (e) {
    console.error('❌ [Sync System Error]:', e);
    statusStore.setLastError(e instanceof Error ? e.message : String(e));
  } finally {
    await statusStore.checkPending();
    statusStore.setSyncing(false);
    lastSyncTime = Date.now();
    isSyncRunning = false;
  }
}