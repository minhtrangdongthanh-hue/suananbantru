import {
  AppEnvironment,
  GradeLevel,
  MealBillingConfig,
  MealPayment,
  MealPricingRule,
  MealRegistration,
  MealSymbolCode,
  MonthlySettlement,
  PaymentStatus,
  SCHOOL_ID,
  SchoolClass,
  Student,
} from '../types';

export interface MonthDayMeta {
  day: number;
  dayStr: string; // '01'..'31'
  dateStr: string; // 'YYYY-MM-DD'
  weekdayShort: 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'CN';
  isWeekend: boolean;
  isHoliday: boolean;
  isOffDay: boolean;
}

export interface StudentDayCell {
  day: number;
  dateStr: string;
  symbol: MealSymbolCode;
  unitPrice: number;
  amount: number;
  hasPriceConfigured: boolean;
  registration?: MealRegistration;
  isOffDay: boolean;
}

export interface PriceTierSummary {
  unitPrice: number;
  daysCount: number;
  subtotal: number;
}

export interface StudentMonthlySummary {
  student: Student;
  displayClassId: string;
  displayClassName: string;
  displayGrade: GradeLevel;
  hasTransferredClass: boolean;
  transferNote: string;
  classIdsInMonth: string[];
  dayCells: StudentDayCell[];
  xCount: number; // Số ngày đăng ký ăn (X)
  vCount: number; // Số ngày vắng (V)
  rCount: number; // Số ngày nghỉ / không đăng ký (R)
  blankCount: number; // Ô trống chưa có dữ liệu
  totalAmountDue: number;
  totalPaid: number;
  balanceRemaining: number;
  overpaidAmount: number;
  paymentStatus: PaymentStatus;
  priceTiers: PriceTierSummary[];
  primaryUnitPrice: number;
  hasMultiplePrices: boolean;
  hasMissingPrice: boolean;
  payments: MealPayment[];
}

export interface ClassMonthlySummary {
  classObj: SchoolClass;
  studentRows: StudentMonthlySummary[];
  studentCount: number;
  dayTotals: number[]; // Count of 'X' per day index 0..(daysInMonth-1)
  totalX: number;
  totalV: number;
  totalR: number;
  totalAmountDue: number;
  totalPaid: number;
  totalRemaining: number;
  totalOverpaid: number;
}

export interface GradeMonthlySummary {
  grade: GradeLevel;
  classSummaries: ClassMonthlySummary[];
  studentCount: number;
  totalX: number;
  totalV: number;
  totalR: number;
  totalAmountDue: number;
  totalPaid: number;
  totalRemaining: number;
  totalOverpaid: number;
}

export interface SchoolMonthlySummary {
  month: string; // YYYY-MM
  year: number;
  monthNum: number;
  days: MonthDayMeta[];
  settlement: MonthlySettlement | null;
  studentRows: StudentMonthlySummary[];
  classSummaries: ClassMonthlySummary[];
  gradeSummaries: GradeMonthlySummary[];
  totalStudents: number;
  totalX: number;
  totalV: number;
  totalR: number;
  totalAmountDue: number;
  totalPaid: number;
  totalRemaining: number;
  totalOverpaid: number;
  hasAnyMissingPrice: boolean;
}

export function getDefaultMealBillingConfig(
  env: AppEnvironment = 'production',
  updatedByUid = 'system'
): MealBillingConfig {
  return {
    id: `${env}_billing_config`,
    holidays: [],
    symbolXLabel: 'Có đăng ký ăn (tính 1 suất)',
    symbolVLabel: 'Học sinh vắng (không tính suất ăn)',
    symbolRLabel: 'Học sinh nghỉ / Không đăng ký ăn (không tính suất ăn)',
    symbolEmptyLabel: 'Chưa có dữ liệu (không tự động tính tiền)',
    updatedAtIso: '',
    updatedByUid,
    updatedByName: 'Hệ thống',
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };
}

export function getDaysInMonthCount(year: number, monthNum: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    return 30;
  }
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

const WEEKDAY_MAP: Record<number, 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'CN'> = {
  0: 'CN',
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
};

export function getDaysInMonthList(
  month: string,
  holidays: string[] = []
): { year: number; monthNum: number; days: MonthDayMeta[] } {
  const parts = /^(\d{4})-(\d{2})$/.exec(month);
  const year = parts ? parseInt(parts[1], 10) : 2026;
  const monthNum = parts ? parseInt(parts[2], 10) : 11;
  const count = getDaysInMonthCount(year, monthNum);
  const holidaySet = new Set(holidays || []);

  const days: MonthDayMeta[] = [];
  for (let d = 1; d <= count; d++) {
    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(monthNum).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;
    const utcDay = new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay();
    const weekdayShort = WEEKDAY_MAP[utcDay] || 'T2';
    const isWeekend = utcDay === 0 || utcDay === 6;
    const isHoliday = holidaySet.has(dateStr);
    days.push({
      day: d,
      dayStr,
      dateStr,
      weekdayShort,
      isWeekend,
      isHoliday,
      isOffDay: isWeekend || isHoliday,
    });
  }

  return { year, monthNum, days };
}

export function mapRegistrationToSymbol(
  reg: MealRegistration | undefined,
  studentActive = true
): MealSymbolCode {
  if (!reg) return '';
  if (reg.status === 'eating') return 'X';
  if (reg.status === 'unregistered') return 'R';
  // status === 'not_eating'
  const reason = (reg.adjustmentReason || '').trim().toUpperCase();
  if (reason.startsWith('[R]') || reason.startsWith('[NGHI]') || !studentActive) {
    return 'R';
  }
  return 'V';
}

function getScopePriority(scope: MealPricingRule['targetScope']): number {
  switch (scope) {
    case 'student_group':
      return 4;
    case 'class':
      return 3;
    case 'grade':
      return 2;
    case 'school':
    default:
      return 1;
  }
}

export function resolveUnitPriceForStudentOnDate(
  student: { id: string; classId: string; grade: GradeLevel },
  dateStr: string,
  rules: MealPricingRule[],
  env: AppEnvironment = 'production'
): { price: number; rule: MealPricingRule | null } {
  const candidates = (rules || []).filter((r) => {
    if (r.env !== env || !r.active) return false;
    if (!r.effectiveFrom || r.effectiveFrom > dateStr) return false;
    if (r.targetScope === 'student_group') {
      return Array.isArray(r.studentIds) && r.studentIds.includes(student.id);
    }
    if (r.targetScope === 'class') {
      return r.targetClassId === student.classId;
    }
    if (r.targetScope === 'grade') {
      return Number(r.targetGrade) === Number(student.grade);
    }
    return r.targetScope === 'school';
  });

  if (candidates.length === 0) {
    return { price: 0, rule: null };
  }

  candidates.sort((a, b) => {
    const pDiff = getScopePriority(b.targetScope) - getScopePriority(a.targetScope);
    if (pDiff !== 0) return pDiff;
    if (b.effectiveFrom !== a.effectiveFrom) {
      return b.effectiveFrom.localeCompare(a.effectiveFrom);
    }
    return (b.updatedAtIso || '').localeCompare(a.updatedAtIso || '');
  });

  const best = candidates[0];
  return { price: Math.max(0, Number(best.pricePerMeal) || 0), rule: best };
}

export function resolvePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  const due = Math.round(totalDue);
  const paid = Math.round(totalPaid);
  if (paid <= 0) return 'unpaid';
  if (paid < due) return 'partial';
  if (paid === due) return 'paid';
  return 'overpaid';
}

export function computeMonthlyBillingReport(params: {
  month: string; // YYYY-MM
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  pricingRules: MealPricingRule[];
  payments: MealPayment[];
  holidays?: string[];
  settlement?: MonthlySettlement | null;
  env?: AppEnvironment;
}): SchoolMonthlySummary {
  const env: AppEnvironment = params.env || 'production';
  const { year, monthNum, days } = getDaysInMonthList(params.month, params.holidays || []);

  const envClasses = params.classes
    .filter((c) => c.env === env && c.active)
    .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order));
  const classMap = new Map<string, SchoolClass>();
  for (const c of envClasses) classMap.set(c.id, c);

  // Deduplicate registrations strictly by (studentId, date) so there is never double counting
  const regsByStudentDate = new Map<string, Map<string, MealRegistration>>();
  const regsByStudentList = new Map<string, MealRegistration[]>();
  for (const r of params.registrations) {
    if (r.env !== env || !r.date.startsWith(params.month)) continue;
    let dMap = regsByStudentDate.get(r.studentId);
    if (!dMap) {
      dMap = new Map<string, MealRegistration>();
      regsByStudentDate.set(r.studentId, dMap);
    }
    const prev = dMap.get(r.date);
    if (!prev || (r.updatedAtIso || '') >= (prev.updatedAtIso || '')) {
      dMap.set(r.date, r);
    }
  }

  for (const [stuId, dMap] of regsByStudentDate.entries()) {
    regsByStudentList.set(
      stuId,
      Array.from(dMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    );
  }

  // Index active (non-voided) payments for this month by studentId
  const paymentsByStudent = new Map<string, MealPayment[]>();
  for (const p of params.payments || []) {
    if (p.env !== env || p.month !== params.month || p.isVoided) continue;
    const arr = paymentsByStudent.get(p.studentId) || [];
    arr.push(p);
    paymentsByStudent.set(p.studentId, arr);
  }

  // Include active students + any inactive/transferred students who have registrations or payments in this month
  const relevantStudents = params.students.filter((s) => {
    if (s.env !== env) return false;
    if (s.active) return true;
    return regsByStudentDate.has(s.id) || paymentsByStudent.has(s.id);
  });

  const studentRows: StudentMonthlySummary[] = [];
  let schoolHasMissingPrice = false;

  for (const stu of relevantStudents) {
    const stuRegsMap = regsByStudentDate.get(stu.id) || new Map<string, MealRegistration>();
    const stuRegsArr = regsByStudentList.get(stu.id) || [];
    const distinctClassNamesInMonth = Array.from(
      new Set(stuRegsArr.map((r) => r.className).filter(Boolean))
    );
    const classIdsInMonth = Array.from(
      new Set([stu.classId, ...stuRegsArr.map((r) => r.classId).filter(Boolean)])
    );
    const hasTransferredClass =
      distinctClassNamesInMonth.length > 1 ||
      (distinctClassNamesInMonth.length === 1 && distinctClassNamesInMonth[0] !== stu.className);
    const transferNote = !stu.active
      ? 'Đã nghỉ học / Ngừng bán trú'
      : hasTransferredClass
      ? `Chuyển lớp (${distinctClassNamesInMonth.join(' → ')} · Hiện tại: ${stu.className})`
      : '';

    const dayCells: StudentDayCell[] = [];
    let xCount = 0;
    let vCount = 0;
    let rCount = 0;
    let blankCount = 0;
    let totalAmountDue = 0;
    let hasMissingPrice = false;
    const tierMap = new Map<number, PriceTierSummary>();

    for (const dayMeta of days) {
      const reg = stuRegsMap.get(dayMeta.dateStr);
      const symbol = mapRegistrationToSymbol(reg, stu.active);

      let unitPrice = 0;
      let hasPriceConfigured = true;
      let amount = 0;

      if (symbol === 'X') {
        // Resolve unit price using student's class at that date (or current class fallback)
        const effectiveClassId = reg?.classId || stu.classId;
        const effectiveGrade = (reg?.grade || stu.grade) as GradeLevel;
        const resolved = resolveUnitPriceForStudentOnDate(
          { id: stu.id, classId: effectiveClassId, grade: effectiveGrade },
          dayMeta.dateStr,
          params.pricingRules,
          env
        );
        if (!resolved.rule) {
          hasPriceConfigured = false;
          hasMissingPrice = true;
          schoolHasMissingPrice = true;
        }
        unitPrice = resolved.price;
        amount = unitPrice;
        xCount++;
        totalAmountDue += amount;

        const prevTier = tierMap.get(unitPrice) || {
          unitPrice,
          daysCount: 0,
          subtotal: 0,
        };
        prevTier.daysCount += 1;
        prevTier.subtotal += amount;
        tierMap.set(unitPrice, prevTier);
      } else if (symbol === 'V') {
        vCount++;
      } else if (symbol === 'R') {
        rCount++;
      } else {
        blankCount++;
      }

      dayCells.push({
        day: dayMeta.day,
        dateStr: dayMeta.dateStr,
        symbol,
        unitPrice,
        amount,
        hasPriceConfigured,
        registration: reg,
        isOffDay: dayMeta.isOffDay,
      });
    }

    const stuPayments = [...(paymentsByStudent.get(stu.id) || [])].sort((a, b) =>
      (b.paymentDate || '').localeCompare(a.paymentDate || '')
    );
    const totalPaid = stuPayments.reduce((acc, p) => acc + (Number(p.amountPaid) || 0), 0);
    const balanceRemaining = Math.max(0, totalAmountDue - totalPaid);
    const overpaidAmount = Math.max(0, totalPaid - totalAmountDue);
    const paymentStatus = resolvePaymentStatus(totalAmountDue, totalPaid);

    const priceTiers = Array.from(tierMap.values()).sort((a, b) => a.unitPrice - b.unitPrice);
    // For students with 0 eating days, still peek latest day in month to show applicable unit price
    const referenceDate = days[days.length - 1]?.dateStr || `${params.month}-01`;
    const fallbackPriceInfo = resolveUnitPriceForStudentOnDate(
      { id: stu.id, classId: stu.classId, grade: stu.grade },
      referenceDate,
      params.pricingRules,
      env
    );
    const primaryUnitPrice =
      priceTiers.length > 0 ? priceTiers[priceTiers.length - 1].unitPrice : fallbackPriceInfo.price;

    studentRows.push({
      student: stu,
      displayClassId: stu.classId,
      displayClassName: stu.className,
      displayGrade: stu.grade,
      hasTransferredClass,
      transferNote,
      classIdsInMonth,
      dayCells,
      xCount,
      vCount,
      rCount,
      blankCount,
      totalAmountDue,
      totalPaid,
      balanceRemaining,
      overpaidAmount,
      paymentStatus,
      priceTiers,
      primaryUnitPrice,
      hasMultiplePrices: priceTiers.length > 1,
      hasMissingPrice,
      payments: stuPayments,
    });
  }

  studentRows.sort((a, b) => {
    if (a.displayGrade !== b.displayGrade) return a.displayGrade - b.displayGrade;
    if (a.displayClassName !== b.displayClassName) {
      return a.displayClassName.localeCompare(b.displayClassName, 'vi', { numeric: true });
    }
    return a.student.fullName.localeCompare(b.student.fullName, 'vi');
  });

  // Group into ClassMonthlySummary (1 primary class per student so school totals have zero duplication)
  const rowsByClassId = new Map<string, StudentMonthlySummary[]>();
  for (const row of studentRows) {
    const arr = rowsByClassId.get(row.displayClassId) || [];
    arr.push(row);
    rowsByClassId.set(row.displayClassId, arr);
  }

  const classSummaries: ClassMonthlySummary[] = envClasses.map((cls) => {
    const rows = rowsByClassId.get(cls.id) || [];
    const dayTotals = days.map((_, idx) =>
      rows.reduce((acc, r) => acc + (r.dayCells[idx]?.symbol === 'X' ? 1 : 0), 0)
    );
    return {
      classObj: cls,
      studentRows: rows,
      studentCount: rows.length,
      dayTotals,
      totalX: rows.reduce((acc, r) => acc + r.xCount, 0),
      totalV: rows.reduce((acc, r) => acc + r.vCount, 0),
      totalR: rows.reduce((acc, r) => acc + r.rCount, 0),
      totalAmountDue: rows.reduce((acc, r) => acc + r.totalAmountDue, 0),
      totalPaid: rows.reduce((acc, r) => acc + r.totalPaid, 0),
      totalRemaining: rows.reduce((acc, r) => acc + r.balanceRemaining, 0),
      totalOverpaid: rows.reduce((acc, r) => acc + r.overpaidAmount, 0),
    };
  });

  const grades: GradeLevel[] = [6, 7, 8, 9];
  const gradeSummaries: GradeMonthlySummary[] = grades.map((grade) => {
    const cList = classSummaries.filter((c) => c.classObj.grade === grade);
    return {
      grade,
      classSummaries: cList,
      studentCount: cList.reduce((acc, c) => acc + c.studentCount, 0),
      totalX: cList.reduce((acc, c) => acc + c.totalX, 0),
      totalV: cList.reduce((acc, c) => acc + c.totalV, 0),
      totalR: cList.reduce((acc, c) => acc + c.totalR, 0),
      totalAmountDue: cList.reduce((acc, c) => acc + c.totalAmountDue, 0),
      totalPaid: cList.reduce((acc, c) => acc + c.totalPaid, 0),
      totalRemaining: cList.reduce((acc, c) => acc + c.totalRemaining, 0),
      totalOverpaid: cList.reduce((acc, c) => acc + c.totalOverpaid, 0),
    };
  });

  return {
    month: params.month,
    year,
    monthNum,
    days,
    settlement: params.settlement || null,
    studentRows,
    classSummaries,
    gradeSummaries,
    totalStudents: studentRows.length,
    totalX: studentRows.reduce((acc, r) => acc + r.xCount, 0),
    totalV: studentRows.reduce((acc, r) => acc + r.vCount, 0),
    totalR: studentRows.reduce((acc, r) => acc + r.rCount, 0),
    totalAmountDue: studentRows.reduce((acc, r) => acc + r.totalAmountDue, 0),
    totalPaid: studentRows.reduce((acc, r) => acc + r.totalPaid, 0),
    totalRemaining: studentRows.reduce((acc, r) => acc + r.balanceRemaining, 0),
    totalOverpaid: studentRows.reduce((acc, r) => acc + r.overpaidAmount, 0),
    hasAnyMissingPrice: schoolHasMissingPrice,
  };
}
