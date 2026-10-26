import type { SQLiteDatabase } from 'expo-sqlite';
import { toEthiopicDate } from './dateUtils';

async function hasColumn(db: SQLiteDatabase, table: string, column: string) {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

/**
 * Fees v2: adds the columns the fee screen depends on. Idempotent (safe to run on every launch).
 * Call it at the END of runMigrations(db) in database.ts:
 *
 *     await migrateFeesV2(db);
 *
 * NOTE: do not call getDatabase()/queueSync() in here – this runs while the DB is still initialising.
 */
export async function migrateFeesV2(db: SQLiteDatabase): Promise<void> {
  const columns: [string, string, string][] = [
    ['fees', 'prev_year_debt', 'REAL DEFAULT 0'],
    ['payments', 'target_month', 'TEXT'],
    ['payments', 'is_arrears', 'INTEGER DEFAULT 0'],
    ['payments', 'eth_year', 'INTEGER']
  ];
  for (const [table, column, def] of columns) {
    if (!(await hasColumn(db, table, column))) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  }

  // Backfill existing payments: treat each as paid on time for the Ethiopian month it was received in.
  const legacy = await db.getAllAsync<{ id: string; paid_date: string }>(
    `SELECT id, paid_date FROM payments WHERE eth_year IS NULL`
  );
  if (legacy.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const p of legacy) {
      const d = new Date(p.paid_date);
      if (isNaN(d.getTime())) continue;
      const eth = toEthiopicDate(d);
      await db.runAsync(
        `UPDATE payments
         SET eth_year = ?, target_month = COALESCE(target_month, ?), is_arrears = COALESCE(is_arrears, 0), synced = 0
         WHERE id = ?`,
        [eth.year, eth.monthName, p.id]
      );
      // Queue for upload so a later cloud pull cannot overwrite the backfill with NULLs.
      await db.runAsync(
        `INSERT INTO sync_log (table_name, record_id, action)
         SELECT 'payments', ?, 'update'
         WHERE NOT EXISTS (SELECT 1 FROM sync_log WHERE table_name = 'payments' AND record_id = ? AND action = 'update')`,
        [p.id, p.id]
      );
    }
  });
}
