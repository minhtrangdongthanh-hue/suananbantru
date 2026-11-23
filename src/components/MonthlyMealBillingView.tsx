import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  CreditCard,
  Edit3,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  Plus,
  Printer,
  Receipt,
  Search,
  Settings,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  DailyReport,
  formatVietnameseDate,
  formatVnd,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  GradeLevel,
  isDateLockedByClock,
  MealBillingConfig,
  MealPayment,
  MealPaymentLog,
  MealPricingLog,
  MealPricingRule,
  MealPricingScope,
  MealRegistration,
  MonthlySettlement,
  PaymentMethod,
  PaymentStatus,
  RegistrationStatus,
  SchoolClass,
  Student,
  UserRole,
} from '../types';
import {
  computeMonthlyBillingReport,
  getDefaultMealBillingConfig,
  StudentDayCell,
  StudentMonthlySummary,
} from '../services/monthlyMealEngine';
import {
  exportMonthlyClassTableToExcel,
  exportSchoolMonthlyFinancialToExcel,
  exportSchoolMonthlySummaryToPdf,
  exportStudentMonthlySlipToExcel,
  exportStudentMonthlySlipToPdf,
  exportMonthlyTableToPdf,
  exportUnpaidStudentsToExcel,
} from '../services/monthlyExportService';
import {
  deleteMealPricingRule,
  lockMonthlySettlement,
  recordMealPayment,
  registerStudentMeal,
  saveMealBillingConfig,
  saveMealPricingRule,
  unlockMonthlySettlement,
  updateMealPayment,
  voidMealPayment,
} from '../services/mealService';

interface MonthlyMealBillingViewProps {
  selectedDate: string;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  reports: DailyReport[];
  pricingRules: MealPricingRule[];
  pricingLogs: MealPricingLog[];
  billingConfig: MealBillingConfig | null;
  payments: MealPayment[];
  paymentLogs: MealPaymentLog[];
  settlements: MonthlySettlement[];
  academicYear: string;
  currentUserRole: UserRole;
  currentUserUid: string;
  currentUserName: string;
  assignedClassId?: string;
  canMarkAttendance: boolean;
  canExportReports: boolean;
  canManageMealPricing: boolean;
  canCollectPayments: boolean;
  cutoffTime: string;
}

type BillingSubTab = 'table' | 'collection' | 'school_summary' | 'pricing';
type SchoolViewMode = 'grades' | 'classes' | 'students' | 'months';

const ACADEMIC_YEAR_OPTIONS = ['2025 - 2026', '2026 - 2027', '2027 - 2028', '2028 - 2029'];

export const MonthlyMealBillingView: React.FC<MonthlyMealBillingViewProps> = ({
  selectedDate,
  classes,
  students,
  registrations,
  reports,
  pricingRules,
  pricingLogs,
  billingConfig,
  payments,
  paymentLogs,
  settlements,
  academicYear,
  currentUserRole,
  currentUserUid,
  currentUserName,
  assignedClassId,
  canMarkAttendance,
  canExportReports,
  canManageMealPricing,
  canCollectPayments,
  cutoffTime,
}) => {
  const isAdmin = currentUserRole === 'admin';
  const isTeacher = currentUserRole === 'teacher';
  const canEditPricing = isAdmin || canManageMealPricing;
  const canCollect = isAdmin || canCollectPayments;
  const canExport = isAdmin || canExportReports;

  const canSeeCollection = canCollect || currentUserRole === 'accountant';
  const canSeeSchoolSummary = !isTeacher;
  const canSeePricing = canEditPricing || currentUserRole === 'accountant';

  const activeClasses = useMemo(
    () =>
      classes
        .filter((c) => c.env === 'production' && c.active)
        .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order)),
    [classes]
  );

  const [subTab, setSubTab] = useState<BillingSubTab>('table');
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(
    academicYear || '2026 - 2027'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(() => selectedDate.slice(0, 7));
  const [classFilter, setClassFilter] = useState<string>(() => {
    if (isTeacher && assignedClassId) return assignedClassId;
    return activeClasses[0]?.id || 'all';
  });
  const [gradeFilter, setGradeFilter] = useState<'all' | GradeLevel>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [tablePage, setTablePage] = useState<number>(1);
  const [paperSize, setPaperSize] = useState<'A4' | 'A3'>('A4');

  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals State
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [cellEditTarget, setCellEditTarget] = useState<{
    stuRow: StudentMonthlySummary;
    cell: StudentDayCell;
  } | null>(null);
  const [cellEditStatus, setCellEditStatus] = useState<RegistrationStatus>('eating');
  const [cellEditReason, setCellEditReason] = useState<string>('');

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [holidayInput, setHolidayInput] = useState('');
  const [draftHolidays, setDraftHolidays] = useState<string[]>([]);
  const [draftSymX, setDraftSymX] = useState('');
  const [draftSymV, setDraftSymV] = useState('');
  const [draftSymR, setDraftSymR] = useState('');
  const [draftSymEmpty, setDraftSymEmpty] = useState('');

  // Collection State
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [collectTarget, setCollectTarget] = useState<StudentMonthlySummary | null>(null);
  const [collectAmountStr, setCollectAmountStr] = useState('');
  const [collectDate, setCollectDate] = useState(() => selectedDate);
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>('cash');
  const [collectNote, setCollectNote] = useState('');
  const [collectIdemKey, setCollectIdemKey] = useState('');

  const [receiptTarget, setReceiptTarget] = useState<{
    payment: MealPayment;
    studentRow: StudentMonthlySummary;
  } | null>(null);

  const [editPaymentTarget, setEditPaymentTarget] = useState<MealPayment | null>(null);
  const [editPayAmountStr, setEditPayAmountStr] = useState('');
  const [editPayDate, setEditPayDate] = useState('');
  const [editPayMethod, setEditPayMethod] = useState<PaymentMethod>('cash');
  const [editPayNote, setEditPayNote] = useState('');
  const [editPayReason, setEditPayReason] = useState('');

  const [voidPaymentTarget, setVoidPaymentTarget] = useState<MealPayment | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // School Summary View State
  const [schoolViewMode, setSchoolViewMode] = useState<SchoolViewMode>('grades');

  // Pricing Form State (NO hardcoded 30,000đ default!)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState<string>(() => `${selectedDate.slice(0, 7)}-01`);
  const [rulePriceStr, setRulePriceStr] = useState<string>('');
  const [ruleScope, setRuleScope] = useState<MealPricingScope>('school');
  const [ruleGrade, setRuleGrade] = useState<GradeLevel>(6);
  const [ruleClassId, setRuleClassId] = useState<string>(() => activeClasses[0]?.id || '');
  const [ruleGroupTag, setRuleGroupTag] = useState<string>('');
  const [ruleStudentIds, setRuleStudentIds] = useState<string[]>([]);
  const [ruleStudentSearch, setRuleStudentSearch] = useState<string>('');
  const [ruleNote, setRuleNote] = useState<string>('');

  const effectiveClassFilter = isTeacher && assignedClassId ? assignedClassId : classFilter;

  const effectiveConfig = useMemo(
    () => billingConfig || getDefaultMealBillingConfig('production', currentUserUid),
    [billingConfig, currentUserUid]
  );

  const currentSettlement = useMemo(
    () =>
      settlements.find((s) => s.env === 'production' && s.month === selectedMonth) || null,
    [settlements, selectedMonth]
  );
  const isMonthLocked = Boolean(currentSettlement?.isLocked);

  const summary = useMemo(
    () =>
      computeMonthlyBillingReport({
        month: selectedMonth,
        classes,
        students,
        registrations,
        pricingRules,
        payments,
        holidays: effectiveConfig.holidays || [],
        settlement: currentSettlement,
        env: 'production',
      }),
    [selectedMonth, classes, students, registrations, pricingRules, payments, effectiveConfig, currentSettlement]
  );

  // Filtered student rows for table & collection tabs
  const filteredRows = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return summary.studentRows.filter((row) => {
      if (effectiveClassFilter !== 'all') {
        const matchesCurrentOrTransferred =
          row.displayClassId === effectiveClassFilter ||
          row.classIdsInMonth.includes(effectiveClassFilter);
        if (!matchesCurrentOrTransferred) return false;
      } else if (gradeFilter !== 'all' && row.displayGrade !== gradeFilter) {
        return false;
      }

      if (q) {
        const hitName = row.student.fullName.toLowerCase().includes(q);
        const hitCode = row.student.studentCode.toLowerCase().includes(q);
        if (!hitName && !hitCode) return false;
      }
      return true;
    });
  }, [summary.studentRows, effectiveClassFilter, gradeFilter, searchTerm]);

  const PAGE_SIZE = 60;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const visibleTableRows = useMemo(() => {
    if (effectiveClassFilter !== 'all' || filteredRows.length <= PAGE_SIZE) {
      return filteredRows;
    }
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, effectiveClassFilter, safePage]);

  const titleLabel = useMemo(() => {
    if (effectiveClassFilter !== 'all') {
      const cls = activeClasses.find((c) => c.id === effectiveClassFilter);
      return cls ? `LỚP: ${cls.name} (GVCN: ${cls.teacherName || 'Chưa cập nhật'})` : 'LỚP ĐÃ CHỌN';
    }
    if (gradeFilter !== 'all') {
      return `KHỐI ${gradeFilter} — TRƯỜNG THCS ĐÔNG THẠNH`;
    }
    return 'TOÀN TRƯỜNG (61 LỚP)';
  }, [effectiveClassFilter, gradeFilter, activeClasses]);

  const collectionFilteredRows = useMemo(() => {
    if (paymentStatusFilter === 'all') return filteredRows;
    return filteredRows.filter((r) => r.paymentStatus === paymentStatusFilter);
  }, [filteredRows, paymentStatusFilter]);

  const detailStudentRow = useMemo(
    () => (detailStudentId ? summary.studentRows.find((r) => r.student.id === detailStudentId) || null : null),
    [summary.studentRows, detailStudentId]
  );

  // Aggregate monthly summary across the selected calendar year (for "Theo từng tháng")
  const yearlyMonthSummaries = useMemo(() => {
    if (subTab !== 'school_summary' || schoolViewMode !== 'months') return [];
    const yr = selectedMonth.slice(0, 4);
    const monthsWithActivity = new Set<string>([selectedMonth]);
    for (const r of registrations) {
      if (r.env === 'production' && r.date.startsWith(`${yr}-`)) {
        monthsWithActivity.add(r.date.slice(0, 7));
      }
    }
    for (const p of payments) {
      if (p.env === 'production' && !p.isVoided && p.month.startsWith(`${yr}-`)) {
        monthsWithActivity.add(p.month);
      }
    }
    const sortedMonths = Array.from(monthsWithActivity).sort();
    return sortedMonths.map((m) =>
      computeMonthlyBillingReport({
        month: m,
        classes,
        students,
        registrations,
        pricingRules,
        payments,
        holidays: effectiveConfig.holidays || [],
        settlement: settlements.find((s) => s.env === 'production' && s.month === m) || null,
        env: 'production',
      })
    );
  }, [
    subTab,
    schoolViewMode,
    selectedMonth,
    registrations,
    payments,
    classes,
    students,
    pricingRules,
    effectiveConfig,
    settlements,
  ]);

  const activePricingRules = useMemo(
    () =>
      [...pricingRules]
        .filter((r) => r.env === 'production' && r.active)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [pricingRules]
  );

  const monthPaymentLogs = useMemo(
    () =>
      paymentLogs
        .filter((l) => l.env === 'production' && l.month === selectedMonth)
        .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso)),
    [paymentLogs, selectedMonth]
  );

  const studentsForPicker = useMemo(() => {
    const q = ruleStudentSearch.toLowerCase().trim();
    return students
      .filter((s) => s.env === 'production' && s.active)
      .filter(
        (s) =>
          !q ||
          s.fullName.toLowerCase().includes(q) ||
          s.className.toLowerCase().includes(q) ||
          s.studentCode.toLowerCase().includes(q)
      )
      .slice(0, 120);
  }, [students, ruleStudentSearch]);

  const handlePrintLandscape = () => {
    const styleId = 'dynamic-print-landscape-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media print { @page { size: ${paperSize} landscape; margin: 8mm; } }`;
    window.print();
    setTimeout(() => {
      styleEl?.remove();
    }, 1500);
  };

  const handleOpenCellEdit = (stuRow: StudentMonthlySummary, cell: StudentDayCell) => {
    if (!canMarkAttendance) return;
    if (isTeacher && assignedClassId && stuRow.student.classId !== assignedClassId) {
      setErrorMsg('Giáo viên chủ nhiệm chỉ được điều chỉnh suất ăn của lớp mình phụ trách.');
      return;
    }
    const dayReport = reports.find((r) => r.env === 'production' && r.date === cell.dateStr);
    const dayLocked =
      isMonthLocked ||
      Boolean(dayReport?.isLocked) ||
      isDateLockedByClock(cell.dateStr, cutoffTime);
    if (dayLocked && !isAdmin) {
      setErrorMsg(
        isMonthLocked
          ? `Tháng ${selectedMonth} đã khóa sổ quyết toán. Chỉ Quản trị viên mới được phép điều chỉnh.`
          : `Ngày ${formatVietnameseDate(cell.dateStr)} đã khóa sổ điểm danh. Chỉ Quản trị viên mới được điều chỉnh.`
      );
      return;
    }

    setErrorMsg(null);
    setCellEditTarget({ stuRow, cell });
    setCellEditStatus(cell.registration?.status || (cell.symbol === 'X' ? 'eating' : cell.symbol === 'V' ? 'not_eating' : 'unregistered'));
    setCellEditReason(cell.registration?.adjustmentReason || '');
  };

  const handleSaveCellEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cellEditTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang cập nhật suất ăn...');
    try {
      await registerStudentMeal({
        student: cellEditTarget.stuRow.student,
        date: cellEditTarget.cell.dateStr,
        newStatus: cellEditStatus,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        assignedClassId,
        canMarkAttendanceOverride: canMarkAttendance,
        cutoffTime,
        adjustmentReason:
          cellEditStatus === 'not_eating' && cellEditReason.trim().startsWith('[R]')
            ? cellEditReason.trim()
            : cellEditReason.trim() || 'Cập nhật trên bảng báo suất ăn tháng',
        env: 'production',
      });
      setCellEditTarget(null);
      setSuccessMsg(
        `Đã cập nhật suất ăn ngày ${formatVietnameseDate(cellEditTarget.cell.dateStr)} cho ${cellEditTarget.stuRow.student.fullName}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const handleLockMonth = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang khóa sổ quyết toán tháng...');
    try {
      await lockMonthlySettlement({
        month: selectedMonth,
        classes,
        students,
        registrations,
        pricingRules,
        billingConfig: effectiveConfig,
        payments,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canManageMealPricing: canEditPricing,
        env: 'production',
      });
      setSuccessMsg(`Đã khóa sổ quyết toán tháng ${selectedMonth} thành công.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const handleConfirmUnlockMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang mở khóa sổ tháng...');
    try {
      await unlockMonthlySettlement({
        month: selectedMonth,
        reason: unlockReason,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canManageMealPricing: canEditPricing,
        env: 'production',
      });
      setShowUnlockModal(false);
      setUnlockReason('');
      setSuccessMsg(`Đã mở khóa sổ tháng ${selectedMonth}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const openConfigModal = () => {
    setDraftHolidays([...(effectiveConfig.holidays || [])]);
    setDraftSymX(effectiveConfig.symbolXLabel);
    setDraftSymV(effectiveConfig.symbolVLabel);
    setDraftSymR(effectiveConfig.symbolRLabel);
    setDraftSymEmpty(effectiveConfig.symbolEmptyLabel);
    setHolidayInput('');
    setShowConfigModal(true);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang lưu cấu hình ngày nghỉ & ký hiệu...');
    try {
      await saveMealBillingConfig({
        holidays: draftHolidays,
        symbolXLabel: draftSymX,
        symbolVLabel: draftSymV,
        symbolRLabel: draftSymR,
        symbolEmptyLabel: draftSymEmpty,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canManageMealPricing: canEditPricing,
        env: 'production',
      });
      setShowConfigModal(false);
      setSuccessMsg('Đã lưu cấu hình ngày nghỉ lễ & chú thích ký hiệu.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const openCollectModal = (stuRow: StudentMonthlySummary) => {
    setErrorMsg(null);
    setCollectTarget(stuRow);
    setCollectAmountStr(
      stuRow.balanceRemaining > 0 ? String(stuRow.balanceRemaining) : ''
    );
    setCollectDate(selectedDate);
    setCollectMethod('cash');
    setCollectNote(`Thu tiền ăn tháng ${selectedMonth}`);
    setCollectIdemKey(`${selectedMonth}_${stuRow.student.id}_${Date.now()}`);
  };

  const handleRecordPayment = async (e: React.FormEvent, autoPrint: boolean) => {
    e.preventDefault();
    if (!collectTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang ghi nhận khoản thu...');
    try {
      const created = await recordMealPayment({
        month: selectedMonth,
        student: collectTarget.student,
        amountPaid: Number(collectAmountStr),
        paymentDate: collectDate,
        paymentMethod: collectMethod,
        note: collectNote,
        idempotencyKey: collectIdemKey,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canCollectPayments: canCollect,
        existingSettlements: settlements,
        env: 'production',
      });
      const targetSnapshot = collectTarget;
      setCollectTarget(null);
      setSuccessMsg(
        `Đã thu ${formatVnd(created.amountPaid)} cho ${targetSnapshot.student.fullName} (Phiếu ${created.receiptNumber}).`
      );
      if (autoPrint) {
        setReceiptTarget({ payment: created, studentRow: targetSnapshot });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const handleSaveEditPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPaymentTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang cập nhật phiếu thu...');
    try {
      const updated = await updateMealPayment({
        payment: editPaymentTarget,
        expectedVersion: editPaymentTarget.version,
        amountPaid: Number(editPayAmountStr),
        paymentDate: editPayDate,
        paymentMethod: editPayMethod,
        note: editPayNote,
        reason: editPayReason,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canCollectPayments: canCollect,
        existingSettlements: settlements,
        env: 'production',
      });
      setEditPaymentTarget(null);
      setSuccessMsg(`Đã cập nhật phiếu thu ${updated.receiptNumber}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const handleConfirmVoidPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidPaymentTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang hủy phiếu thu...');
    try {
      await voidMealPayment({
        payment: voidPaymentTarget,
        expectedVersion: voidPaymentTarget.version,
        reason: voidReason,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canCollectPayments: canCollect,
        existingSettlements: settlements,
        env: 'production',
      });
      setVoidPaymentTarget(null);
      setVoidReason('');
      setSuccessMsg(`Đã hủy phiếu thu ${voidPaymentTarget.receiptNumber} và ghi nhật ký kiểm toán.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const resetPricingForm = () => {
    setEditingRuleId(null);
    setRuleEffectiveFrom(`${selectedMonth}-01`);
    setRulePriceStr('');
    setRuleScope('school');
    setRuleGrade(6);
    setRuleClassId(activeClasses[0]?.id || '');
    setRuleGroupTag('');
    setRuleStudentIds([]);
    setRuleNote('');
  };

  const handleSavePricingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!rulePriceStr.trim()) {
      setErrorMsg('Vui lòng nhập đơn giá suất ăn (VNĐ).');
      return;
    }
    const priceNum = Number(rulePriceStr);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setErrorMsg('Đơn giá VNĐ không hợp lệ.');
      return;
    }
    if (ruleScope === 'class' && !ruleClassId) {
      setErrorMsg('Vui lòng chọn lớp áp dụng đơn giá.');
      return;
    }
    if (ruleScope === 'student_group' && ruleStudentIds.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất 1 học sinh cho nhóm đơn giá.');
      return;
    }

    setBusyMsg('Đang lưu đơn giá suất ăn...');
    try {
      const saved = await saveMealPricingRule({
        rule: {
          id: editingRuleId || undefined,
          effectiveFrom: ruleEffectiveFrom,
          pricePerMeal: priceNum,
          targetScope: ruleScope,
          targetGrade: ruleScope === 'grade' ? ruleGrade : 0,
          targetClassId: ruleScope === 'class' ? ruleClassId : '',
          groupTag: ruleScope === 'student_group' ? ruleGroupTag || 'Nhóm học sinh' : '',
          studentIds: ruleScope === 'student_group' ? ruleStudentIds : [],
          note: ruleNote,
          active: true,
        },
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canManageMealPricing: canEditPricing,
        existingSettlements: settlements,
        env: 'production',
      });
      resetPricingForm();
      setSuccessMsg(
        `Đã lưu đơn giá ${formatVnd(saved.pricePerMeal)} áp dụng từ ${formatVietnameseDate(saved.effectiveFrom)}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const handleEditRule = (rule: MealPricingRule) => {
    setEditingRuleId(rule.id);
    setRuleEffectiveFrom(rule.effectiveFrom);
    setRulePriceStr(String(rule.pricePerMeal));
    setRuleScope(rule.targetScope);
    setRuleGrade((rule.targetGrade || 6) as GradeLevel);
    setRuleClassId(rule.targetClassId || activeClasses[0]?.id || '');
    setRuleGroupTag(rule.groupTag || '');
    setRuleStudentIds(rule.studentIds || []);
    setRuleNote(rule.note || '');
  };

  const handleDeleteRule = async (rule: MealPricingRule) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyMsg('Đang xóa cấu hình đơn giá...');
    try {
      await deleteMealPricingRule({
        rule,
        actorUid: currentUserUid,
        actorName: currentUserName,
        actorRole: currentUserRole,
        canManageMealPricing: canEditPricing,
        existingSettlements: settlements,
        env: 'production',
      });
      setSuccessMsg('Đã xóa cấu hình đơn giá và lưu lịch sử thay đổi.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMsg(null);
    }
  };

  const renderPaymentStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-block rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 whitespace-nowrap">
            Đã đóng đủ
          </span>
        );
      case 'partial':
        return (
          <span className="inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 whitespace-nowrap">
            Đã đóng một phần
          </span>
        );
      case 'overpaid':
        return (
          <span className="inline-block rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 whitespace-nowrap">
            Đóng thừa
          </span>
        );
      case 'unpaid':
      default:
        return (
          <span className="inline-block rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 whitespace-nowrap">
            Chưa đóng
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header Banner */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
              Báo suất ăn tháng – Tính tiền ăn bán trú
            </h2>
            {isMonthLocked ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                <Lock className="w-3.5 h-3.5" />
                <span>Đã khóa sổ tháng {selectedMonth}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Đang mở · Đồng bộ tự động từ điểm danh hằng ngày</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Nguồn dữ liệu duy nhất từ báo suất ăn hằng ngày · Tính tự động theo đơn giá VNĐ từng ngày · Năm học {selectedAcademicYear}
          </p>
        </div>

        {/* Sub-tab Switcher */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('table')}
            className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
              subTab === 'table'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-sky-600" />
            <span>Bảng báo ăn tháng</span>
          </button>

          {canSeeCollection && (
            <button
              type="button"
              onClick={() => setSubTab('collection')}
              className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
                subTab === 'collection'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Banknote className="w-3.5 h-3.5 text-emerald-600" />
              <span>Thu tiền ăn học sinh</span>
            </button>
          )}

          {canSeeSchoolSummary && (
            <button
              type="button"
              onClick={() => setSubTab('school_summary')}
              className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
                subTab === 'school_summary'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Tổng hợp toàn trường</span>
            </button>
          )}

          {canSeePricing && (
            <button
              type="button"
              onClick={() => setSubTab('pricing')}
              className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
                subTab === 'pricing'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5 text-amber-600" />
              <span>Cài đặt giá suất ăn</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {(errorMsg || successMsg || busyMsg) && (
        <div className="no-print space-y-2">
          {busyMsg && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-bold text-sky-900">
              {busyMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-900 flex items-center justify-between gap-2">
              <span>{errorMsg}</span>
              <button type="button" onClick={() => setErrorMsg(null)} className="underline cursor-pointer">
                Đóng
              </button>
            </div>
          )}
          {successMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-900 flex items-center justify-between gap-2">
              <span>{successMsg}</span>
              <button type="button" onClick={() => setSuccessMsg(null)} className="underline cursor-pointer">
                Đóng
              </button>
            </div>
          )}
        </div>
      )}

      {/* Missing Unit Price Warning */}
      {summary.hasAnyMissingPrice && (
        <div className="no-print rounded-2xl border border-amber-300 bg-amber-50 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold">
                Tháng {selectedMonth} có suất ăn chưa có đơn giá áp dụng (tạm tính 0 ₫).
              </span>{' '}
              Hệ thống không tự mặc định đơn giá. Quản trị viên vui lòng cài đặt đơn giá VNĐ chính thức.
            </div>
          </div>
          {canEditPricing && (
            <button
              type="button"
              onClick={() => setSubTab('pricing')}
              className="min-h-[36px] self-start sm:self-auto rounded-lg bg-amber-700 px-3 py-1.5 font-extrabold text-white hover:bg-amber-800 whitespace-nowrap cursor-pointer"
            >
              Cài đặt đơn giá ngay
            </button>
          )}
        </div>
      )}

      {/* Shared Filters (Shown on table & collection tabs) */}
      {(subTab === 'table' || subTab === 'collection') && (
        <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Năm học</label>
              <select
                value={selectedAcademicYear}
                onChange={(e) => setSelectedAcademicYear(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900"
              >
                {Array.from(new Set([academicYear, ...ACADEMIC_YEAR_OPTIONS])).map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Tháng / Năm quyết toán
              </label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setTablePage(1);
                }}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Lớp học</label>
              <select
                value={effectiveClassFilter}
                disabled={isTeacher && Boolean(assignedClassId)}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  setTablePage(1);
                }}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900 disabled:opacity-70"
              >
                {!isTeacher && <option value="all">Toàn trường (61 lớp)</option>}
                {activeClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    Lớp {cls.name} ({cls.teacherName})
                  </option>
                ))}
              </select>
            </div>

            {effectiveClassFilter === 'all' && !isTeacher && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Lọc theo Khối</label>
                <select
                  value={String(gradeFilter)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGradeFilter(val === 'all' ? 'all' : (Number(val) as GradeLevel));
                    setTablePage(1);
                  }}
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900"
                >
                  <option value="all">Tất cả 4 khối</option>
                  <option value="6">Khối 6</option>
                  <option value="7">Khối 7</option>
                  <option value="8">Khối 8</option>
                  <option value="9">Khối 9</option>
                </select>
              </div>
            )}

            <div className={effectiveClassFilter !== 'all' || isTeacher ? 'lg:col-span-2' : ''}>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Tìm học sinh theo họ tên / mã HS
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setTablePage(1);
                  }}
                  placeholder="Nhập họ tên hoặc mã học sinh..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-sm text-slate-900"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 1: BẢNG BÁO SUẤT ĂN THÁNG ==================== */}
      {subTab === 'table' && (
        <div className="space-y-4">
          {/* Action Toolbar */}
          <div className="no-print rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {canEditPricing && (
                <>
                  {!isMonthLocked ? (
                    <button
                      type="button"
                      onClick={handleLockMonth}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Khóa sổ tháng {selectedMonth}</span>
                    </button>
                  ) : (
                    isAdmin && (
                      <button
                        type="button"
                        onClick={() => setShowUnlockModal(true)}
                        className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 cursor-pointer"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Mở khóa sổ tháng</span>
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={openConfigModal}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-600" />
                    <span>Ngày nghỉ &amp; Ký hiệu ({effectiveConfig.holidays.length})</span>
                  </button>
                </>
              )}
            </div>

            {canExport && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as 'A4' | 'A3')}
                  aria-label="Khổ giấy in"
                  className="min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-800 cursor-pointer"
                >
                  <option value="A4">Khổ ngang A4</option>
                  <option value="A3">Khổ ngang A3</option>
                </select>

                <button
                  type="button"
                  onClick={() =>
                    exportMonthlyClassTableToExcel({
                      summary,
                      studentRows: filteredRows,
                      titleLabel,
                      config: effectiveConfig,
                      paperSize,
                    })
                  }
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Xuất Excel</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    exportMonthlyTableToPdf({
                      summary,
                      studentRows: filteredRows,
                      titleLabel,
                      paperSize: paperSize === 'A3' ? 'a3' : 'a4',
                    })
                  }
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Xuất PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintLandscape}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-sky-400" />
                  <span>In bảng</span>
                </button>
              </div>
            )}
          </div>

          {/* Printable Matrix Sheet */}
          <div className="print-container rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            {/* School & Title Header */}
            <div className="text-center space-y-1 pb-2 border-b border-slate-200">
              <div className="text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-700">
                TRƯỜNG THCS ĐÔNG THẠNH
              </div>
              <h3 className="text-sm sm:text-base font-extrabold uppercase text-slate-900">
                BẢNG TỔNG HỢP SUẤT ĂN THÁNG {String(summary.monthNum).padStart(2, '0')} NĂM {summary.year}
              </h3>
              <div className="text-xs font-extrabold text-sky-800">{titleLabel}</div>
            </div>

            {/* Symbol Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 inline-flex items-center justify-center rounded border border-slate-300 bg-white font-extrabold text-slate-900">
                  X
                </span>
                <span>{effectiveConfig.symbolXLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 inline-flex items-center justify-center rounded border border-rose-200 bg-rose-100 font-extrabold text-rose-700">
                  V
                </span>
                <span>{effectiveConfig.symbolVLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 inline-flex items-center justify-center rounded border border-slate-300 bg-slate-200 font-bold text-slate-600">
                  R
                </span>
                <span>{effectiveConfig.symbolRLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 inline-flex items-center justify-center rounded border border-slate-300 bg-slate-300 text-slate-700 font-bold">
                  ·
                </span>
                <span>Thứ 7, CN / Ngày nghỉ lễ</span>
              </span>
              <span className="ml-auto text-[11px] font-semibold text-sky-700">
                Nhấn vào tên học sinh để xem Phiếu chi tiết tháng
              </span>
            </div>

            {/* Horizontal Scroll Matrix Table with Sticky STT | Lớp | Họ tên */}
            <div className="overflow-x-auto rounded-xl border border-slate-300">
              <table className="w-max min-w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="bg-slate-100 text-slate-900 font-extrabold">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-20 w-[44px] min-w-[44px] bg-slate-100 border-b border-r border-slate-300 px-1.5 py-2 text-center"
                    >
                      STT
                    </th>
                    <th
                      rowSpan={2}
                      className="sticky left-[44px] z-20 w-[60px] min-w-[60px] bg-slate-100 border-b border-r border-slate-300 px-1.5 py-2 text-center"
                    >
                      Lớp
                    </th>
                    <th
                      rowSpan={2}
                      className="sticky left-[104px] z-20 w-[180px] min-w-[165px] max-w-[200px] bg-slate-100 border-b border-r-2 border-slate-300 px-2.5 py-2 text-left shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                    >
                      Họ tên học sinh
                    </th>
                    {summary.days.map((d) => (
                      <th
                        key={`d_${d.day}`}
                        className={`w-[30px] min-w-[30px] border-b border-r border-slate-300 py-1 text-center ${
                          d.isOffDay ? 'bg-slate-200 text-slate-600' : 'bg-slate-100'
                        }`}
                      >
                        {d.day}
                      </th>
                    ))}
                    <th
                      rowSpan={2}
                      className="min-w-[66px] bg-slate-100 border-b border-r border-slate-300 px-2 py-2 text-center"
                    >
                      Hiện diện (X)
                    </th>
                    <th
                      rowSpan={2}
                      className="min-w-[60px] bg-slate-100 border-b border-r border-slate-300 px-2 py-2 text-center"
                    >
                      Vắng mặt (V)
                    </th>
                    <th
                      rowSpan={2}
                      className="min-w-[54px] bg-slate-100 border-b border-r border-slate-300 px-2 py-2 text-center"
                    >
                      Nghỉ (R)
                    </th>
                    <th
                      rowSpan={2}
                      className="min-w-[104px] bg-slate-100 border-b border-r border-slate-300 px-2 py-2 text-right"
                    >
                      Tiền ăn
                    </th>
                    <th
                      rowSpan={2}
                      className="min-w-[96px] bg-slate-100 border-b border-r border-slate-300 px-2 py-2 text-right"
                    >
                      Đã đóng
                    </th>
                    <th
                      rowSpan={2}
                      className="min-w-[100px] bg-slate-100 border-b border-slate-300 px-2 py-2 text-right"
                    >
                      Còn thiếu
                    </th>
                  </tr>
                  <tr className="bg-slate-100 text-[10px] font-bold text-slate-600">
                    {summary.days.map((d) => (
                      <th
                        key={`w_${d.day}`}
                        className={`border-b border-r border-slate-300 py-1 text-center ${
                          d.isOffDay ? 'bg-slate-200 text-slate-600' : 'bg-slate-50'
                        }`}
                        title={d.isHoliday ? 'Ngày nghỉ lễ' : d.isWeekend ? 'Cuối tuần' : ''}
                      >
                        {d.weekdayShort}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTableRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={summary.days.length + 9}
                        className="p-8 text-center text-sm text-slate-500"
                      >
                        Không tìm thấy học sinh phù hợp bộ lọc trong tháng {selectedMonth}.
                      </td>
                    </tr>
                  ) : (
                    visibleTableRows.map((row, idx) => {
                      const rowNum =
                        effectiveClassFilter === 'all' && filteredRows.length > PAGE_SIZE
                          ? (safePage - 1) * PAGE_SIZE + idx + 1
                          : idx + 1;
                      return (
                        <tr key={row.student.id} className="hover:bg-sky-50/40 border-b border-slate-200">
                          <td className="sticky left-0 z-10 bg-white border-r border-slate-200 px-1.5 py-1.5 text-center text-slate-500">
                            {rowNum}
                          </td>
                          <td className="sticky left-[44px] z-10 bg-white border-r border-slate-200 px-1.5 py-1.5 text-center font-bold text-slate-800">
                            {row.displayClassName}
                          </td>
                          <td className="sticky left-[104px] z-10 bg-white border-r-2 border-slate-300 px-2.5 py-1.5 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(row.student.id)}
                              className="text-left font-bold text-slate-900 hover:text-sky-700 hover:underline cursor-pointer block truncate max-w-[175px]"
                              title="Nhấn để xem Phiếu tổng hợp suất ăn tháng"
                            >
                              {row.student.fullName}
                            </button>
                            {row.transferNote && (
                              <div className="text-[10px] font-semibold text-amber-700 truncate max-w-[175px]">
                                {row.transferNote}
                              </div>
                            )}
                          </td>
                          {row.dayCells.map((dc) => {
                            const cellBg =
                              dc.symbol === 'V'
                                ? 'bg-rose-100 text-rose-700 font-extrabold'
                                : dc.symbol === 'R'
                                ? 'bg-slate-200 text-slate-600 font-semibold'
                                : dc.symbol === 'X'
                                ? dc.isOffDay
                                  ? 'bg-slate-200 text-slate-900 font-extrabold'
                                  : 'bg-white text-slate-900 font-extrabold'
                                : dc.isOffDay
                                ? 'bg-slate-200 text-slate-400'
                                : 'bg-white text-slate-300';

                            return (
                              <td
                                key={`${row.student.id}_${dc.day}`}
                                onClick={() => handleOpenCellEdit(row, dc)}
                                className={`border-r border-slate-200 text-center py-1.5 select-none ${cellBg} ${
                                  canMarkAttendance ? 'cursor-pointer hover:ring-1 hover:ring-sky-500' : ''
                                }`}
                                title={
                                  dc.symbol === 'X'
                                    ? `Ngày ${dc.day}: Có ăn (${formatVnd(dc.unitPrice)})`
                                    : dc.symbol === 'V'
                                    ? `Ngày ${dc.day}: Vắng (0 ₫)`
                                    : dc.symbol === 'R'
                                    ? `Ngày ${dc.day}: Nghỉ / Không ĐK (0 ₫)`
                                    : `Ngày ${dc.day}: Chưa có dữ liệu`
                                }
                              >
                                {dc.symbol || ''}
                              </td>
                            );
                          })}
                          <td className="border-r border-slate-200 px-2 py-1.5 text-center font-extrabold text-slate-900">
                            {row.xCount}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-rose-700">
                            {row.vCount}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-1.5 text-center text-slate-600">
                            {row.rCount}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-1.5 text-right font-extrabold text-slate-900 whitespace-nowrap">
                            {formatVnd(row.totalAmountDue)}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-1.5 text-right text-emerald-700 font-bold whitespace-nowrap">
                            {formatVnd(row.totalPaid)}
                          </td>
                          <td
                            className={`px-2 py-1.5 text-right font-extrabold whitespace-nowrap ${
                              row.balanceRemaining > 0 ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {row.overpaidAmount > 0
                              ? `+${formatVnd(row.overpaidAmount)} (thừa)`
                              : formatVnd(row.balanceRemaining)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-sky-100 font-extrabold text-slate-900 border-t-2 border-sky-300">
                    <td
                      colSpan={3}
                      className="sticky left-0 z-10 bg-sky-100 border-r-2 border-sky-300 px-3 py-2 text-center"
                    >
                      TỔNG CỘNG ({filteredRows.length} HS)
                    </td>
                    {summary.days.map((_, dIdx) => {
                      const daySum = filteredRows.reduce(
                        (acc, r) => acc + (r.dayCells[dIdx]?.symbol === 'X' ? 1 : 0),
                        0
                      );
                      return (
                        <td
                          key={`tot_${dIdx}`}
                          className="border-r border-sky-200 py-2 text-center text-[11px]"
                        >
                          {daySum}
                        </td>
                      );
                    })}
                    <td className="border-r border-sky-200 px-2 py-2 text-center">
                      {filteredRows.reduce((a, r) => a + r.xCount, 0)}
                    </td>
                    <td className="border-r border-sky-200 px-2 py-2 text-center text-rose-700">
                      {filteredRows.reduce((a, r) => a + r.vCount, 0)}
                    </td>
                    <td className="border-r border-sky-200 px-2 py-2 text-center text-slate-600">
                      {filteredRows.reduce((a, r) => a + r.rCount, 0)}
                    </td>
                    <td className="border-r border-sky-200 px-2 py-2 text-right whitespace-nowrap">
                      {formatVnd(filteredRows.reduce((a, r) => a + r.totalAmountDue, 0))}
                    </td>
                    <td className="border-r border-sky-200 px-2 py-2 text-right text-emerald-800 whitespace-nowrap">
                      {formatVnd(filteredRows.reduce((a, r) => a + r.totalPaid, 0))}
                    </td>
                    <td className="px-2 py-2 text-right text-rose-800 whitespace-nowrap">
                      {formatVnd(filteredRows.reduce((a, r) => a + r.balanceRemaining, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {effectiveClassFilter === 'all' && filteredRows.length > PAGE_SIZE && (
              <div className="no-print flex items-center justify-between pt-2 text-xs text-slate-600">
                <span>
                  Trang {safePage}/{totalPages} · Hiển thị {visibleTableRows.length}/{filteredRows.length} học sinh (Xuất Excel/PDF sẽ xuất toàn bộ {filteredRows.length} học sinh)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Trang trước
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Trang sau
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 2: THU TIỀN ĂN HỌC SINH ==================== */}
      {subTab === 'collection' && canSeeCollection && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Lọc trạng thái:</span>
              {(
                [
                  ['all', 'Tất cả'],
                  ['unpaid', 'Chưa đóng'],
                  ['partial', 'Đã đóng một phần'],
                  ['paid', 'Đã đóng đủ'],
                  ['overpaid', 'Đóng thừa'],
                ] as const
              ).map(([st, lbl]) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setPaymentStatusFilter(st)}
                  className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer ${
                    paymentStatusFilter === st
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {canExport && (
              <button
                type="button"
                onClick={() =>
                  exportUnpaidStudentsToExcel({
                    summary,
                    studentRows: filteredRows,
                  })
                }
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Xuất DS chưa đóng đủ (.xlsx)</span>
              </button>
            )}
          </div>

          {/* Mobile cards (< md) */}
          <div className="md:hidden space-y-2.5">
            {collectionFilteredRows.slice(0, 80).map((row) => (
              <div
                key={`mob_pay_${row.student.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => setDetailStudentId(row.student.id)}
                      className="text-sm font-extrabold text-slate-900 hover:text-sky-700 text-left cursor-pointer"
                    >
                      {row.student.fullName}
                    </button>
                    <div className="text-xs text-slate-500">
                      Lớp {row.displayClassName} · {row.xCount} suất ăn
                    </div>
                  </div>
                  {renderPaymentStatusBadge(row.paymentStatus)}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 rounded-xl p-2.5 tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500">Phải đóng</div>
                    <div className="font-extrabold text-slate-900">{formatVnd(row.totalAmountDue)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Đã đóng</div>
                    <div className="font-extrabold text-emerald-700">{formatVnd(row.totalPaid)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">
                      {row.overpaidAmount > 0 ? 'Đóng thừa' : 'Còn thiếu'}
                    </div>
                    <div
                      className={`font-extrabold ${
                        row.overpaidAmount > 0
                          ? 'text-sky-700'
                          : row.balanceRemaining > 0
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatVnd(row.overpaidAmount > 0 ? row.overpaidAmount : row.balanceRemaining)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canCollect && (
                    <button
                      type="button"
                      onClick={() => openCollectModal(row)}
                      className="min-h-[38px] flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                    >
                      <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Thu tiền</span>
                    </button>
                  )}
                  {row.payments.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setReceiptTarget({ payment: row.payments[0], studentRow: row })
                      }
                      className="min-h-[38px] inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5 text-sky-600" />
                      <span>In phiếu</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDetailStudentId(row.student.id)}
                    className="min-h-[38px] inline-flex items-center rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    Chi tiết
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table (>= md) */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-xs text-left border-collapse tabular-nums">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold">
                <tr>
                  <th className="p-3">STT</th>
                  <th className="p-3">Họ tên học sinh</th>
                  <th className="p-3">Lớp</th>
                  <th className="p-3 text-center">Suất (X)</th>
                  <th className="p-3 text-right">Tổng phải đóng</th>
                  <th className="p-3 text-right">Đã đóng</th>
                  <th className="p-3 text-right">Còn thiếu / Đóng thừa</th>
                  <th className="p-3 text-center">Trạng thái</th>
                  <th className="p-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {collectionFilteredRows.slice(0, 150).map((row, idx) => (
                  <tr key={`pay_${row.student.id}`} className="hover:bg-slate-50">
                    <td className="p-3 text-slate-500">{idx + 1}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => setDetailStudentId(row.student.id)}
                        className="font-bold text-slate-900 hover:text-sky-700 hover:underline cursor-pointer"
                      >
                        {row.student.fullName}
                      </button>
                      <div className="text-[11px] font-mono text-slate-500">
                        {row.student.studentCode}
                      </div>
                    </td>
                    <td className="p-3 font-bold text-slate-800">{row.displayClassName}</td>
                    <td className="p-3 text-center font-extrabold">{row.xCount}</td>
                    <td className="p-3 text-right font-bold">{formatVnd(row.totalAmountDue)}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">
                      {formatVnd(row.totalPaid)}
                    </td>
                    <td
                      className={`p-3 text-right font-extrabold ${
                        row.overpaidAmount > 0
                          ? 'text-sky-700'
                          : row.balanceRemaining > 0
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {row.overpaidAmount > 0
                        ? `+${formatVnd(row.overpaidAmount)} (thừa)`
                        : formatVnd(row.balanceRemaining)}
                    </td>
                    <td className="p-3 text-center">{renderPaymentStatusBadge(row.paymentStatus)}</td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {canCollect && (
                          <button
                            type="button"
                            onClick={() => openCollectModal(row)}
                            className="min-h-[34px] inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                          >
                            <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Thu tiền</span>
                          </button>
                        )}
                        {row.payments.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setReceiptTarget({ payment: row.payments[0], studentRow: row })
                            }
                            className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5 text-sky-600" />
                            <span>Phiếu thu ({row.payments.length})</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment Audit Logs */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-sky-600" />
              <span>Lịch sử thay đổi khoản thu tháng {selectedMonth} ({monthPaymentLogs.length})</span>
            </h3>
            {monthPaymentLogs.length === 0 ? (
              <p className="text-xs text-slate-500">Chưa có giao dịch thu tiền nào trong tháng này.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <tr>
                      <th className="p-2.5">Thời gian</th>
                      <th className="p-2.5">Học sinh</th>
                      <th className="p-2.5">Lớp</th>
                      <th className="p-2.5">Thao tác</th>
                      <th className="p-2.5 text-right">Trước</th>
                      <th className="p-2.5 text-right">Sau</th>
                      <th className="p-2.5">Người thực hiện</th>
                      <th className="p-2.5">Lý do / Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthPaymentLogs.slice(0, 80).map((l) => (
                      <tr key={l.id}>
                        <td className="p-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {l.timestampIso}
                        </td>
                        <td className="p-2.5 font-bold text-slate-900">{l.studentName}</td>
                        <td className="p-2.5">{l.className}</td>
                        <td className="p-2.5 font-bold">
                          {l.action === 'create'
                            ? 'Thu mới'
                            : l.action === 'update'
                            ? 'Chỉnh sửa'
                            : 'Hủy phiếu'}
                        </td>
                        <td className="p-2.5 text-right text-slate-500">{formatVnd(l.previousAmount)}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-700">
                          {formatVnd(l.newAmount)}
                        </td>
                        <td className="p-2.5">{l.actorName}</td>
                        <td className="p-2.5 text-slate-600">{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 3: TỔNG HỢP TIỀN ĂN TOÀN TRƯỜNG ==================== */}
      {subTab === 'school_summary' && canSeeSchoolSummary && (
        <div className="space-y-4">
          <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold text-slate-700">Tháng xem:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-900"
              />

              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    ['grades', 'Theo Khối'],
                    ['classes', 'Theo Lớp'],
                    ['students', 'Từng Học sinh'],
                    ['months', 'Theo Tháng'],
                  ] as const
                ).map(([mode, lbl]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSchoolViewMode(mode)}
                    className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer whitespace-nowrap ${
                      schoolViewMode === mode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {canExport && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    exportSchoolMonthlyFinancialToExcel({ summary, paymentLogs })
                  }
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Xuất Excel toàn trường</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportSchoolMonthlySummaryToPdf({ summary })}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Xuất PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintLandscape}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-sky-400" />
                  <span>In báo cáo</span>
                </button>
              </div>
            )}
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 tabular-nums">
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Tổng số học sinh</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{summary.totalStudents}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Tổng suất ăn (X)</div>
              <div className="text-xl font-extrabold text-sky-700 mt-1">{summary.totalX}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Tổng lượt vắng (V)</div>
              <div className="text-xl font-extrabold text-rose-600 mt-1">{summary.totalV}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Tổng tiền ăn phải thu</div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900 mt-1">
                {formatVnd(summary.totalAmountDue)}
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
              <div className="text-[11px] font-bold text-emerald-700">Tổng tiền đã thu</div>
              <div className="text-base sm:text-lg font-extrabold text-emerald-800 mt-1">
                {formatVnd(summary.totalPaid)}
              </div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-3.5">
              <div className="text-[11px] font-bold text-rose-700">Còn phải thu / Thừa</div>
              <div className="text-base sm:text-lg font-extrabold text-rose-800 mt-1">
                {formatVnd(summary.totalRemaining)}
              </div>
              {summary.totalOverpaid > 0 && (
                <div className="text-[11px] font-bold text-sky-700">
                  Đóng thừa: {formatVnd(summary.totalOverpaid)}
                </div>
              )}
            </div>
          </div>

          <div className="print-container rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
            {schoolViewMode === 'grades' && (
              <table className="w-full text-xs text-left border-collapse tabular-nums">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold">
                  <tr>
                    <th className="p-3">Khối</th>
                    <th className="p-3 text-center">Số lớp</th>
                    <th className="p-3 text-center">Số HS</th>
                    <th className="p-3 text-center">Tổng suất (X)</th>
                    <th className="p-3 text-center">Vắng (V)</th>
                    <th className="p-3 text-right">Phải thu</th>
                    <th className="p-3 text-right">Đã thu</th>
                    <th className="p-3 text-right">Còn phải thu</th>
                    <th className="p-3 text-right">Đóng thừa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.gradeSummaries.map((g) => (
                    <tr key={g.grade} className="hover:bg-slate-50">
                      <td className="p-3 font-extrabold text-slate-900">Khối {g.grade}</td>
                      <td className="p-3 text-center">{g.classSummaries.length}</td>
                      <td className="p-3 text-center font-bold">{g.studentCount}</td>
                      <td className="p-3 text-center font-extrabold text-sky-700">{g.totalX}</td>
                      <td className="p-3 text-center text-rose-600 font-bold">{g.totalV}</td>
                      <td className="p-3 text-right font-bold">{formatVnd(g.totalAmountDue)}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{formatVnd(g.totalPaid)}</td>
                      <td className="p-3 text-right font-extrabold text-rose-700">{formatVnd(g.totalRemaining)}</td>
                      <td className="p-3 text-right text-sky-700">{formatVnd(g.totalOverpaid)}</td>
                    </tr>
                  ))}
                  <tr className="bg-sky-100 font-extrabold text-slate-900 border-t-2 border-sky-300">
                    <td className="p-3">TOÀN TRƯỜNG</td>
                    <td className="p-3 text-center">{summary.classSummaries.length}</td>
                    <td className="p-3 text-center">{summary.totalStudents}</td>
                    <td className="p-3 text-center">{summary.totalX}</td>
                    <td className="p-3 text-center">{summary.totalV}</td>
                    <td className="p-3 text-right">{formatVnd(summary.totalAmountDue)}</td>
                    <td className="p-3 text-right text-emerald-800">{formatVnd(summary.totalPaid)}</td>
                    <td className="p-3 text-right text-rose-800">{formatVnd(summary.totalRemaining)}</td>
                    <td className="p-3 text-right text-sky-800">{formatVnd(summary.totalOverpaid)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {schoolViewMode === 'classes' && (
              <table className="w-full text-xs text-left border-collapse tabular-nums">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold">
                  <tr>
                    <th className="p-3">STT</th>
                    <th className="p-3">Lớp</th>
                    <th className="p-3">GVCN</th>
                    <th className="p-3 text-center">Số HS</th>
                    <th className="p-3 text-center">Suất (X)</th>
                    <th className="p-3 text-center">Vắng (V)</th>
                    <th className="p-3 text-right">Phải thu</th>
                    <th className="p-3 text-right">Đã thu</th>
                    <th className="p-3 text-right">Còn thiếu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.classSummaries.map((c, idx) => (
                    <tr key={c.classObj.id} className="hover:bg-slate-50">
                      <td className="p-3 text-slate-500">{idx + 1}</td>
                      <td className="p-3 font-extrabold text-slate-900">
                        <button
                          type="button"
                          onClick={() => {
                            setClassFilter(c.classObj.id);
                            setSubTab('table');
                          }}
                          className="text-sky-700 hover:underline cursor-pointer"
                        >
                          Lớp {c.classObj.name}
                        </button>
                      </td>
                      <td className="p-3 text-slate-600">{c.classObj.teacherName}</td>
                      <td className="p-3 text-center font-bold">{c.studentCount}</td>
                      <td className="p-3 text-center font-extrabold">{c.totalX}</td>
                      <td className="p-3 text-center text-rose-600">{c.totalV}</td>
                      <td className="p-3 text-right font-bold">{formatVnd(c.totalAmountDue)}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{formatVnd(c.totalPaid)}</td>
                      <td className="p-3 text-right font-extrabold text-rose-700">{formatVnd(c.totalRemaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {schoolViewMode === 'students' && (
              <div className="space-y-3">
                <div className="relative max-w-sm">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Tìm nhanh học sinh toàn trường..."
                    className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-sm"
                  />
                </div>
                <table className="w-full text-xs text-left border-collapse tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold">
                    <tr>
                      <th className="p-2.5">STT</th>
                      <th className="p-2.5">Học sinh</th>
                      <th className="p-2.5">Lớp</th>
                      <th className="p-2.5 text-center">Suất (X)</th>
                      <th className="p-2.5 text-center">Vắng (V)</th>
                      <th className="p-2.5 text-right">Phải thu</th>
                      <th className="p-2.5 text-right">Đã thu</th>
                      <th className="p-2.5 text-right">Còn thiếu</th>
                      <th className="p-2.5 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.studentRows
                      .filter((r) => {
                        const q = searchTerm.toLowerCase().trim();
                        return (
                          !q ||
                          r.student.fullName.toLowerCase().includes(q) ||
                          r.displayClassName.toLowerCase().includes(q) ||
                          r.student.studentCode.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 150)
                      .map((r, i) => (
                        <tr key={r.student.id} className="hover:bg-slate-50">
                          <td className="p-2.5 text-slate-500">{i + 1}</td>
                          <td className="p-2.5 font-bold">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(r.student.id)}
                              className="text-slate-900 hover:text-sky-700 hover:underline cursor-pointer"
                            >
                              {r.student.fullName}
                            </button>
                          </td>
                          <td className="p-2.5 font-bold">{r.displayClassName}</td>
                          <td className="p-2.5 text-center font-extrabold">{r.xCount}</td>
                          <td className="p-2.5 text-center text-rose-600">{r.vCount}</td>
                          <td className="p-2.5 text-right font-bold">{formatVnd(r.totalAmountDue)}</td>
                          <td className="p-2.5 text-right text-emerald-700 font-bold">{formatVnd(r.totalPaid)}</td>
                          <td className="p-2.5 text-right text-rose-700 font-extrabold">{formatVnd(r.balanceRemaining)}</td>
                          <td className="p-2.5 text-center">{renderPaymentStatusBadge(r.paymentStatus)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {schoolViewMode === 'months' && (
              <table className="w-full text-xs text-left border-collapse tabular-nums">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold">
                  <tr>
                    <th className="p-3">Tháng</th>
                    <th className="p-3 text-center">Trạng thái sổ</th>
                    <th className="p-3 text-center">Số HS</th>
                    <th className="p-3 text-center">Tổng suất (X)</th>
                    <th className="p-3 text-center">Vắng (V)</th>
                    <th className="p-3 text-right">Phải thu</th>
                    <th className="p-3 text-right">Đã thu</th>
                    <th className="p-3 text-right">Còn phải thu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {yearlyMonthSummaries.map((ms) => (
                    <tr key={ms.month} className="hover:bg-slate-50">
                      <td className="p-3 font-extrabold text-slate-900">
                        <button
                          type="button"
                          onClick={() => setSelectedMonth(ms.month)}
                          className="text-sky-700 hover:underline cursor-pointer"
                        >
                          Tháng {String(ms.monthNum).padStart(2, '0')}/{ms.year}
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        {ms.settlement?.isLocked ? (
                          <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                            Đã khóa sổ
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                            Đang mở
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center font-bold">{ms.totalStudents}</td>
                      <td className="p-3 text-center font-extrabold text-sky-700">{ms.totalX}</td>
                      <td className="p-3 text-center text-rose-600">{ms.totalV}</td>
                      <td className="p-3 text-right font-bold">{formatVnd(ms.totalAmountDue)}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{formatVnd(ms.totalPaid)}</td>
                      <td className="p-3 text-right font-extrabold text-rose-700">{formatVnd(ms.totalRemaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 4: CÀI ĐẶT GIÁ SUẤT ĂN ==================== */}
      {subTab === 'pricing' && canSeePricing && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Pricing Rule Form */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {editingRuleId ? 'Cập nhật đơn giá suất ăn' : 'Thiết lập đơn giá suất ăn (VNĐ)'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hệ thống không gán cứng đơn giá mặc định. Khi đơn giá thay đổi giữa tháng, hệ thống tự động tính theo đơn giá áp dụng từng ngày.
                </p>
              </div>

              <form onSubmit={handleSavePricingRule} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Ngày bắt đầu áp dụng *
                    </label>
                    <input
                      type="date"
                      required
                      disabled={!canEditPricing}
                      value={ruleEffectiveFrom}
                      onChange={(e) => setRuleEffectiveFrom(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Đơn giá 1 suất (VNĐ) *
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={5000000}
                      step={500}
                      required
                      disabled={!canEditPricing}
                      placeholder="Nhập đơn giá VNĐ..."
                      value={rulePriceStr}
                      onChange={(e) => setRulePriceStr(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-mono font-extrabold text-slate-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Đối tượng áp dụng
                  </label>
                  <select
                    disabled={!canEditPricing}
                    value={ruleScope}
                    onChange={(e) => setRuleScope(e.target.value as MealPricingScope)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900 disabled:opacity-60"
                  >
                    <option value="school">Toàn trường (61 lớp)</option>
                    <option value="grade">Theo Khối (6, 7, 8, 9)</option>
                    <option value="class">Theo Lớp cụ thể</option>
                    <option value="student_group">Nhóm học sinh riêng (VD: miễn giảm / suất riêng)</option>
                  </select>
                </div>

                {ruleScope === 'grade' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Chọn Khối</label>
                    <select
                      disabled={!canEditPricing}
                      value={ruleGrade}
                      onChange={(e) => setRuleGrade(Number(e.target.value) as GradeLevel)}
                      className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-bold"
                    >
                      <option value={6}>Khối 6</option>
                      <option value={7}>Khối 7</option>
                      <option value={8}>Khối 8</option>
                      <option value={9}>Khối 9</option>
                    </select>
                  </div>
                )}

                {ruleScope === 'class' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Chọn Lớp</label>
                    <select
                      disabled={!canEditPricing}
                      value={ruleClassId}
                      onChange={(e) => setRuleClassId(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-bold"
                    >
                      {activeClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          Lớp {c.name} ({c.teacherName})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {ruleScope === 'student_group' && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Tên nhóm học sinh *
                      </label>
                      <input
                        type="text"
                        placeholder="VD: Nhóm hỗ trợ học phí / Suất ăn đặc biệt"
                        value={ruleGroupTag}
                        onChange={(e) => setRuleGroupTag(e.target.value)}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Chọn học sinh ({ruleStudentIds.length} đã chọn)
                      </label>
                      <input
                        type="text"
                        placeholder="Tìm tên hoặc lớp học sinh..."
                        value={ruleStudentSearch}
                        onChange={(e) => setRuleStudentSearch(e.target.value)}
                        className="w-full min-h-[34px] rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs mb-1.5"
                      />
                      <div className="max-h-36 overflow-y-auto space-y-1 bg-white rounded-lg border border-slate-200 p-2">
                        {studentsForPicker.map((s) => {
                          const checked = ruleStudentIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setRuleStudentIds((prev) =>
                                    checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                                  )
                                }
                              />
                              <span className="font-semibold text-slate-800">{s.fullName}</span>
                              <span className="text-[11px] text-slate-500">({s.className})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú quyết định</label>
                  <input
                    type="text"
                    disabled={!canEditPricing}
                    placeholder="VD: Theo công văn / thông báo tháng..."
                    value={ruleNote}
                    onChange={(e) => setRuleNote(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 disabled:opacity-60"
                  />
                </div>

                {canEditPricing && (
                  <div className="flex items-center gap-2 pt-1">
                    {editingRuleId && (
                      <button
                        type="button"
                        onClick={resetPricingForm}
                        className="min-h-[40px] rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold text-slate-700 cursor-pointer"
                      >
                        Hủy sửa
                      </button>
                    )}
                    <button
                      type="submit"
                      className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-sky-400" />
                      <span>{editingRuleId ? 'Cập nhật đơn giá' : 'Lưu cấu hình đơn giá'}</span>
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Active Pricing Rules List */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold text-slate-900">
                  Bảng đơn giá đang hiệu lực ({activePricingRules.length})
                </h3>
                <span className="text-[11px] text-slate-500">
                  Ưu tiên: Nhóm HS &gt; Lớp &gt; Khối &gt; Toàn trường
                </span>
              </div>

              {activePricingRules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  Chưa có đơn giá nào được thiết lập. Hãy nhập đơn giá VNĐ ở biểu mẫu bên cạnh.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {activePricingRules.map((rule) => {
                    const ruleMonth = rule.effectiveFrom.slice(0, 7);
                    const locked = settlements.some(
                      (s) => s.env === 'production' && s.month === ruleMonth && s.isLocked
                    );
                    const targetText =
                      rule.targetScope === 'school'
                        ? 'Toàn trường'
                        : rule.targetScope === 'grade'
                        ? `Khối ${rule.targetGrade}`
                        : rule.targetScope === 'class'
                        ? `Lớp ${activeClasses.find((c) => c.id === rule.targetClassId)?.name || rule.targetClassId}`
                        : `${rule.groupTag || 'Nhóm HS'} (${rule.studentIds.length} HS)`;

                    return (
                      <div
                        key={rule.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-extrabold text-slate-900 font-mono">
                              {formatVnd(rule.pricePerMeal)} / suất
                            </span>
                            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                              {targetText}
                            </span>
                            {locked && (
                              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 inline-flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                Tháng đã quyết toán
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            Áp dụng từ ngày <strong>{formatVietnameseDate(rule.effectiveFrom)}</strong>
                            {rule.note ? ` · ${rule.note}` : ''}
                          </div>
                        </div>

                        {canEditPricing && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => handleEditRule(rule)}
                              className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => handleDeleteRule(rule)}
                              className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-bold text-rose-600 disabled:opacity-40 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Pricing Audit Logs */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-amber-600" />
              <span>Lịch sử thay đổi đơn giá suất ăn ({pricingLogs.length})</span>
            </h3>
            {pricingLogs.length === 0 ? (
              <p className="text-xs text-slate-500">Chưa có thay đổi đơn giá nào được ghi nhận.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <tr>
                      <th className="p-2.5">Thời gian</th>
                      <th className="p-2.5">Thao tác</th>
                      <th className="p-2.5">Phạm vi</th>
                      <th className="p-2.5">Áp dụng từ</th>
                      <th className="p-2.5 text-right">Giá trước</th>
                      <th className="p-2.5 text-right">Giá mới</th>
                      <th className="p-2.5">Người thực hiện</th>
                      <th className="p-2.5">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pricingLogs.slice(0, 60).map((pl) => (
                      <tr key={pl.id}>
                        <td className="p-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {pl.timestampIso}
                        </td>
                        <td className="p-2.5 font-bold">
                          {pl.action === 'create'
                            ? 'Tạo mới'
                            : pl.action === 'update'
                            ? 'Cập nhật'
                            : 'Xóa'}
                        </td>
                        <td className="p-2.5 font-semibold">{pl.targetLabel}</td>
                        <td className="p-2.5">{formatVietnameseDate(pl.effectiveFrom)}</td>
                        <td className="p-2.5 text-right text-slate-500">{formatVnd(pl.previousPrice)}</td>
                        <td className="p-2.5 text-right font-bold text-slate-900">{formatVnd(pl.newPrice)}</td>
                        <td className="p-2.5">{pl.actorName}</td>
                        <td className="p-2.5 text-slate-600">{pl.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL 1: PHIẾU TỔNG HỢP SUẤT ĂN TỪNG HỌC SINH ==================== */}
      {detailStudentRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  Trường THCS Đông Thạnh
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  PHIẾU TỔNG HỢP SUẤT ĂN THÁNG {String(summary.monthNum).padStart(2, '0')}/{summary.year}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudentId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">Họ và tên:</span>{' '}
                <strong className="text-slate-900">{detailStudentRow.student.fullName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Lớp:</span>{' '}
                <strong className="text-slate-900">{detailStudentRow.displayClassName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Mã HS:</span>{' '}
                <strong className="font-mono">{detailStudentRow.student.studentCode}</strong>
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                {renderPaymentStatusBadge(detailStudentRow.paymentStatus)}
              </div>
              {detailStudentRow.transferNote && (
                <div className="col-span-2 text-amber-800 font-bold pt-1">
                  Lưu ý: {detailStudentRow.transferNote}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden text-xs tabular-nums">
              <div className="divide-y divide-slate-100">
                <div className="flex justify-between p-2.5">
                  <span className="text-slate-600">Tổng số ngày đăng ký ăn (X)</span>
                  <strong className="text-slate-900">{detailStudentRow.xCount} ngày</strong>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-slate-600">Tổng số ngày vắng (V)</span>
                  <strong className="text-rose-700">{detailStudentRow.vCount} ngày</strong>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-slate-600">Tổng số ngày không đăng ký / nghỉ (R)</span>
                  <strong className="text-slate-700">{detailStudentRow.rCount} ngày</strong>
                </div>
                <div className="flex justify-between p-2.5 bg-slate-50">
                  <span className="font-bold text-slate-800">Số suất ăn thực tế phải thanh toán</span>
                  <strong className="text-sky-700">{detailStudentRow.xCount} suất</strong>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-slate-600">Đơn giá một suất ăn</span>
                  <strong className="text-right">
                    {detailStudentRow.hasMultiplePrices
                      ? detailStudentRow.priceTiers
                          .map((t) => `${t.daysCount} ngày × ${formatVnd(t.unitPrice)}`)
                          .join(' + ')
                      : formatVnd(detailStudentRow.primaryUnitPrice)}
                  </strong>
                </div>
                <div className="flex justify-between p-2.5 bg-sky-50 font-extrabold">
                  <span className="text-slate-900">Tổng số tiền phải thanh toán</span>
                  <span className="text-slate-900">{formatVnd(detailStudentRow.totalAmountDue)}</span>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-slate-600">Số tiền đã đóng</span>
                  <strong className="text-emerald-700">{formatVnd(detailStudentRow.totalPaid)}</strong>
                </div>
                <div className="flex justify-between p-2.5 bg-slate-50 font-extrabold">
                  <span className="text-slate-900">
                    {detailStudentRow.overpaidAmount > 0
                      ? 'Số tiền đóng thừa'
                      : 'Số tiền còn phải đóng'}
                  </span>
                  <span
                    className={
                      detailStudentRow.overpaidAmount > 0
                        ? 'text-sky-700'
                        : detailStudentRow.balanceRemaining > 0
                        ? 'text-rose-700'
                        : 'text-emerald-700'
                    }
                  >
                    {formatVnd(
                      detailStudentRow.overpaidAmount > 0
                        ? detailStudentRow.overpaidAmount
                        : detailStudentRow.balanceRemaining
                    )}
                  </span>
                </div>
              </div>
            </div>

            {detailStudentRow.payments.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-800">
                  Các khoản đã thu trong tháng ({detailStudentRow.payments.length})
                </h4>
                <div className="space-y-1.5">
                  {detailStudentRow.payments.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900">
                          {p.receiptNumber} · {formatVnd(p.amountPaid)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatVietnameseDate(p.paymentDate)} · {getPaymentMethodLabel(p.paymentMethod)} · {p.collectorName}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setReceiptTarget({ payment: p, studentRow: detailStudentRow })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 cursor-pointer"
                        >
                          In phiếu
                        </button>
                        {canCollect && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditPaymentTarget(p);
                                setEditPayAmountStr(String(p.amountPaid));
                                setEditPayDate(p.paymentDate);
                                setEditPayMethod(p.paymentMethod);
                                setEditPayNote(p.note);
                                setEditPayReason('');
                              }}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-800 cursor-pointer"
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVoidPaymentTarget(p);
                                setVoidReason('');
                              }}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
              {canCollect && (
                <button
                  type="button"
                  onClick={() => {
                    const target = detailStudentRow;
                    setDetailStudentId(null);
                    openCollectModal(target);
                  }}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                >
                  <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Thu tiền học sinh này</span>
                </button>
              )}
              {canExport && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      exportStudentMonthlySlipToExcel({
                        summary,
                        studentRow: detailStudentRow,
                      })
                    }
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Xuất Phiếu Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportStudentMonthlySlipToPdf({
                        summary,
                        studentRow: detailStudentRow,
                      })
                    }
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Xuất Phiếu PDF</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: CHỈNH SỬA SUẤT ĂN THEO NGÀY (ĐỒNG BỘ TRỰC TIẾP) ==================== */}
      {cellEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                Cập nhật suất ăn ngày {formatVietnameseDate(cellEditTarget.cell.dateStr)}
              </h3>
              <button
                type="button"
                onClick={() => setCellEditTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-slate-600">
              Học sinh: <strong>{cellEditTarget.stuRow.student.fullName}</strong> (Lớp{' '}
              {cellEditTarget.stuRow.displayClassName})
            </div>

            <form onSubmit={handleSaveCellEdit} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['eating', 'X · Có ăn'],
                    ['not_eating', 'V · Vắng mặt'],
                    ['unregistered', 'R · Nghỉ / KĐK'],
                  ] as const
                ).map(([st, label]) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setCellEditStatus(st)}
                    className={`min-h-[42px] rounded-xl border px-2 py-2 text-xs font-extrabold cursor-pointer ${
                      cellEditStatus === st
                        ? 'border-sky-500 bg-sky-50 text-sky-900'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Lý do điều chỉnh (bắt buộc nếu ngày/tháng đã khóa sổ)
                </label>
                <input
                  type="text"
                  value={cellEditReason}
                  onChange={(e) => setCellEditReason(e.target.value)}
                  placeholder="Nhập lý do điều chỉnh suất ăn..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCellEditTarget(null)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Lưu &amp; Đồng bộ ngay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 3: MỞ KHÓA SỔ QUYẾT TOÁN THÁNG ==================== */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">
              Mở khóa sổ quyết toán tháng {selectedMonth}
            </h3>
            <p className="text-xs text-slate-600">
              Việc mở khóa cho phép điều chỉnh lại suất ăn, đơn giá và phiếu thu của tháng này. Vui lòng nhập lý do để lưu lịch sử.
            </p>
            <form onSubmit={handleConfirmUnlockMonth} className="space-y-3">
              <textarea
                rows={3}
                required
                minLength={3}
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="VD: Điều chỉnh lại số suất lớp 9/11 theo đề nghị GVCN..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUnlockModal(false)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-amber-600 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Xác nhận mở khóa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 4: CẤU HÌNH NGÀY NGHỈ & KÝ HIỆU ==================== */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                Cấu hình ngày nghỉ &amp; ý nghĩa ký hiệu suất ăn
              </h3>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  Danh sách ngày nghỉ lễ / ngày nghỉ không ăn toàn trường
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={holidayInput}
                    onChange={(e) => setHolidayInput(e.target.value)}
                    className="flex-1 min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (holidayInput && !draftHolidays.includes(holidayInput)) {
                        setDraftHolidays([...draftHolidays, holidayInput].sort());
                        setHolidayInput('');
                      }
                    }}
                    className="min-h-[38px] rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  >
                    Thêm ngày nghỉ
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {draftHolidays.map((h) => (
                    <span
                      key={h}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold"
                    >
                      {formatVietnameseDate(h)}
                      <button
                        type="button"
                        onClick={() => setDraftHolidays(draftHolidays.filter((x) => x !== h))}
                        className="text-rose-600 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ý nghĩa ký hiệu X</label>
                  <input
                    type="text"
                    required
                    value={draftSymX}
                    onChange={(e) => setDraftSymX(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ý nghĩa ký hiệu V</label>
                  <input
                    type="text"
                    required
                    value={draftSymV}
                    onChange={(e) => setDraftSymV(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ý nghĩa ký hiệu R</label>
                  <input
                    type="text"
                    required
                    value={draftSymR}
                    onChange={(e) => setDraftSymR(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ý nghĩa ô trống</label>
                  <input
                    type="text"
                    required
                    value={draftSymEmpty}
                    onChange={(e) => setDraftSymEmpty(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Lưu cấu hình
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 5: THU TIỀN ĂN HỌC SINH ==================== */}
      {collectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                Ghi nhận thu tiền ăn tháng {selectedMonth}
              </h3>
              <button
                type="button"
                onClick={() => setCollectTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
              <div className="font-extrabold text-slate-900">
                {collectTarget.student.fullName} · Lớp {collectTarget.displayClassName}
              </div>
              <div className="text-slate-600">
                Phải thu: <strong>{formatVnd(collectTarget.totalAmountDue)}</strong> · Đã thu:{' '}
                <strong className="text-emerald-700">{formatVnd(collectTarget.totalPaid)}</strong> · Còn thiếu:{' '}
                <strong className="text-rose-700">{formatVnd(collectTarget.balanceRemaining)}</strong>
              </div>
            </div>
            <form onSubmit={(e) => handleRecordPayment(e, false)} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Số tiền thu (VNĐ) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000000}
                  required
                  value={collectAmountStr}
                  onChange={(e) => setCollectAmountStr(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-base font-mono font-extrabold text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ngày thu *</label>
                  <input
                    type="date"
                    required
                    value={collectDate}
                    onChange={(e) => setCollectDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Hình thức *</label>
                  <select
                    value={collectMethod}
                    onChange={(e) => setCollectMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold"
                  >
                    <option value="cash">Tiền mặt</option>
                    <option value="transfer">Chuyển khoản</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  placeholder="Ghi chú biên lai / người nộp..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm"
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCollectTarget(null)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRecordPayment(e as unknown as React.FormEvent, true)}
                  className="min-h-[40px] inline-flex items-center gap-1 rounded-xl border border-sky-600 bg-sky-50 px-3.5 py-2 text-xs font-extrabold text-sky-800 cursor-pointer"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Lưu &amp; In phiếu thu</span>
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Xác nhận thu tiền
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 6: PHIẾU XÁC NHẬN THU TIỀN (IN ẤN) ==================== */}
      {receiptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="print-container bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Trường THCS Đông Thạnh
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  PHIẾU XÁC NHẬN THU TIỀN ĂN BÁN TRÚ
                </h3>
                <div className="text-xs font-mono text-slate-500">
                  Số phiếu: {receiptTarget.payment.receiptNumber}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptTarget(null)}
                className="no-print p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Học sinh:</span>
                <strong>{receiptTarget.payment.studentName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lớp:</span>
                <strong>{receiptTarget.payment.className}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tháng quyết toán:</span>
                <strong>{receiptTarget.payment.month}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ngày thu:</span>
                <strong>{formatVietnameseDate(receiptTarget.payment.paymentDate)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Hình thức thanh toán:</span>
                <strong>{getPaymentMethodLabel(receiptTarget.payment.paymentMethod)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Người thu:</span>
                <strong>{receiptTarget.payment.collectorName}</strong>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between text-sm font-extrabold text-slate-900">
                <span>Số tiền đã thu (lần này):</span>
                <span className="text-emerald-700">{formatVnd(receiptTarget.payment.amountPaid)}</span>
              </div>
              {receiptTarget.payment.note && (
                <div className="text-[11px] text-slate-600 italic">
                  Ghi chú: {receiptTarget.payment.note}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-6 text-center text-xs font-bold text-slate-700">
              <div>NGƯỜI NỘP TIỀN</div>
              <div>NGƯỜI THU TIỀN</div>
            </div>
            <div className="no-print flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setReceiptTarget(null)}
                className="min-h-[38px] rounded-xl border border-slate-300 px-4 py-1.5 text-xs font-bold cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-extrabold text-white cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-sky-400" />
                <span>In phiếu thu</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 7: CHỈNH SỬA / HỦY PHIẾU THU ==================== */}
      {editPaymentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">
              Chỉnh sửa phiếu thu {editPaymentTarget.receiptNumber}
            </h3>
            <form onSubmit={handleSaveEditPayment} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Số tiền mới (VNĐ) *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={editPayAmountStr}
                  onChange={(e) => setEditPayAmountStr(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ngày thu</label>
                  <input
                    type="date"
                    required
                    value={editPayDate}
                    onChange={(e) => setEditPayDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Hình thức</label>
                  <select
                    value={editPayMethod}
                    onChange={(e) => setEditPayMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold"
                  >
                    <option value="cash">Tiền mặt</option>
                    <option value="transfer">Chuyển khoản</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={editPayNote}
                  onChange={(e) => setEditPayNote(e.target.value)}
                  className="w-full min-h-[38px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-rose-700 mb-1">
                  Lý do chỉnh sửa (Bắt buộc để lưu lịch sử) *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={editPayReason}
                  onChange={(e) => setEditPayReason(e.target.value)}
                  placeholder="VD: Nhập nhầm số tiền / cập nhật hình thức chuyển khoản..."
                  className="w-full min-h-[40px] rounded-xl border border-rose-300 bg-rose-50/40 px-3 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditPaymentTarget(null)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {voidPaymentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-extrabold text-rose-700">
              Hủy phiếu thu {voidPaymentTarget.receiptNumber}
            </h3>
            <p className="text-xs text-slate-600">
              Phiếu thu <strong>{formatVnd(voidPaymentTarget.amountPaid)}</strong> của{' '}
              <strong>{voidPaymentTarget.studentName}</strong> sẽ được đánh dấu đã hủy và trừ khỏi tổng đã thu.
            </p>
            <form onSubmit={handleConfirmVoidPayment} className="space-y-3">
              <input
                type="text"
                required
                minLength={3}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Nhập lý do hủy phiếu thu..."
                className="w-full min-h-[40px] rounded-xl border border-rose-300 bg-rose-50/40 px-3 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVoidPaymentTarget(null)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  Xác nhận hủy phiếu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
