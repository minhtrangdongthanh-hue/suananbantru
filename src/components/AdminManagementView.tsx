import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  Lock,
  RefreshCw,
  Settings,
  Unlock,
  Upload,
  Users,
} from 'lucide-react';
import {
  DailyReport,
  formatVietnameseDate,
  GradeLevel,
  SchoolClass,
  SchoolSetting,
} from '../types';
import { importBackupJsonData } from '../services/mealService';

interface AdminManagementViewProps {
  date: string;
  onDateChange: (d: string) => void;
  classes: SchoolClass[];
  currentDayReport: DailyReport | null;
  settings: SchoolSetting | null;
  onInitialize61Classes: () => Promise<void>;
  onSaveClass: (cls: {
    id?: string;
    name: string;
    grade: GradeLevel;
    order: number;
    teacherName: string;
    teacherEmail: string;
    studentCount: number;
    active: boolean;
  }) => Promise<void>;
  onSaveSettings: (s: {
    schoolName: string;
    cutoffTime: string;
    academicYear: string;
    semester: 'HK1' | 'HK2';
    autoLockEnabled: boolean;
  }) => Promise<void>;
  onLockCurrentDate: () => Promise<void>;
  onUnlockCurrentDate: () => Promise<void>;
  onBackupJson: () => void;
}

export const AdminManagementView: React.FC<AdminManagementViewProps> = ({
  date,
  onDateChange,
  classes,
  currentDayReport,
  settings,
  onInitialize61Classes,
  onSaveClass,
  onSaveSettings,
  onLockCurrentDate,
  onUnlockCurrentDate,
  onBackupJson,
}) => {
  const [subTab, setSubTab] = useState<'classes' | 'settings'>('settings');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  // Class form state
  const [editingClassId, setEditingClassId] = useState<string | undefined>(undefined);
  const [classNameInput, setClassNameInput] = useState('');
  const [classGradeInput, setClassGradeInput] = useState<GradeLevel>(6);
  const [classOrderInput, setClassOrderInput] = useState(1);
  const [classTeacherInput, setClassTeacherInput] = useState('');
  const [classEmailInput, setClassEmailInput] = useState('');
  const [classActiveInput, setClassActiveInput] = useState(true);

  // Settings form state
  const [schoolName, setSchoolName] = useState(
    settings?.schoolName || 'TRƯỜNG THCS ĐÔNG THẠNH'
  );
  const [cutoffTime, setCutoffTime] = useState(settings?.cutoffTime || '08:00');
  const [academicYear, setAcademicYear] = useState(settings?.academicYear || '2026 - 2027');
  const [semester, setSemester] = useState<'HK1' | 'HK2'>(settings?.semester || 'HK1');
  const [autoLockEnabled, setAutoLockEnabled] = useState(
    settings?.autoLockEnabled !== undefined ? settings.autoLockEnabled : true
  );

  const prodClasses = useMemo(
    () =>
      classes
        .filter((c) => c.env === 'production')
        .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order)),
    [classes]
  );

  const handleSaveClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await onSaveClass({
        id: editingClassId,
        name: classNameInput || `${classGradeInput}/${classOrderInput}`,
        grade: classGradeInput,
        order: classOrderInput,
        teacherName: classTeacherInput || 'GVCN',
        teacherEmail: classEmailInput,
        studentCount: 0,
        active: classActiveInput,
      });
      setEditingClassId(undefined);
      setClassNameInput('');
      setClassTeacherInput('');
      setClassEmailInput('');
      setStatusMessage('Đã lưu thông tin lớp học thành công.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const content = await file.text();
      const res = importBackupJsonData(content);
      setStatusMessage(
        `Đã khôi phục thành công từ file JSON: ${res.classesCount} lớp, ${res.studentsCount} học sinh, ${res.registrationsCount} bản ghi đăng ký.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              subTab === 'settings'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Khóa sổ 08:00 &amp; Sao lưu</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('classes')}
            className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              subTab === 'classes'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Danh bạ 61 Lớp &amp; GVCN</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-mono font-bold text-slate-900"
          />

          {currentDayReport?.isLocked ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErrorMessage(null);
                try {
                  await onUnlockCurrentDate();
                  setStatusMessage(`Đã mở khóa ngày ${formatVietnameseDate(date)} cho phép GVCN cập nhật lại.`);
                } finally {
                  setBusy(false);
                }
              }}
              className="min-h-[42px] flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Mở khóa ngày {formatVietnameseDate(date)}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErrorMessage(null);
                try {
                  await onLockCurrentDate();
                  setStatusMessage(`Đã chốt sổ chính thức ngày ${formatVietnameseDate(date)}.`);
                } finally {
                  setBusy(false);
                }
              }}
              className="min-h-[42px] flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Khóa sổ ngày {formatVietnameseDate(date)}</span>
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-900">
          {errorMessage}
        </div>
      )}

      {/* TAB 1: SYSTEM SETTINGS & BACKUP/RESTORE */}
      {subTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErrorMessage(null);
              try {
                await onSaveSettings({
                  schoolName,
                  cutoffTime,
                  academicYear,
                  semester,
                  autoLockEnabled,
                });
                setStatusMessage('Đã lưu cấu hình giờ khóa sổ và năm học thành công.');
              } finally {
                setBusy(false);
              }
            }}
            className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
          >
            <h3 className="text-base font-extrabold text-slate-900 pb-3 border-b border-slate-100">
              Cấu hình Hệ thống &amp; Giờ Khóa sổ (Mặc định 08:00 GMT+7)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tên đơn vị trường</label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Giờ khóa xác nhận (GMT+7)
                </label>
                <input
                  type="time"
                  value={cutoffTime}
                  onChange={(e) => setCutoffTime(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Năm học</label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Học kỳ hiện tại</label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value as 'HK1' | 'HK2')}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="HK1">Học kỳ I</option>
                  <option value="HK2">Học kỳ II</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={autoLockEnabled}
                onChange={(e) => setAutoLockEnabled(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span>
                Tự động khóa sổ xác nhận và chốt báo cáo đúng {cutoffTime} mỗi ngày.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              Lưu cấu hình hệ thống
            </button>
          </form>

          {/* Backup & Restore Card */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 pb-3 border-b border-slate-100">
              Sao lưu &amp; Khôi phục Dữ liệu (.JSON)
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Xuất file sao lưu toàn bộ lớp, học sinh, lịch sử suất ăn, phân quyền và kho lưu trữ năm học cũ hoặc khôi phục lại từ file đã lưu.
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={onBackupJson}
                className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải file Sao lưu Toàn hệ thống (.JSON)</span>
              </button>

              <input
                ref={jsonFileInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreJsonFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => jsonFileInputRef.current?.click()}
                className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-emerald-600" />
                <span>Khôi phục dữ liệu từ file (.JSON)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 61 CLASSES DIRECTORY */}
      {subTab === 'classes' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Cấu trúc 61 Lớp học – THCS Đông Thạnh ({prodClasses.length} lớp)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Khối 6 (14 lớp) · Khối 7 (13 lớp) · Khối 8 (15 lớp) · Khối 9 (19 lớp).
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onInitialize61Classes();
                  setStatusMessage('Đã đồng bộ chuẩn 61 lớp học (Khối 6, 7, 8, 9) thành công.');
                } finally {
                  setBusy(false);
                }
              }}
              className="min-h-[42px] flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Đồng bộ chuẩn 61 lớp</span>
            </button>
          </div>

          <form
            onSubmit={handleSaveClassSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
          >
            <h4 className="text-sm font-extrabold text-slate-900">
              {editingClassId ? 'Chỉnh sửa thông tin Lớp học' : 'Thêm / Điều chỉnh Lớp học'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Khối</label>
                <select
                  value={classGradeInput}
                  onChange={(e) => setClassGradeInput(Number(e.target.value) as GradeLevel)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold"
                >
                  <option value={6}>Khối 6</option>
                  <option value={7}>Khối 7</option>
                  <option value={8}>Khối 8</option>
                  <option value={9}>Khối 9</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Thứ tự lớp</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={classOrderInput}
                  onChange={(e) => setClassOrderInput(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tên lớp</label>
                <input
                  type="text"
                  placeholder={`${classGradeInput}/${classOrderInput}`}
                  value={classNameInput}
                  onChange={(e) => setClassNameInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Họ tên GVCN *</label>
                <input
                  type="text"
                  required
                  placeholder="Cô Nguyễn Thị A"
                  value={classTeacherInput}
                  onChange={(e) => setClassTeacherInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email GVCN</label>
                <input
                  type="email"
                  placeholder="gvcn@thcsdongthanh.edu.vn"
                  value={classEmailInput}
                  onChange={(e) => setClassEmailInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={classActiveInput}
                  onChange={(e) => setClassActiveInput(e.target.checked)}
                />
                <span>Lớp đang hoạt động</span>
              </label>
              <div className="flex items-center gap-2">
                {editingClassId && (
                  <button
                    type="button"
                    onClick={() => setEditingClassId(undefined)}
                    className="min-h-[40px] rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer"
                  >
                    Hủy
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                >
                  {editingClassId ? 'Cập nhật Lớp' : 'Lưu Lớp học'}
                </button>
              </div>
            </div>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h4 className="text-sm font-extrabold text-slate-900 mb-3">
              Danh bạ {prodClasses.length} lớp học
            </h4>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 text-left">STT</th>
                    <th className="py-2.5 px-3 text-left">Khối</th>
                    <th className="py-2.5 px-3 text-left">Lớp</th>
                    <th className="py-2.5 px-3 text-left">Giáo viên chủ nhiệm</th>
                    <th className="py-2.5 px-3 text-left">Email GVCN</th>
                    <th className="py-2.5 px-3 text-left">Trạng thái</th>
                    <th className="py-2.5 px-3 text-right">Sửa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {prodClasses.map((cls, i) => (
                    <tr key={cls.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-slate-500">{i + 1}</td>
                      <td className="py-2 px-3 font-mono">Khối {cls.grade}</td>
                      <td className="py-2 px-3 font-bold text-slate-900">{cls.name}</td>
                      <td className="py-2 px-3">{cls.teacherName}</td>
                      <td className="py-2 px-3 font-mono text-slate-500">{cls.teacherEmail}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`font-semibold ${
                            cls.active ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {cls.active ? 'Đang hoạt động' : 'Tạm ngưng'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClassId(cls.id);
                            setClassGradeInput(cls.grade);
                            setClassOrderInput(cls.order);
                            setClassNameInput(cls.name);
                            setClassTeacherInput(cls.teacherName);
                            setClassEmailInput(cls.teacherEmail);
                            setClassActiveInput(cls.active);
                          }}
                          className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 font-bold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Sửa</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
