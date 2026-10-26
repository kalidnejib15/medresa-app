/**
 * Returns the LOCAL calendar date (YYYY-MM-DD) for the given Date.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

export const ETHIOPIC_MONTHS = [
  'መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'
];

/** Stored in `payments.target_month` for payments towards previous-year debt. */
export const PREV_YEAR_ARREARS_LABEL = 'ያለፈው ዓመት ውዝፍ';

export interface EthiopicDate {
  year: number;
  monthIndex: number;
  monthName: string;
  day: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ethiopian leap years are those where year % 4 === 3 (Pagume has 6 days). */
const ethYearLength = (y: number) => (y % 4 === 3 ? 366 : 365);

/**
 * Gregorian → Ethiopic date converter.
 * Anchor: Meskerem 1, 2016 E.C. = 12 Sept 2023 G.C.
 */
export const toEthiopicDate = (date: Date = new Date()): EthiopicDate => {
  // Use the LOCAL calendar day, then do the arithmetic in UTC so DST can never shift the count.
  const utcDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const baseDay = Date.UTC(2023, 8, 12);

  let dayOfYear = Math.round((utcDay - baseDay) / DAY_MS) + 1;
  let year = 2016;

  while (dayOfYear > ethYearLength(year)) {
    dayOfYear -= ethYearLength(year);
    year++;
  }
  while (dayOfYear <= 0) {
    year--;
    dayOfYear += ethYearLength(year);
  }

  let monthIndex: number;
  let day: number;
  if (dayOfYear > 360) {
    monthIndex = 12; // Pagume
    day = dayOfYear - 360;
  } else {
    monthIndex = Math.floor((dayOfYear - 1) / 30);
    day = ((dayOfYear - 1) % 30) + 1;
  }

  return { year, monthIndex, monthName: ETHIOPIC_MONTHS[monthIndex], day };
};

export interface PaymentMonthOption {
  key: string;
  label: string;
  kind: 'current' | 'past' | 'future' | 'arrears';
  monthIndex: number;   // -1 for previous-year arrears
  paid: number;         // already paid towards this month (this Ethiopian year)
  remaining: number;    // still owed for this month / arrears (0 if monthly fee unknown)
  disabled?: boolean;   // e.g. arrears chip when the student has no arrears
}

/**
 * Builds the month choices shown when recording a payment:
 *   1. Current Ethiopian month (always first → auto-selected)
 *   2. Past months of the current year that are still unpaid/partial (most recent first)
 *   3. Upcoming months that can be prepaid (nearest first)
 *   4. Previous-year arrears
 *
 * @param paidByMonth   sum of payments this Ethiopian year, keyed by target_month label
 * @param monthlyFee    monthly fee amount; if 0/unknown a past month counts as unpaid only when nothing was paid
 * @param prevYearArrears outstanding previous-year debt for this student
 */
export const getPaymentMonthOptions = ({
  date = new Date(),
  paidByMonth,
  monthlyFee,
  prevYearArrears,
  upcomingMonths = 3
}: {
  date?: Date;
  paidByMonth: Record<string, number>;
  monthlyFee: number;
  prevYearArrears: number;
  /** how many following months (up to ነሐሴ) can be prepaid; 0 disables prepayment */
  upcomingMonths?: number;
}): PaymentMonthOption[] => {
  const cur = toEthiopicDate(date);
  const paidFor = (name: string) => paidByMonth[name] || 0;
  const remainingFor = (name: string) =>
    monthlyFee > 0 ? Math.max(0, monthlyFee - paidFor(name)) : 0;

  const options: PaymentMonthOption[] = [
    {
      key: `MONTH_${cur.monthIndex}`,
      label: cur.monthName,
      kind: 'current',
      monthIndex: cur.monthIndex,
      paid: paidFor(cur.monthName),
      remaining: remainingFor(cur.monthName)
    }
  ];

  for (let i = cur.monthIndex - 1; i >= 0; i--) {
    const name = ETHIOPIC_MONTHS[i];
    const paid = paidFor(name);
    const isUnpaid = monthlyFee > 0 ? paid < monthlyFee : paid <= 0;
    if (isUnpaid) {
      options.push({
        key: `MONTH_${i}`,
        label: name,
        kind: 'past',
        monthIndex: i,
        paid,
        remaining: remainingFor(name)
      });
    }
  }

  // Upcoming months (prepayment), nearest first. Pagume is not a fee month.
  for (let i = cur.monthIndex + 1; i <= Math.min(11, cur.monthIndex + upcomingMonths); i++) {
    const name = ETHIOPIC_MONTHS[i];
    const paid = paidFor(name);
    const isUnpaid = monthlyFee > 0 ? paid < monthlyFee : paid <= 0;
    if (isUnpaid) {
      options.push({
        key: `MONTH_${i}`,
        label: name,
        kind: 'future',
        monthIndex: i,
        paid,
        remaining: remainingFor(name)
      });
    }
  }

  options.push({
    key: 'PREV_YEAR_ARREARS',
    label: PREV_YEAR_ARREARS_LABEL,
    kind: 'arrears',
    monthIndex: -1,
    paid: 0,
    remaining: Math.max(0, prevYearArrears),
    disabled: prevYearArrears <= 0
  });

  return options;
};

/** @deprecated use getPaymentMonthOptions (this version lists ALL past months, paid or not). */
export const getAvailablePaymentMonths = (date: Date = new Date()) => {
  const currentEth = toEthiopicDate(date);
  return {
    currentEthYear: currentEth.year,
    currentMonth: {
      key: `MONTH_${currentEth.monthIndex}`,
      label: currentEth.monthName,
      isCurrent: true,
      isArrears: false,
      monthIndex: currentEth.monthIndex
    },
    pastMonthsInYear: ETHIOPIC_MONTHS.slice(0, currentEth.monthIndex).map((name, idx) => ({
      key: `MONTH_${idx}`, label: name, isArrears: false, monthIndex: idx
    })),
    arrears: { key: 'PREV_YEAR_ARREARS', label: PREV_YEAR_ARREARS_LABEL, isArrears: true, monthIndex: -1 }
  };
};
