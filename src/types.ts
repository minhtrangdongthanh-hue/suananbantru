import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'teacher' | 'accountant' | 'medical';
export type AccountStatus = 'active' | 'suspended' | 'locked' | 'revoked' | 'pending';
export type RegistrationStatus = 'eating' | 'not_eating' | 'unregistered';
export type AppEnvironment = 'production' | 'sandbox';
export type GradeLevel = 6 | 7 | 8 | 9;
export type StudentGender = 'Nam' | 'Nữ' | 'Khác' | '';
export type AppModuleId =
  | 'teacher'
  | 'monthly_billing'
  | 'reports'
  | 'students'
  | 'users'
  | 'admin'
  | 'verify';

export const SCHOOL_ID = 'THCS_DONG_THANH' as const;
export const BOOTSTRAPPED_ADMIN_EMAIL = 'minhtrangdongthanh@gmail.com';
export const DEFAULT_CUTOFF_TIME = '08:00';
export const BULK_DELETE_CONFIRM_PHRASE = 'XOA TOAN BO HOC SINH';

export const GRADE_CLASS_COUNTS: Record<GradeLevel, number> = {
  6: 14,
  7: 13,
  8: 15,
  9: 19,
};

export interface SystemModuleMeta {
  id: AppModuleId;
  label: string;
  shortLabel: string;
  description: string;
  lockedForAdmin?: boolean;
}

export const SYSTEM_MODULES_META: SystemModuleMeta[] = [
  {
    id: 'teacher',
    label: 'Điểm danh Lớp (QR)',
    shortLabel: 'Điểm danh',
    description: 'Quét QR lớp/học sinh và xác nhận CÓ ĂN / KHÔNG ĂN theo lớp.',
  },
  {
    id: 'monthly_billing',
    label: 'Báo suất ăn tháng – Tính tiền ăn',
    shortLabel: 'Báo ăn tháng',
    description:
      'Bảng chấm suất ăn tháng 1–31, phiếu từng học sinh, cài đặt đơn giá, thu tiền ăn & tổng hợp toàn trường.',
  },
  {
    id: 'reports',
    label: 'Báo cáo & Thống kê',
    shortLabel: 'Báo cáo',
    description: 'Xem thống kê ngày/tháng, nhật ký thay đổi, xuất Excel và in A4.',
  },
  {
    id: 'students',
    label: 'Danh sách Học sinh',
    shortLabel: 'Học sinh',
    description: 'Quản lý danh sách học sinh, nhập Excel, tạo mã QR và lưu trữ năm học.',
  },
  {
    id: 'users',
    label: 'Quản lý Người dùng',
    shortLabel: 'Tài khoản',
    description: 'Quản lý tài khoản, phân quyền theo nhóm và mã chia sẻ lớp cho GVCN.',
    lockedForAdmin: true,
  },
  {
    id: 'admin',
    label: 'Cài đặt & 61 Lớp',
    shortLabel: 'Cài đặt',
    description: 'Thiết lập khóa sổ 08:00, cấu trúc 61 lớp và sao lưu dữ liệu JSON.',
    lockedForAdmin: true,
  },
  {
    id: 'verify',
    label: 'Kiểm thử 16 Kịch bản',
    shortLabel: 'Kiểm thử',
    description: 'Chạy bộ kiểm thử tự động quy trình điểm danh, RBAC và đồng bộ.',
  },
];

export interface PermissionGroup {
  id: UserRole;
  label: string;
  description: string;
  allowedModules: AppModuleId[];
  canMarkAttendance: boolean;
  canExportReports: boolean;
  canManageStudents: boolean;
  canShareClassCode: boolean;
  canManageMealPricing?: boolean;
  canCollectPayments?: boolean;
  updatedAtIso: string;
  updatedByUid: string;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ClassInvite {
  id: string;
  code: string;
  role?: UserRole;
  memberLabel?: string;
  classId: string;
  className: string;
  grade: GradeLevel;
  active: boolean;
  usageCount: number;
  lastUsedByEmail: string;
  lastUsedAtIso: string;
  createdByUid: string;
  createdByName: string;
  updatedAtIso: string;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  assignedClassId: string;
  linkedStudentId: string;
  joinedInviteCode: string;
  lastLoginAtIso?: string;
  schoolId: typeof SCHOOL_ID;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AccountAccess {
  id: string; // normalized email key
  email: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  assignedClassId: string;
  joinedInviteCode: string;
  uid: string;
  lastLoginAtIso: string;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  updatedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SchoolClass {
  id: string;
  name: string;
  grade: GradeLevel;
  order: number;
  teacherName: string;
  teacherEmail: string;
  studentCount: number;
  active: boolean;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  updatedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Student {
  id: string;
  studentCode: string;
  fullName: string;
  classId: string;
  className: string;
  grade: GradeLevel;
  gender: StudentGender;
  qrCode: string;
  parentName: string;
  parentUid: string;
  active: boolean;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  updatedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MealRegistration {
  id: string;
  date: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  className: string;
  grade: GradeLevel;
  status: RegistrationStatus;
  updatedByUid: string;
  updatedByName: string;
  updatedByRole: 'teacher' | 'admin' | 'medical' | 'accountant' | 'system';
  updatedAtIso: string;
  isPostLockAdjustment: boolean;
  adjustmentReason: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RegistrationLog {
  id: string;
  registrationId: string;
  date: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  grade: GradeLevel;
  previousStatus: RegistrationStatus;
  newStatus: RegistrationStatus;
  actorUid: string;
  actorName: string;
  actorRole: 'teacher' | 'admin' | 'medical' | 'accountant' | 'system';
  timestampIso: string;
  isAfterCutoff: boolean;
  reason: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
}

export interface DailyReport {
  id: string;
  date: string;
  isLocked: boolean;
  lockedAtIso: string;
  lockedByUid: string;
  lockedByName: string;
  lockType: 'auto_0800' | 'manual_admin';
  initialTotalEating: number;
  adjustedTotalEating: number;
  totalNotEating: number;
  totalUnregistered: number;
  totalStudents: number;
  grade6Eating: number;
  grade7Eating: number;
  grade8Eating: number;
  grade9Eating: number;
  adjustmentCount: number;
  kitchenConfirmed: boolean;
  kitchenConfirmedAtIso: string;
  kitchenConfirmedByName: string;
  kitchenConfirmedByUid: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ArchivedYearSnapshot {
  id: string;
  academicYear: string;
  archivedAtIso: string;
  archivedByUid: string;
  archivedByName: string;
  scope: string;
  studentCount: number;
  students: Student[];
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
}

export interface SchoolSetting {
  id: string;
  schoolName: string;
  cutoffTime: string;
  academicYear: string;
  semester: 'HK1' | 'HK2';
  autoLockEnabled: boolean;
  studentListVersion: number;
  lastBulkResetAtIso: string;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  updatedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type TombstoneCollection =
  | 'students'
  | 'classes'
  | 'registrations'
  | 'accountAccess'
  | 'dailyReports'
  | 'archivedYears'
  | 'classInvites'
  | 'mealPricingRules'
  | 'mealPayments'
  | 'monthlySettlements';

export type MealSymbolCode = 'X' | 'V' | 'R' | '';
export type MealPricingScope = 'school' | 'grade' | 'class' | 'student_group';
export type PaymentMethod = 'cash' | 'transfer';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface MealPricingRule {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  pricePerMeal: number; // VNĐ >= 0 (no hardcoded default)
  targetScope: MealPricingScope;
  targetGrade: 0 | GradeLevel;
  targetClassId: string;
  groupTag: string;
  studentIds: string[];
  note: string;
  active: boolean;
  createdAtIso: string;
  updatedAtIso: string;
  updatedByUid: string;
  updatedByName: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MealPricingLog {
  id: string;
  ruleId: string;
  action: 'create' | 'update' | 'delete';
  effectiveFrom: string;
  previousPrice: number;
  newPrice: number;
  targetScope: MealPricingScope;
  targetLabel: string;
  note: string;
  actorUid: string;
  actorName: string;
  timestampIso: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
}

export interface MealBillingConfig {
  id: string; // `${env}_billing_config`
  holidays: string[]; // YYYY-MM-DD[] max 200
  symbolXLabel: string;
  symbolVLabel: string;
  symbolRLabel: string;
  symbolEmptyLabel: string;
  updatedAtIso: string;
  updatedByUid: string;
  updatedByName: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MealPayment {
  id: string;
  month: string; // YYYY-MM
  studentId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  className: string;
  grade: GradeLevel;
  amountPaid: number;
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  receiptNumber: string;
  idempotencyKey: string;
  note: string;
  collectorUid: string;
  collectorName: string;
  collectorRole: 'admin' | 'accountant' | 'medical' | 'teacher';
  version: number;
  isVoided: boolean;
  updatedAtIso: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MealPaymentLog {
  id: string;
  paymentId: string;
  month: string;
  studentId: string;
  studentName: string;
  className: string;
  action: 'create' | 'update' | 'void';
  previousAmount: number;
  newAmount: number;
  previousMethod: string;
  newMethod: string;
  reason: string;
  actorUid: string;
  actorName: string;
  actorRole: 'admin' | 'accountant' | 'medical' | 'teacher';
  timestampIso: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
}

export interface MonthlySettlement {
  id: string; // `${env}_${month}`
  month: string; // YYYY-MM
  isLocked: boolean;
  lockedAtIso: string;
  lockedByUid: string;
  lockedByName: string;
  unlockedAtIso: string;
  unlockedByName: string;
  note: string;
  totalStudentsSnapshot: number;
  totalMealsSnapshot: number;
  totalAbsencesSnapshot: number;
  totalAmountDueSnapshot: number;
  totalAmountPaidSnapshot: number;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DeletionTombstone {
  id: string;
  collectionName: TombstoneCollection;
  documentId: string;
  deletedAtMs: number;
  deletedAtIso: string;
  deletedByUid: string;
  reason: string;
  env: AppEnvironment;
  schoolId: typeof SCHOOL_ID;
  visibility: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ClassSummaryRow {
  classObj: SchoolClass;
  totalStudents: number;
  eatingCount: number;
  notEatingCount: number;
  unregisteredCount: number;
  eatingStudents: {
    student: Student;
    registration: MealRegistration;
  }[];
  notEatingStudents: {
    student: Student;
    registration: MealRegistration;
  }[];
  unregisteredStudents: Student[];
}

export interface GradeSummary {
  grade: GradeLevel;
  classCount: number;
  totalStudents: number;
  eatingCount: number;
  notEatingCount: number;
  unregisteredCount: number;
  classes: ClassSummaryRow[];
}

export interface TestScenarioResult {
  id: number;
  title: string;
  description: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

// Sanitization & Blueprint Constraint Helpers
export function sanitizeString(val: string, maxLength: number, fallback = ''): string {
  const trimmed = (val ?? '').trim();
  const effective = trimmed.length > 0 ? trimmed : fallback;
  return effective.slice(0, maxLength);
}

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'id_default';
}

export function normalizeEmailKey(email: string): string {
  return sanitizeId(email.trim().toLowerCase());
}

export function buildStudentQrCode(studentCode: string): string {
  return `DT_HS_${sanitizeId(studentCode.toUpperCase())}`;
}

export function buildClassQrCode(classId: string): string {
  return `DT_CLASS_${sanitizeId(classId)}`;
}

// Vietnam Time (GMT+7) Helpers
export function getVietnamDateParts(dateObj: Date = new Date()): {
  dateStr: string;
  timeStr: string;
  fullDisplay: string;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const year = map.year || '2026';
  const month = map.month || '01';
  const day = map.day || '01';
  const hourStr = map.hour === '24' ? '00' : map.hour || '00';
  const minuteStr = map.minute || '00';
  const secondStr = map.second || '00';

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hourStr}:${minuteStr}`;
  const fullDisplay = `${day}/${month}/${year} ${hourStr}:${minuteStr}:${secondStr} (GMT+7)`;

  return {
    dateStr,
    timeStr,
    fullDisplay,
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
  };
}

export function isDateLockedByClock(
  targetDate: string,
  cutoffTime: string = DEFAULT_CUTOFF_TIME,
  nowDate: Date = new Date()
): boolean {
  const vnNow = getVietnamDateParts(nowDate);
  if (targetDate < vnNow.dateStr) {
    return true;
  }
  if (targetDate > vnNow.dateStr) {
    return false;
  }
  return vnNow.timeStr >= cutoffTime;
}

export function formatVietnameseDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'Quản trị viên';
    case 'teacher':
      return 'Giáo viên chủ nhiệm';
    case 'accountant':
      return 'Kế toán';
    case 'medical':
      return 'Nhân viên Y tế';
  }
}

export function getAccountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case 'active':
      return 'Đang hoạt động';
    case 'suspended':
      return 'Ngưng quyền tạm thời';
    case 'locked':
      return 'Đã khóa tài khoản';
    case 'revoked':
      return 'Đã thu hồi quyền';
    case 'pending':
      return 'Chờ cấp quyền';
  }
}

export function normalizeInviteCode(raw: string): string {
  return (raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

export function extractInviteCodeFromText(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  // 1. Extract query parameter even inside multi-line Zalo/SMS invitation messages
  const paramMatch = trimmed.match(/(?:[?&#\s]|^)(?:invite|access|link)=([a-zA-Z0-9_-]{4,32})/i);
  if (paramMatch?.[1]) {
    return normalizeInviteCode(paramMatch[1]);
  }

  // 2. Try standard URL parsing if string starts with http(s)
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const param =
        url.searchParams.get('invite') ||
        url.searchParams.get('access') ||
        url.searchParams.get('link');
      if (param) return normalizeInviteCode(param);
    } catch {
      // ignore URL parse error and try token fallback
    }
  }

  // 3. Extract standalone school invite code (DT601XXXX, DTKTXXXX, DTYTXXXX...) from pasted message text
  const codeTokenMatch = trimmed.match(/\b(DT(?:6|7|8|9|KT|YT)[A-Z0-9]{4,16})\b/i);
  if (codeTokenMatch?.[1]) {
    return normalizeInviteCode(codeTokenMatch[1]);
  }

  return normalizeInviteCode(trimmed);
}

export function getPublicAppOrigin(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin || '';
  // Production share links must point to the actual Firebase Hosting site.
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall back to current origin */ }
  }
  return origin;
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy textarea copy for Android WebView / Zalo in-app browser
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function generateClassInviteCode(grade: GradeLevel, order: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  const orderStr = String(Math.max(1, order)).padStart(2, '0');
  return `DT${grade}${orderStr}${suffix}`;
}

export function generateRoleInviteCode(role: 'accountant' | 'medical'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  const prefix = role === 'accountant' ? 'DTKT' : 'DTYT';
  return `${prefix}${suffix}`;
}

export function getInviteTargetRole(invite: ClassInvite): UserRole {
  if (invite.role === 'accountant' || invite.role === 'medical' || invite.role === 'teacher') {
    return invite.role;
  }
  return 'teacher';
}

export function getInviteDisplayLabel(invite: ClassInvite): string {
  if (invite.memberLabel && invite.memberLabel.trim()) {
    return invite.memberLabel.trim();
  }
  const role = getInviteTargetRole(invite);
  if (role === 'teacher') {
    return `GVCN Lớp ${invite.className}`;
  }
  return getRoleLabel(role);
}

export function getDefaultPermissionGroups(updatedByUid = 'system'): PermissionGroup[] {
  return [
    {
      id: 'teacher',
      label: 'Giáo viên chủ nhiệm (GVCN)',
      description: 'Xác nhận suất ăn, quét mã QR và xem báo suất ăn tháng cho đúng lớp được phân công.',
      allowedModules: ['teacher', 'monthly_billing'],
      canMarkAttendance: true,
      canExportReports: false,
      canManageStudents: false,
      canShareClassCode: false,
      canManageMealPricing: false,
      canCollectPayments: false,
      updatedAtIso: '',
      updatedByUid,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    },
    {
      id: 'accountant',
      label: 'Kế toán',
      description: 'Theo dõi tổng hợp ngày/tháng, thu tiền ăn học sinh, xuất Excel/PDF và in báo cáo.',
      allowedModules: ['reports', 'monthly_billing'],
      canMarkAttendance: false,
      canExportReports: true,
      canManageStudents: false,
      canShareClassCode: false,
      canManageMealPricing: false,
      canCollectPayments: true,
      updatedAtIso: '',
      updatedByUid,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    },
    {
      id: 'medical',
      label: 'Nhân viên Y tế / Bán trú',
      description: 'Tra cứu danh sách học sinh ăn/không ăn, tổng hợp số suất theo ngày/tháng để phục vụ bán trú.',
      allowedModules: ['reports', 'monthly_billing'],
      canMarkAttendance: false,
      canExportReports: true,
      canManageStudents: false,
      canShareClassCode: false,
      canManageMealPricing: false,
      canCollectPayments: false,
      updatedAtIso: '',
      updatedByUid,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    },
    {
      id: 'admin',
      label: 'Quản trị viên',
      description: 'Toàn quyền quản trị hệ thống, học sinh, 61 lớp, đơn giá suất ăn, khóa sổ tháng & phân quyền.',
      allowedModules: ['teacher', 'monthly_billing', 'reports', 'students', 'users', 'admin', 'verify'],
      canMarkAttendance: true,
      canExportReports: true,
      canManageStudents: true,
      canShareClassCode: true,
      canManageMealPricing: true,
      canCollectPayments: true,
      updatedAtIso: '',
      updatedByUid,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    },
  ];
}

export function resolveEffectiveGroup(
  role: UserRole,
  groups: PermissionGroup[]
): PermissionGroup {
  const defaults = getDefaultPermissionGroups();
  const fallback = defaults.find((g) => g.id === role) || defaults[0];
  const found = groups.find((g) => g.id === role);
  if (!found) return fallback;

  const isLegacyGroupDoc =
    typeof found.canManageMealPricing !== 'boolean' &&
    typeof found.canCollectPayments !== 'boolean';

  const canManageMealPricing =
    typeof found.canManageMealPricing === 'boolean'
      ? found.canManageMealPricing
      : Boolean(fallback.canManageMealPricing);
  const canCollectPayments =
    typeof found.canCollectPayments === 'boolean'
      ? found.canCollectPayments
      : Boolean(fallback.canCollectPayments);

  if (role === 'admin') {
    const mergedModules = Array.from(
      new Set<AppModuleId>([...found.allowedModules, 'users', 'admin', 'monthly_billing'])
    );
    return {
      ...found,
      allowedModules: mergedModules,
      canManageMealPricing: true,
      canCollectPayments: true,
    };
  }
  const upgradedModules =
    isLegacyGroupDoc && !found.allowedModules.includes('monthly_billing')
      ? [...found.allowedModules, 'monthly_billing' as AppModuleId]
      : found.allowedModules;

  return {
    ...found,
    allowedModules: upgradedModules,
    canManageMealPricing,
    canCollectPayments,
  };
}

export function formatVnd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${safe.toLocaleString('vi-VN')} ₫`;
}

export function getPaymentMethodLabel(method: PaymentMethod): string {
  return method === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt';
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'unpaid':
      return 'Chưa đóng';
    case 'partial':
      return 'Đã đóng một phần';
    case 'paid':
      return 'Đã đóng đủ';
    case 'overpaid':
      return 'Đóng thừa';
  }
}


