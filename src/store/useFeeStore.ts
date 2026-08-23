import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { getDatabase, queueSync } from '../lib/database';

interface Fee {
  id: string;
  student_id: string;
  amount_due: number;
  amount_paid: number;
  status: 'paid' | 'partial' | 'unpaid' | 'exempted';
  name_am?: string;
  name_en?: string;
  parent_phone?: string;
}

interface Payment {
  id: string;
  fee_id: string;
  amount: number;
  paid_date: string;
  received_by: string;
  payment_method: 'cash' | 'bank';
  reference_number?: string;
  is_verified?: number;
}

interface FeeState {
  fees: Fee[];
  isLoading: boolean;
  fetchFees: (filter?: string) => Promise<void>;
  addPayment: (feeId: string, amount: number, receivedBy: string, method?: 'cash' | 'bank', reference?: string) => Promise<void>;
  getRecentPayments: () => Promise<any[]>;
  verifyPayment: (paymentId: string) => Promise<void>;
  generateMonthlyFees: (amount: number) => Promise<void>;
  totals: { due: number; paid: number };
}

export const useFeeStore = create<FeeState>((set, get) => ({
  fees: [],
  totals: { due: 0, paid: 0 },
  isLoading: false,

  fetchFees: async (filter = 'all') => {
    set({ isLoading: true });
    const db = await getDatabase();

    let query = `
      SELECT f.*, s.name_am, s.name_en, l.name_am as level_am, l.name as level_en,
             sp.parent_phone, sp.emergency_contact 
      FROM fees f 
      JOIN students s ON f.student_id = s.id 
      JOIN levels l ON s.level_id = l.id
      LEFT JOIN student_private sp ON s.id = sp.student_id
    `;

    // 🛡️ Soft-delete filter: every other list screen (students, dashboard, attendance)
    // already excludes s.is_active = 0. This query was missing it, so fees belonging
    // to a "deleted" (deactivated) student kept showing up here after deletion.
    const clauses: string[] = ["s.is_active = 1"];
    if (filter === 'unpaid') clauses.push("f.status != 'paid'");
    if (filter === 'paid') clauses.push("f.status = 'paid'");
    query += " WHERE " + clauses.join(" AND ");
    query += " ORDER BY s.name_am ASC";

    const rows = await db.getAllAsync<any>(query);

    // 🛡️ Call-number fallback: staff dial parent_phone from this screen, so if it was
    // never recorded, fall back to the phone half of the emergency contact taken at
    // registration rather than leaving them with nothing to call.
    const { getFallbackPhone } = await import('../lib/contactUtils');
    rows.forEach(r => { r.parent_phone = getFallbackPhone(r.parent_phone, r.emergency_contact); });

    // 🛡️ Global Stats Logic: Always calculate from whole table, ignoring UI filter —
    // but still exclude deactivated students, or their due/paid totals keep inflating
    // the dashboard numbers after they've been "deleted".
    const stats = await db.getFirstAsync<{ due: number; paid: number }>(
      `SELECT SUM(f.amount_due) as due, SUM(f.amount_paid) as paid 
       FROM fees f JOIN students s ON f.student_id = s.id 
       WHERE s.is_active = 1`
    );

    set({
      fees: rows,
      totals: { due: stats?.due || 0, paid: stats?.paid || 0 },
      isLoading: false
    });
  },

  addPayment: async (feeId, amount, receivedBy, method = 'cash', reference = '') => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin' && user?.role !== 'finance') throw new Error('Unauthorized');

    // 🛡️ FIX: input validation — previously any amount (negative, zero, or larger than
    // amount_due) was accepted with no check, which could push status to 'partial' on a
    // no-op payment or silently record an uncapped overpayment.
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Payment amount must be a positive number');
    }

    // 🛡️ DOUBLE-TAP PROTECTION (Prevents Duplicate Ledger Entries)
    // 🛡️ FIX: was keyed globally by timestamp only, so a legitimate payment for a
    // *different* student within 2s of another payment was silently dropped. Now scoped
    // per feeId so unrelated payments are never blocked.
    const nowTs = Date.now();
    const lastPaymentByFee: Record<string, number> = (global as any).__lastPaymentByFee || ((global as any).__lastPaymentByFee = {});
    if (lastPaymentByFee[feeId] && (nowTs - lastPaymentByFee[feeId] < 2000)) {
      console.warn('Blocked duplicate payment attempt for fee', feeId);
      return;
    }
    lastPaymentByFee[feeId] = nowTs;

    const db = await getDatabase();
    
    // 🛡️ ANTI-FRAUD: Check for duplicate Bank Reference ID
    if (method === 'bank' && reference) {
      const existing = await db.getFirstAsync<any>('SELECT id FROM payments WHERE reference_number = ?', [reference]);
      if (existing) {
        const { Alert } = require('react-native');
        Alert.alert(
          'Duplicate Reference (የተደገመ ማጣቀሻ)',
          'This Bank ID has already been used. Please verify the receipt.'
        );
        return;
      }
    }

    const paymentId = Crypto.randomUUID();
    const now = new Date().toISOString();

    // 1. Record payment
    await db.runAsync(
      `INSERT INTO payments (id, fee_id, amount, paid_date, received_by, payment_method, reference_number)
       VALUES (?,?,?,?,?,?,?)`,
      [paymentId, feeId, amount, now, receivedBy, method, reference]
    );
    await queueSync('payments', paymentId, 'insert');

    // 2. Update fee record
    const fee = await db.getFirstAsync<any>('SELECT * FROM fees WHERE id = ?', [feeId]);
    if (fee) {
      const newPaid = fee.amount_paid + amount;
      // 🛡️ FIX: a 0-or-below running total (edge case, e.g. amount_due is 0) now stays
      // 'unpaid' instead of jumping straight to 'partial'.
      let newStatus: 'unpaid' | 'partial' | 'paid' = newPaid <= 0 ? 'unpaid' : 'partial';
      if (newPaid >= fee.amount_due) newStatus = 'paid';

      await db.runAsync(
        `UPDATE fees SET amount_paid = ?, status = ?, synced = 0 WHERE id = ?`,
        [newPaid, newStatus, feeId]
      );
      await queueSync('fees', feeId, 'update');
    }

    // Refresh list
    get().fetchFees();

    // Trigger sync
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
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
    // 🛡️ FIX: this previously had no role check at all, unlike addPayment — any logged-in
    // user (including 'ustaz') could mark a cash payment as verified.
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin' && user?.role !== 'finance') throw new Error('Unauthorized');

    const db = await getDatabase();
    await db.runAsync('UPDATE payments SET is_verified = 1, synced = 0 WHERE id = ?', [paymentId]);
    await queueSync('payments', paymentId, 'update');

    // Trigger sync
    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  },

  generateMonthlyFees: async (amount: number) => {
    const user = (await import('./useAuthStore')).useAuthStore.getState().user;
    if (user?.role !== 'admin' && user?.role !== 'finance') throw new Error('Unauthorized');

    const db = await getDatabase();
    // 🛡️ BATCH BILLING: Increment amount_due for all non-orphans and reset status
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

    // Log the sync for all modified rows
    const modified = await db.getAllAsync<{ id: string }>('SELECT id FROM fees WHERE synced = 0');
    for (const row of modified) {
      await queueSync('fees', row.id, 'update');
    }

    const { triggerBackgroundSync } = await import('../lib/sync');
    triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
  }
}));