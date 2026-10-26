/**
 * Splits one received amount across the months a parent is paying for.
 * Pure function (no DB, no React) so it is easy to test and reuse for receipts / reports.
 */

export interface AllocationInput {
  label: string;   // target_month value, e.g. "መስከረም" or "ያለፈው ዓመት ውዝፍ"
  cap: number;     // most this month can still take (Infinity if the monthly fee is unknown)
  order: number;   // allocation order: arrears = -1, then Ethiopian month index ascending
}

export interface AllocationLine {
  label: string;
  amount: number;
}

export interface AllocationResult {
  lines: AllocationLine[];   // only months that actually receive money
  totalAllocated: number;
  unallocated: number;       // > 0 means the amount is MORE than the selected months can absorb
  unfunded: string[];        // selected months that got nothing (amount ran out)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Oldest first: arrears, then earlier months, then the current and upcoming months. */
export function allocatePayment(total: number, months: AllocationInput[]): AllocationResult {
  let left = Number.isFinite(total) && total > 0 ? round2(total) : 0;
  const lines: AllocationLine[] = [];
  const unfunded: string[] = [];

  for (const m of [...months].sort((a, b) => a.order - b.order)) {
    if (!(m.cap > 0)) continue; // already fully paid → nothing to allocate
    const amount = round2(Math.min(left, m.cap));
    if (amount > 0) {
      lines.push({ label: m.label, amount });
      left = round2(left - amount);
    } else {
      unfunded.push(m.label);
    }
  }

  const totalAllocated = round2(lines.reduce((a, l) => a + l.amount, 0));
  return { lines, totalAllocated, unallocated: left, unfunded };
}

/** Total the selected months can still absorb, or null if any month has no known cap. */
export function totalDue(months: AllocationInput[]): number | null {
  let sum = 0;
  for (const m of months) {
    if (!Number.isFinite(m.cap)) return null;
    sum += Math.max(0, m.cap);
  }
  return round2(sum);
}
