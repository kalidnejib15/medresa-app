import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';
import { toEthiopicDate, ETHIOPIC_MONTHS, PREV_YEAR_ARREARS_LABEL } from '../lib/dateUtils';
import type { Fee, FeeStatus } from '../types';

interface FeeTotals {
  due: number;
  paid: number;                   // Σ fees.amount_paid (progress against amount_due)
  currentMonthCollected: number;  // በዚህ ወር የተሰበሰበ
  arrearsCollected: number;       // የተሰበሰበ ውዝፍ
  totalCollected: number;         // ጠቅላላ የተሰበሰበ (all payments this Ethiopian year)
  prevYearArrears: number;        // ያለፈው ዓመት ውዝፍ (still owed)
  currentYearUnpaid: number;      // የዚህ ዓመት ክፍያ (still owed)
}

export interface PaymentLine {
  targetMonth: string; // Ethiopian month name or PREV_YEAR_ARREARS_LABEL
  amount: number;
}

interface FeeState {
  fees: Fee[];
  isLoading: boolean;
  totals: FeeTotals;
  fetchFees: (filter?: string) => Promise<void>;
  addPayment: (
    feeId: string,
    amount: number,
    receivedBy: string,
    method?: 'cash' | 'bank',
    reference?: string,
    targetMonth?: string,
    isArrears?: boolean
  ) => Promise<void>;
  /** One payment split over several months (e.g. 3 months prepaid). One payment row per month. */
  addMultiMonthPayment: (
    feeId: string,
    lines: PaymentLine[],
    receivedBy: string,
    method?: 'cash' | 'bank',
    reference?: string
  ) => Promise<void>;
  editPayment: (
    paymentId: string,
    newAmount: number,
    editorUserId: string,
    reason?: string
  ) => Promise<void>;
  getPaidByMonth: (feeId: string) => Promise<Record<string, number>>;
  getRecentPayments: () => Promise<any[]>;
  verifyPayment: (paymentId: string) => Promise<void>;
  generateMonthlyFees: (amount: number) => Promise<void>;
}

const EMPTY_TOTALS: FeeTotals = {
  due: 0, paid: 0, currentMonthCollected: 0, arrearsCollected: 0,
  totalCollected: 0, prevYearArrears: 0, currentYearUnpaid: 0
};

/** Throws unless the signed-in user is admin/finance; returns the user. */
async function requireFinanceUser() {
  const user = (await import('./useAuthStore')).useAuthStore.getState().user;
  if (!user || (user.role !== 'admin' && user.role !== 'finance')) throw new Error('Unauthorized');
  return user;
}

function computeStatus(paid: number, due: number, current: FeeStatus): FeeStatus {
  if (current === 'exempted') return 'exempted';
  let status: FeeStatus = paid <= 0 ? 'unpaid' : 'partial';
  if (paid >= due) status = 'paid';
  return status;
}

/** Adds `delta` (may be negative) to fees.amount_paid and recomputes status. */
async function applyFeeDelta(db: any, feeId: string, delta: number) {
  const fee = await db.getFirstAsync('SELECT * FROM fees WHERE id = ?', [feeId]);
  if (!fee) return;
  const newPaid = Math.max(0, fee.amount_paid + delta);
  const newStatus = computeStatus(newPaid, fee.amount_due, fee.status);
  await db.runAsync(
    `UPDATE fees SET amount_paid = ?, status = ?, synced = 0 WHERE id = ?`,
    [newPaid, newStatus, feeId]
  );
  await queueSync('fees', feeId, 'update');
}

/**
 * Arrears = previous-year debt, or a month that is already over. Current and upcoming months are NOT arrears.
 */
function isArrearsTarget(targetMonth: string, currentMonthIndex: number): boolean {
  if (targetMonth === PREV_YEAR_ARREARS_LABEL) return true;
  return ETHIOPIC_MONTHS.indexOf(targetMonth) < currentMonthIndex;
}

/** Inserts one payment row per line + updates the fee once, all in a single transaction. */
async function recordPaymentLines(
  feeId: string,
  lines: PaymentLine[],
  receivedBy: string,
  method: 'cash' | 'bank',
  reference: string
): Promise<void> {
  await requireFinanceUser();

  if (lines.length === 0) throw new Error('No payment lines');
  for (const l of lines) {
    if (!Number.isFinite(l.amount) || l.amount <= 0) {
      throw new Error('Payment amount must be a positive number');
    }
    if (l.targetMonth !== PREV_YEAR_ARREARS_LABEL && !ETHIOPIC_MONTHS.includes(l.targetMonth)) {
      throw new Error('Invalid target month');
    }
  }
  if (new Set(lines.map(l => l.targetMonth)).size !== lines.length) {
    throw new Error('Duplicate month in payment');
  }

  const db = await getDatabase();
  const currentEth = toEthiopicDate(new Date());

  if (method === 'bank' && reference) {
    const existing = await db.getFirstAsync<any>('SELECT id FROM payments WHERE reference_number = ?', [reference]);
    if (existing) throw new Error('DUPLICATE_REFERENCE'); // UI shows the alert; nothing is saved
  }

  const now = new Date().toISOString(); // same timestamp on every row → lets receipts group a multi-month payment
  const total = lines.reduce((a, l) => a + l.amount, 0);

  await db.withTransactionAsync(async () => {
    for (const l of lines) {
      const paymentId = Crypto.randomUUID();
      await db.runAsync(
        `INSERT INTO payments (id, fee_id, amount, paid_date, received_by, payment_method, reference_number, target_month, is_arrears, eth_year)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          paymentId, feeId, l.amount, now, receivedBy, method, reference,
          l.targetMonth, isArrearsTarget(l.targetMonth, currentEth.monthIndex) ? 1 : 0, currentEth.year
        ]
      );
      await queueSync('payments', paymentId, 'insert');
    }
    await applyFeeDelta(db, feeId, total);
  });
}

export const useFeeStore = create<FeeState>((set, get) => ({
  fees: [],
  totals: EMPTY_TOTALS,
  isLoading: false,

  fetchFees: async (filter = 'all') => {
    set({ isLoading: true });
    try {
      const db = await getDatabase();
      const currentEth = toEthiopicDate(new Date());

      let query = `
        SELECT f.*, s.name_am, s.name_en, l.name_am as level_am, l.name as level_en,
               sp.parent_phone, sp.emergency_contact
        FROM fees f
        JOIN students s ON f.student_id = s.id
        JOIN levels l ON s.level_id = l.id
        LEFT JOIN student_private sp ON s.id = sp.student_id
      `;
      const clauses: string[] = ['s.is_active = 1'];
      if (filter === 'unpaid') clauses.push("f.status IN ('unpaid','partial')");
      if (filter === 'paid') clauses.push("f.status = 'paid'");
      query += ' WHERE ' + clauses.join(' AND ') + ' ORDER BY s.name_am ASC';

      const rows = await db.getAllAsync<any>(query);

      // Payments already made towards previous-year arrears this Ethiopian year (one query, no N+1)
      const arrearsPaidRows = await db.getAllAsync<{ fee_id: string; paid: number }>(
        `SELECT fee_id, SUM(amount) AS paid FROM payments
         WHERE target_month = ? AND eth_year = ? GROUP BY fee_id`,
        [PREV_YEAR_ARREARS_LABEL, currentEth.year]
      );
      const arrearsPaid = new Map(arrearsPaidRows.map(r => [r.fee_id, r.paid || 0]));

      const { getFallbackPhone } = await import('../lib/contactUtils');
      rows.forEach(r => {
        r.parent_phone = getFallbackPhone(r.parent_phone, r.emergency_contact);

        // amount_due already includes prev_year_debt; paying arrears must shrink the arrears figure.
        const remaining = Math.max(0, r.amount_due - r.amount_paid);
        const prevOutstanding = Math.max(0, (r.prev_year_debt || 0) - (arrearsPaid.get(r.id) || 0));
        r.prev_year_arrears = Math.min(prevOutstanding, remaining);
        r.current_year_unpaid = Math.max(0, remaining - r.prev_year_arrears);
      });

      // Collection metrics, scoped to the current Ethiopian year and active students.
      //  - current month : paid towards the current month, on time (is_arrears = 0)
      //  - arrears       : paid late for a past month, or towards previous-year debt (is_arrears = 1)
      //  - total         : every payment this year
      const stats = await db.getFirstAsync<{ current_month: number; arrears: number; total: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN p.is_arrears = 0
                              AND (p.target_month = ? OR p.target_month IS NULL OR p.target_month = '')
                             THEN p.amount ELSE 0 END), 0) AS current_month,
           COALESCE(SUM(CASE WHEN p.is_arrears = 1 THEN p.amount ELSE 0 END), 0) AS arrears,
           COALESCE(SUM(p.amount), 0) AS total
         FROM payments p
         JOIN fees f ON p.fee_id = f.id
         JOIN students s ON f.student_id = s.id
         WHERE s.is_active = 1 AND p.eth_year = ?`,
        [currentEth.monthName, currentEth.year]
      );

      const overall = await db.getFirstAsync<{ due: number; paid: number }>(
        `SELECT SUM(f.amount_due) AS due, SUM(f.amount_paid) AS paid
         FROM fees f JOIN students s ON f.student_id = s.id WHERE s.is_active = 1`
      );

      set({
        fees: rows,
        totals: {
          due: overall?.due || 0,
          paid: overall?.paid || 0,
          currentMonthCollected: stats?.current_month || 0,
          arrearsCollected: stats?.arrears || 0,
          totalCollected: stats?.total || 0,
          prevYearArrears: rows.reduce((a, r) => a + (r.prev_year_arrears || 0), 0),
          currentYearUnpaid: rows.reduce((a, r) => a + (r.current_year_unpaid || 0), 0)
        },
        isLoading: false
      });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  /** Sum of payments per target month for one fee, current Ethiopian year. */
  getPaidByMonth: async (feeId: string) => {
    const db = await getDatabase();
    const currentEth = toEthiopicDate(new Date());
    const rows = await db.getAllAsync<{ target_month: string | null; paid: number }>(
      `SELECT target_month, SUM(amount) AS paid FROM payments
       WHERE fee_id = ? AND eth_year = ? GROUP BY target_month`,
      [feeId, currentEth.year]
    );
    const out: Record<string, number> = {};
    rows.forEach(r => { if (r.target_month) out[r.target_month] = r.paid || 0; });
    return out;
  },

  /** Single-month payment. `isArrears` is ignored: it is derived from the target month. */
  addPayment: async (feeId, amount, receivedBy, method = 'cash', reference = '', targetMonth = '', _isArrears = false) => {
    const month = targetMonth || toEthiopicDate(new Date()).monthName;
    await recordPaymentLines(feeId, [{ targetMonth: month, amount }], receivedBy, method, reference);
    get().fetchFees();
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  addMultiMonthPayment: async (feeId, lines, receivedBy, method = 'cash', reference = '') => {
    await recordPaymentLines(feeId, lines, receivedBy, method, reference);
    get().fetchFees();
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  /**
   * Fix a mistaken payment WITHOUT creating a new row.
   * 1,000 → 500 ETB: the same payment row becomes 500, fees.amount_paid drops by 500,
   * and the fee status is recomputed (paid → partial/unpaid).
   */
  editPayment: async (paymentId, newAmount, editorUserId, reason = 'Adjustment') => {
    const user = await requireFinanceUser();

    if (!Number.isFinite(newAmount) || newAmount < 0) {
      throw new Error('Invalid payment amount');
    }

    const db = await getDatabase();
    const payment = await db.getFirstAsync<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) throw new Error('Payment record not found');

    const oldAmount: number = payment.amount;
    const diff = newAmount - oldAmount; // e.g. 500 - 1000 = -500
    if (diff === 0) return;

    const trail = `Edited by ${user.name ?? editorUserId}: ${reason} (${oldAmount} → ${newAmount} ETB)`;
    const notes = payment.notes ? `${payment.notes} | ${trail}` : trail;

    await db.withTransactionAsync(async () => {
      // 1. Same row, new amount. Verification no longer applies to the changed figure.
      await db.runAsync(
        `UPDATE payments SET amount = ?, notes = ?, is_verified = 0, synced = 0 WHERE id = ?`,
        [newAmount, notes, paymentId]
      );
      await queueSync('payments', paymentId, 'update');

      // 2. Move fees.amount_paid by the difference and recompute status.
      await applyFeeDelta(db, payment.fee_id, diff);
    });

    get().fetchFees();
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  getRecentPayments: async () => {
    const db = await getDatabase();
    return db.getAllAsync<any>(
      `SELECT p.*, s.name_am, s.name_en
       FROM payments p
       JOIN fees f ON p.fee_id = f.id
       JOIN students s ON f.student_id = s.id
       ORDER BY p.paid_date DESC LIMIT 50`
    );
  },

  verifyPayment: async (paymentId: string) => {
    await requireFinanceUser();
    const db = await getDatabase();
    await db.runAsync('UPDATE payments SET is_verified = 1, synced = 0 WHERE id = ?', [paymentId]);
    await queueSync('payments', paymentId, 'update');
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  },

  generateMonthlyFees: async (amount: number) => {
    await requireFinanceUser();

    const db = await getDatabase();
    await db.runAsync(`
      UPDATE fees
      SET amount_due = amount_due + ?,
          status = CASE
            WHEN amount_paid = 0 THEN 'unpaid'
            WHEN amount_paid < (amount_due + ?) THEN 'partial'
            ELSE 'paid'
          END,
          synced = 0
      WHERE student_id IN (SELECT id FROM students WHERE is_yetim = 0 AND is_active = 1)
    `, [amount, amount]);

    get().fetchFees();
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true);
  }
}));