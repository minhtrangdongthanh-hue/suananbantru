import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Clock,
  Lock,
  QrCode,
  Search,
  Share2,
  ShieldAlert,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  ClassInvite,
  DailyReport,
  formatVietnameseDate,
  GradeLevel,
  MealRegistration,
  RegistrationLog,
  RegistrationStatus,
  SchoolClass,
  Student,
  UserRole,
} from '../types';
import {
  createOrRotateClassInvite,
  toggleClassInviteActive,
} from '../services/mealService';
import { QRScannerModal } from './QRScannerModal';
import { buildClassQrItems, QRCodeCardModal } from './QRCodeCardModal';
import { ClassInviteShareModal } from './ClassInviteShareModal';

interface RegistrationWorkspaceViewProps {
  date: string;
  onDateChange: (d: string) => void;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  logs: RegistrationLog[];
  report: DailyReport | null;
  isLocked: boolean;
  cutoffTime: string;
  currentUserRole: UserRole;
  currentUserName: string;
  currentUserUid?: string;
  assignedClassId?: string;
  selectedClassId: string;
  onSelectClassId: (id: string) => void;
  classInvites?: ClassInvite[];
  canShareClassCode?: boolean;
  canMarkAttendance?: boolean;
  pendingSyncCount?: number;
  onSyncPendingNow?: () => Promise<{ syncedCount: number; remainingCount: number }>;
  onRegisterSingle: (
    student: Student,
    status: RegistrationStatus,
    reason?: string
  ) => Promise<{
    unchanged?: boolean;
    syncedToCloud?: boolean;
    pendingReason?: string;
  } | void>;
  onRegisterBatchClass: (
    classStudents: Student[],
    status: 'eating' | 'not_eating',
    reason?: string
  ) => Promise<{
    updatedCount?: number;
    syncedToCloud?: boolean;
    pendingReason?: string;
  } | void>;
}

export const RegistrationWorkspaceView: React.FC<RegistrationWorkspaceViewProps> = ({
  date,
  onDateChange,
  classes,
  students,
  registrations,
  logs,
  report,
  isLocked,
  cutoffTime,
  currentUserRole,
  currentUserName,
  currentUserUid = 'system',
  assignedClassId,
  selectedClassId,
  onSelectClassId,
  classInvites = [],
  canShareClassCode = false,
  canMarkAttendance = true,
  pendingSyncCount = 0,
  onSyncPendingNow,
  onRegisterSingle,
  onRegisterBatchClass,
}) => {
  const [gradeFilter, setGradeFilter] = useState<GradeLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [syncRetryBusy, setSyncRetryBusy] = useState(false);
  const [postLockReason, setPostLockReason] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [showQrCards, setShowQrCards] = useState(false);
  const [showInviteShareModal, setShowInviteShareModal] = useState(false);

  const isTeacher = currentUserRole === 'teacher';

  const formatSaveError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    if (
      raw.includes('permission-denied') ||
      raw.includes('Missing or insufficient permissions')
    ) {
      return 'Máy chủ từ chối quyền lưu (liên kết chia sẻ có thể đã bị tạm khóa, đổi mã hoặc lớp không khớp phân quyền). Vui lòng tải lại trang hoặc liên hệ Quản trị viên.';
    }
    return raw;
  };

  const activeClasses = useMemo(
    () =>
      classes
        .filter((c) => c.env === 'production' && c.active)
        .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order)),
    [classes]
  );

  // Enforce strict GVCN class scope
  const availableClasses = useMemo(() => {
    if (isTeacher) {
      if (!assignedClassId) return [];
      return activeClasses.filter((c) => c.id === assignedClassId);
    }
    return activeClasses.filter((c) => (gradeFilter === 'all' ? true : c.grade === gradeFilter));
  }, [activeClasses, isTeacher, assignedClassId, gradeFilter]);

  const currentClass = useMemo(() => {
    if (isTeacher) {
      return assignedClassId ? activeClasses.find((c) => c.id === assignedClassId) || null : null;
    }
    return availableClasses.find((c) => c.id === selectedClassId) || availableClasses[0] || null;
  }, [isTeacher, assignedClassId, activeClasses, availableClasses, selectedClassId]);

  const classStudents = useMemo(() => {
    if (!currentClass) return [];
    return students
      .filter((s) => s.env === 'production' && s.active && s.classId === currentClass.id)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  }, [students, currentClass]);

  const searchedStudents = useMemo(() => {
    if (!searchQuery.trim()) return classStudents;
    const q = searchQuery.toLowerCase().trim();
    return classStudents.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q) ||
        (s.qrCode && s.qrCode.toLowerCase().includes(q))
    );
  }, [classStudents, searchQuery]);

  const regMap = useMemo(() => {
    const map = new Map<string, MealRegistration>();
    for (const r of registrations) {
      if (r.env === 'production' && r.date === date) {
        map.set(r.studentId, r);
      }
    }
    return map;
  }, [registrations, date]);

  const classSummary = useMemo(() => {
    let eating = 0;
    let notEating = 0;
    let unregistered = 0;
    for (const s of classStudents) {
      const r = regMap.get(s.id);
      const st: RegistrationStatus = r ? r.status : 'unregistered';
      if (st === 'eating') eating++;
      else if (st === 'not_eating') notEating++;
      else unregistered++;
    }
    return {
      total: classStudents.length,
      eating,
      notEating,
      unregistered,
    };
  }, [classStudents, regMap]);

  const handleStatusUpdate = async (student: Student, newStatus: 'eating' | 'not_eating') => {
    setErrorBanner(null);
    setWarningBanner(null);
    setSuccessBanner(null);
    setBusyStudentId(student.id);
    try {
      const res = await onRegisterSingle(student, newStatus, postLockReason);
      const label = newStatus === 'eating' ? 'CÓ ĂN' : 'KHÔNG ĂN';
      if (res && res.syncedToCloud === false) {
        setWarningBanner(
          `Đã lưu tạm trên máy (${student.fullName} — ${label}), nhưng CHƯA gửi được lên máy chủ Cloud (${res.pendingReason || 'mạng yếu'}). Vui lòng kiểm tra mạng và bấm "Đồng bộ lên Cloud ngay".`
        );
      } else if (res && res.unchanged) {
        setSuccessBanner(`Học sinh ${student.fullName} đã ở trạng thái ${label} (không trùng lặp).`);
      } else {
        setSuccessBanner(`Đã lưu lên máy chủ: ${student.fullName} (${student.className}) — ${label}.`);
      }
    } catch (err) {
      setErrorBanner(formatSaveError(err));
    } finally {
      setBusyStudentId(null);
    }
  };

  const handleBatchUpdate = async (status: 'eating' | 'not_eating') => {
    if (!currentClass || classStudents.length === 0) return;
    setErrorBanner(null);
    setWarningBanner(null);
    setSuccessBanner(null);
    setBatchBusy(true);
    try {
      const res = await onRegisterBatchClass(classStudents, status, postLockReason);
      const label = status === 'eating' ? 'CÓ ĂN' : 'KHÔNG ĂN';
      if (res && res.syncedToCloud === false) {
        setWarningBanner(
          `Đã lưu tạm trên máy (${res.updatedCount || classStudents.length} HS — ${label}), nhưng CHƯA gửi lên máy chủ Cloud (${res.pendingReason || 'mạng yếu'}). Vui lòng bấm "Đồng bộ lên Cloud ngay" trước khi thoát.`
        );
      } else {
        setSuccessBanner(`Đã lưu lên máy chủ: ${label} cho cả Lớp ${currentClass.name}.`);
      }
    } catch (err) {
      setErrorBanner(formatSaveError(err));
    } finally {
      setBatchBusy(false);
    }
  };

  const handleManualSyncPending = async () => {
    if (!onSyncPendingNow) return;
    setErrorBanner(null);
    setWarningBanner(null);
    setSyncRetryBusy(true);
    try {
      const res = await onSyncPendingNow();
      if (res.remainingCount === 0) {
        setSuccessBanner(`Đã đồng bộ xong toàn bộ dữ liệu điểm danh lên máy chủ Cloud (${res.syncedCount} mục).`);
      } else {
        setWarningBanner(`Vẫn còn ${res.remainingCount} mục chưa đồng bộ được do mạng yếu. Vui lòng thử lại sau ít giây.`);
      }
    } catch (err) {
      setErrorBanner(formatSaveError(err));
    } finally {
      setSyncRetryBusy(false);
    }
  };

  const relevantLogs = useMemo(() => {
    if (!currentClass) return [];
    return logs.filter(
      (l) => l.env === 'production' && l.classId === currentClass.id && l.date === date
    );
  }, [logs, currentClass, date]);

  const qrItems = useMemo(() => {
    if (!currentClass) return [];
    return buildClassQrItems(currentClass, classStudents);
  }, [currentClass, classStudents]);

  const currentClassInvite = useMemo(() => {
    if (!currentClass) return null;
    return (
      classInvites.find((i) => i.classId === currentClass.id && i.active) ||
      classInvites.find((i) => i.classId === currentClass.id) ||
      null
    );
  }, [classInvites, currentClass]);

  const handleCreateOrRotateInvite = async (
    cls: SchoolClass,
    existing?: ClassInvite | null
  ): Promise<ClassInvite> => {
    const existingForClass = classInvites.filter((i) => i.classId === cls.id);
    const created = await createOrRotateClassInvite({
      schoolClass: cls,
      actorUid: currentUserUid,
      actorName: currentUserName,
      existingInvitesForClass: existing ? existingForClass : [],
    });
    setSuccessBanner(`Đã tạo mã mời GVCN vào Lớp ${cls.name}: ${created.code}.`);
    return created;
  };

  const handleToggleInvite = async (invite: ClassInvite, nextActive: boolean) => {
    await toggleClassInviteActive({ invite, active: nextActive });
    setSuccessBanner(
      `Đã ${nextActive ? 'mở lại' : 'tạm khóa'} mã mời ${invite.code} của Lớp ${invite.className}.`
    );
  };

  if (isTeacher && !currentClass) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center space-y-2">
        <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          Tài khoản GVCN chưa được phân công lớp phụ trách
        </h2>
        <p className="text-sm text-slate-700 max-w-md mx-auto">
          Để bảo mật dữ liệu theo lớp, vui lòng dùng mã chia sẻ lớp từ Quản trị viên hoặc liên hệ Quản trị viên vào mục{' '}
          <strong>Quản lý Người dùng</strong> để gán đúng lớp bạn chủ nhiệm.
        </p>
      </div>
    );
  }

  const canModify = canMarkAttendance && (!isLocked || currentUserRole === 'admin');

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Android-first Hero Header + Primary QR Action */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-sky-700">ĐIỂM DANH SUẤT ĂN LỚP</span>
              <span aria-hidden="true">·</span>
              <span>Khóa sổ {cutoffTime} (GMT+7)</span>
            </div>
            <h2 className="mt-0.5 text-xl sm:text-2xl font-extrabold text-slate-900">
              Lớp {currentClass?.name || '---'}
              {currentClass?.teacherName && (
                <span className="text-sm font-medium text-slate-500 ml-2">
                  ({currentClass.teacherName})
                </span>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="flex-1 sm:flex-none min-w-0 min-h-[44px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono font-bold text-slate-900 cursor-pointer"
            />
            <div
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-bold flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                isLocked
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              {isLocked ? (
                <>
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Đã khóa ({cutoffTime})</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Đang mở</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Big Mobile-Friendly QR Scanner CTA + Print QR + Share Class Code */}
        <div
          className={`grid gap-2 sm:gap-3 ${
            canShareClassCode && currentClass
              ? 'grid-cols-2 lg:grid-cols-3'
              : currentClass
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1'
          }`}
        >
          <button
            type="button"
            disabled={!canMarkAttendance}
            onClick={() => setShowQrScanner(true)}
            className={`min-h-[50px] w-full flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-sky-700 active:scale-[0.99] transition-all cursor-pointer shadow-xs disabled:opacity-40 whitespace-nowrap ${
              canShareClassCode && currentClass ? 'col-span-2 lg:col-span-1' : ''
            }`}
          >
            <Camera className="w-5 h-5 shrink-0" />
            <span>QUÉT MÃ QR ĐIỂM DANH</span>
          </button>

          {currentClass && (
            <button
              type="button"
              onClick={() => setShowQrCards(true)}
              className="min-h-[46px] sm:min-h-[50px] w-full flex items-center justify-center gap-1.5 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs sm:text-sm font-bold text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 shrink-0" />
              <span className="sm:hidden">Mã QR ({currentClass.name})</span>
              <span className="hidden sm:inline">Xem &amp; In Mã QR Lớp {currentClass.name}</span>
            </button>
          )}

          {canShareClassCode && currentClass && (
            <button
              type="button"
              onClick={() => setShowInviteShareModal(true)}
              className="min-h-[46px] sm:min-h-[50px] w-full flex items-center justify-center gap-1.5 rounded-2xl border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs sm:text-sm font-bold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
            >
              <Share2 className="w-4 h-4 sm:w-5 sm:h-5 text-sky-700 shrink-0" />
              <span className="sm:hidden">Chia sẻ lớp</span>
              <span className="hidden sm:inline">Chia sẻ mã lớp cho GV</span>
            </button>
          )}
        </div>

        {/* Grade & Class Selector (Admin only — Teachers are strictly scoped to their assigned class) */}
        {!isTeacher && (
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto no-scrollbar">
              {(['all', 6, 7, 8, 9] as const).map((g) => (
                <button
                  key={String(g)}
                  type="button"
                  onClick={() => {
                    setGradeFilter(g);
                    const firstInGrade = activeClasses.find((c) =>
                      g === 'all' ? true : c.grade === g
                    );
                    if (firstInGrade) onSelectClassId(firstInGrade.id);
                  }}
                  className={`min-h-[38px] px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    gradeFilter === g
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {g === 'all' ? 'Tất cả' : `Khối ${g}`}
                </button>
              ))}
            </div>

            <select
              value={currentClass?.id || ''}
              onChange={(e) => onSelectClassId(e.target.value)}
              className="min-h-[44px] flex-1 sm:max-w-xs rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 cursor-pointer"
            >
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  Lớp {c.name} — {c.teacherName}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Post-Lock Admin Override Input */}
        {isLocked && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-2">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  Ngày {formatVietnameseDate(date)} đã khóa sổ ({cutoffTime}).
                </p>
                <p className="mt-0.5 text-amber-800">
                  Số suất chốt ban đầu: <strong>{report?.initialTotalEating ?? 0} suất</strong>.
                  {isTeacher
                    ? ' Giáo viên chủ nhiệm không thể chỉnh sửa sau khi đã khóa sổ.'
                    : ' Quản trị viên có thể điều chỉnh ngoại lệ khi nhập lý do bên dưới.'}
                </p>
              </div>
            </div>
            {currentUserRole === 'admin' && (
              <input
                type="text"
                value={postLockReason}
                onChange={(e) => setPostLockReason(e.target.value)}
                placeholder="Nhập lý do điều chỉnh ngoại lệ sau giờ khóa (bắt buộc)..."
                className="w-full min-h-[44px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            )}
          </div>
        )}

        {pendingSyncCount > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs sm:text-sm font-bold text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Có <strong>{pendingSyncCount}</strong> dữ liệu điểm danh đang lưu tạm trên máy và CHƯA lên máy chủ Cloud. Vui lòng không đóng trình duyệt trước khi đồng bộ xong.
              </span>
            </div>
            {onSyncPendingNow && (
              <button
                type="button"
                disabled={syncRetryBusy}
                onClick={handleManualSyncPending}
                className="min-h-[40px] rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
              >
                {syncRetryBusy ? 'Đang gửi...' : 'Đồng bộ lên Cloud ngay'}
              </button>
            )}
          </div>
        )}

        {warningBanner && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>{warningBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setWarningBanner(null)}
              className="p-1 text-amber-600 hover:text-amber-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorBanner && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successBanner && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="p-1 text-emerald-600 hover:text-emerald-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Empty Class Notice */}
      {currentClass && classStudents.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-2">
          <Users className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">
            Lớp {currentClass.name} hiện chưa có học sinh
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Danh sách học sinh được Quản trị viên nhập từ file Excel. Vui lòng liên hệ Quản trị viên nếu lớp cần bổ sung học sinh.
          </p>
        </div>
      )}

      {/* Class Summary + Batch Actions + Mobile Cards / Desktop Table */}
      {currentClass && classStudents.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-4 gap-1.5 sm:gap-3 tabular-nums">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 sm:p-3 text-center sm:text-left">
                <span className="text-[11px] sm:text-xs text-slate-500 block truncate">
                  <span className="sm:hidden">Sĩ số</span>
                  <span className="hidden sm:inline">Sĩ số Lớp {currentClass.name}</span>
                </span>
                <span className="text-lg sm:text-2xl font-extrabold font-mono text-slate-900">
                  {classSummary.total}
                </span>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 sm:p-3 text-center sm:text-left">
                <span className="text-[11px] sm:text-xs text-emerald-700 font-semibold block truncate">Có ăn</span>
                <span className="text-lg sm:text-2xl font-extrabold font-mono text-emerald-700">
                  {classSummary.eating}
                </span>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 sm:p-3 text-center sm:text-left">
                <span className="text-[11px] sm:text-xs text-rose-700 font-semibold block truncate">
                  <span className="sm:hidden">Không</span>
                  <span className="hidden sm:inline">Không ăn</span>
                </span>
                <span className="text-lg sm:text-2xl font-extrabold font-mono text-rose-700">
                  {classSummary.notEating}
                </span>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 sm:p-3 text-center sm:text-left">
                <span className="text-[11px] sm:text-xs text-amber-800 font-semibold block truncate">
                  <span className="sm:hidden">Chưa XN</span>
                  <span className="hidden sm:inline">Chưa xác nhận</span>
                </span>
                <span className="text-lg sm:text-2xl font-extrabold font-mono text-amber-800">
                  {classSummary.unregistered}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={batchBusy || !canModify}
                onClick={() => handleBatchUpdate('eating')}
                className="min-h-[48px] rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-40 cursor-pointer"
              >
                {batchBusy ? 'Đang lưu...' : `Xác nhận CÓ ĂN cả lớp (${classSummary.total} HS)`}
              </button>
              <button
                type="button"
                disabled={batchBusy || !canModify}
                onClick={() => handleBatchUpdate('not_eating')}
                className="min-h-[48px] rounded-xl border-2 border-rose-300 bg-white px-4 py-2.5 text-sm font-extrabold text-rose-700 hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
              >
                Báo KHÔNG ĂN cả lớp
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm nhanh theo tên học sinh hoặc mã học sinh..."
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Android Mobile Card List (< md) */}
            <div className="space-y-3 md:hidden">
              {searchedStudents.map((stu, idx) => {
                const reg = regMap.get(stu.id);
                const status: RegistrationStatus = reg ? reg.status : 'unregistered';
                const isRowBusy = busyStudentId === stu.id;

                return (
                  <div
                    key={stu.id}
                    className={`rounded-2xl border p-4 space-y-3 ${
                      status === 'eating'
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : status === 'not_eating'
                        ? 'border-rose-200 bg-rose-50/30'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-mono text-slate-500">
                          #{idx + 1} · {stu.studentCode}
                        </span>
                        <h4 className="text-base font-extrabold text-slate-900">{stu.fullName}</h4>
                        {reg && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Cập nhật: {reg.updatedByName} · {reg.updatedAtIso}
                          </p>
                        )}
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-extrabold shrink-0 ${
                          status === 'eating'
                            ? 'bg-emerald-100 text-emerald-800'
                            : status === 'not_eating'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {status === 'eating'
                          ? 'CÓ ĂN'
                          : status === 'not_eating'
                          ? 'KHÔNG ĂN'
                          : 'CHƯA XN'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={!canModify || isRowBusy}
                        onClick={() => handleStatusUpdate(stu, 'eating')}
                        className={`min-h-[48px] rounded-xl text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 ${
                          status === 'eating'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                        <span>CÓ ĂN</span>
                      </button>
                      <button
                        type="button"
                        disabled={!canModify || isRowBusy}
                        onClick={() => handleStatusUpdate(stu, 'not_eating')}
                        className={`min-h-[48px] rounded-xl text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 ${
                          status === 'not_eating'
                            ? 'bg-rose-600 text-white shadow-xs'
                            : 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
                        }`}
                      >
                        <X className="w-4 h-4" />
                        <span>KHÔNG ĂN</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tablet & Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                    <th className="py-3 px-3 text-left font-bold w-12">STT</th>
                    <th className="py-3 px-3 text-left font-bold w-28">Mã HS</th>
                    <th className="py-3 px-3 text-left font-bold">Họ và tên học sinh</th>
                    <th className="py-3 px-3 text-left font-bold w-24">Giới tính</th>
                    <th className="py-3 px-3 text-left font-bold">Trạng thái</th>
                    <th className="py-3 px-3 text-left font-bold">Cập nhật cuối</th>
                    <th className="py-3 px-3 text-right font-bold w-56">Xác nhận</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {searchedStudents.map((stu, idx) => {
                    const reg = regMap.get(stu.id);
                    const status: RegistrationStatus = reg ? reg.status : 'unregistered';
                    const isRowBusy = busyStudentId === stu.id;

                    return (
                      <tr key={stu.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono text-xs text-slate-500">{idx + 1}</td>
                        <td className="py-3 px-3 font-mono text-xs font-bold text-slate-700">
                          {stu.studentCode}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">{stu.fullName}</td>
                        <td className="py-3 px-3 text-xs text-slate-600">{stu.gender || '—'}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block rounded-lg px-2.5 py-1 text-xs font-extrabold ${
                              status === 'eating'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : status === 'not_eating'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {status === 'eating'
                              ? 'CÓ ĂN'
                              : status === 'not_eating'
                              ? 'KHÔNG ĂN'
                              : 'CHƯA XÁC NHẬN'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600">
                          {reg ? (
                            <div>
                              <span className="font-semibold text-slate-800">
                                {reg.updatedByName}
                              </span>
                              <div className="font-mono text-[11px] text-slate-400">
                                {reg.updatedAtIso}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">Chưa có bản ghi</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!canModify || isRowBusy}
                              onClick={() => handleStatusUpdate(stu, 'eating')}
                              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-40 ${
                                status === 'eating'
                                  ? 'bg-emerald-600 text-white'
                                  : 'border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              CÓ ĂN
                            </button>
                            <button
                              type="button"
                              disabled={!canModify || isRowBusy}
                              onClick={() => handleStatusUpdate(stu, 'not_eating')}
                              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-40 ${
                                status === 'not_eating'
                                  ? 'bg-rose-600 text-white'
                                  : 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
                              }`}
                            >
                              KHÔNG ĂN
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Class Audit Trail */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <UserCheck className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Lịch sử xác nhận Lớp {currentClass.name} ({formatVietnameseDate(date)})
              </h3>
            </div>
            {relevantLogs.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Chưa có thay đổi nào được ghi nhận trong ngày này.
              </p>
            ) : (
              <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                {relevantLogs.slice(0, 15).map((l) => (
                  <div
                    key={l.id}
                    className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <strong className="text-slate-900">{l.studentName}</strong>
                      <span className="text-slate-500 mx-1.5">→</span>
                      <strong
                        className={
                          l.newStatus === 'eating' ? 'text-emerald-700' : 'text-rose-700'
                        }
                      >
                        {l.newStatus === 'eating' ? 'CÓ ĂN' : 'KHÔNG ĂN'}
                      </strong>
                      {l.reason && <span className="text-slate-500 ml-2">({l.reason})</span>}
                    </div>
                    <div className="text-slate-500 font-mono text-[11px]">
                      {l.actorName} · {l.timestampIso}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      <QRScannerModal
        isOpen={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        date={date}
        isLocked={isLocked}
        currentUserRole={currentUserRole}
        assignedClassId={assignedClassId}
        classes={classes}
        students={students}
        registrations={registrations}
        onSelectClass={(cid) => {
          if (!isTeacher || cid === assignedClassId) {
            onSelectClassId(cid);
          }
        }}
        onConfirmStudentMeal={async (stu, status) =>
          onRegisterSingle(stu, status, postLockReason)
        }
      />

      {/* QR Code Viewer & Printer Modal */}
      {currentClass && (
        <QRCodeCardModal
          isOpen={showQrCards}
          onClose={() => setShowQrCards(false)}
          title={`Mã QR Điểm danh – Lớp ${currentClass.name}`}
          subtitle="Quét mã lớp để mở nhanh danh sách, hoặc quét mã từng học sinh để xác nhận ĂN / KHÔNG ĂN"
          items={qrItems}
        />
      )}

      {/* Class Invite Share Modal */}
      <ClassInviteShareModal
        isOpen={showInviteShareModal}
        onClose={() => setShowInviteShareModal(false)}
        schoolClass={currentClass}
        invite={currentClassInvite}
        onCreateOrRotate={handleCreateOrRotateInvite}
        onToggleActive={handleToggleInvite}
      />
    </div>
  );
};
