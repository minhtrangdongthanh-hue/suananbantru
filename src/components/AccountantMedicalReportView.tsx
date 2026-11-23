import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Printer,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import {
  DailyReport,
  formatVietnameseDate,
  getRoleLabel,
  GradeLevel,
  MealRegistration,
  RegistrationLog,
  RegistrationStatus,
  SchoolClass,
  Student,
  UserRole,
} from '../types';
import { computeSchoolSummaries } from '../services/mealService';
import { PrintReportView } from './PrintReportView';

interface AccountantMedicalReportViewProps {
  date: string;
  onDateChange: (d: string) => void;
  classes: SchoolClass[];
  students: Student[];
  allRegistrations: MealRegistration[];
  reports: DailyReport[];
  logs: RegistrationLog[];
  currentUserRole: UserRole;
  canExportReports?: boolean;
  onExportExcel: (monthFilter?: string) => void;
}

export const AccountantMedicalReportView: React.FC<AccountantMedicalReportViewProps> = ({
  date,
  onDateChange,
  classes,
  students,
  allRegistrations,
  reports,
  logs,
  currentUserRole,
  canExportReports = true,
  onExportExcel,
}) => {
  const [subTab, setSubTab] = useState<'daily' | 'monthly' | 'logs' | 'print'>('daily');
  const [selectedMonth, setSelectedMonth] = useState(date.slice(0, 7));
  const [gradeFilter, setGradeFilter] = useState<'all' | GradeLevel>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RegistrationStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!canExportReports && subTab === 'print') {
      setSubTab('daily');
    }
  }, [canExportReports, subTab]);

  const dayRegistrations = useMemo(
    () => allRegistrations.filter((r) => r.env === 'production' && r.date === date),
    [allRegistrations, date]
  );

  const dayReport = useMemo(
    () => reports.find((r) => r.env === 'production' && r.date === date) || null,
    [reports, date]
  );

  const summary = useMemo(
    () => computeSchoolSummaries(classes, students, dayRegistrations, 'production'),
    [classes, students, dayRegistrations]
  );

  const regMap = useMemo(() => {
    const m = new Map<string, MealRegistration>();
    for (const r of dayRegistrations) m.set(r.studentId, r);
    return m;
  }, [dayRegistrations]);

  const activeStudents = useMemo(
    () =>
      students
        .filter((s) => s.env === 'production' && s.active)
        .sort((a, b) =>
          a.className !== b.className
            ? a.className.localeCompare(b.className, 'vi')
            : a.fullName.localeCompare(b.fullName, 'vi')
        ),
    [students]
  );

  const filteredStudentRows = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return activeStudents.filter((s) => {
      if (gradeFilter !== 'all' && s.grade !== gradeFilter) return false;
      if (classFilter !== 'all' && s.classId !== classFilter) return false;
      const reg = regMap.get(s.id);
      const st: RegistrationStatus = reg ? reg.status : 'unregistered';
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (
        q &&
        !s.fullName.toLowerCase().includes(q) &&
        !s.studentCode.toLowerCase().includes(q) &&
        !s.className.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [activeStudents, gradeFilter, classFilter, statusFilter, searchTerm, regMap]);

  // Filtered Class Rows for Class Summary Grid
  const filteredClassRows = useMemo(() => {
    return summary.allClassRows.filter((row) => {
      if (gradeFilter !== 'all' && row.classObj.grade !== gradeFilter) return false;
      if (classFilter !== 'all' && row.classObj.id !== classFilter) return false;
      return true;
    });
  }, [summary.allClassRows, gradeFilter, classFilter]);

  // Monthly Statistics
  const monthlyStats = useMemo(() => {
    const monthRegs = allRegistrations.filter(
      (r) => r.env === 'production' && r.date.startsWith(selectedMonth)
    );
    const dates = Array.from(new Set(monthRegs.map((r) => r.date))).sort((a, b) =>
      b.localeCompare(a)
    );

    const rows = dates.map((d) => {
      const dRegs = monthRegs.filter((r) => r.date === d);
      const dSum = computeSchoolSummaries(classes, students, dRegs, 'production');
      const dRep = reports.find((rp) => rp.env === 'production' && rp.date === d);
      return {
        date: d,
        eating: dSum.totalEating,
        notEating: dSum.totalNotEating,
        unregistered: dSum.totalUnregistered,
        g6: dSum.grade6Eating,
        g7: dSum.grade7Eating,
        g8: dSum.grade8Eating,
        g9: dSum.grade9Eating,
        isLocked: Boolean(dRep?.isLocked),
      };
    });

    const totalEatingMonth = rows.reduce((acc, r) => acc + r.eating, 0);
    const totalNotEatingMonth = rows.reduce((acc, r) => acc + r.notEating, 0);
    return { rows, totalEatingMonth, totalNotEatingMonth };
  }, [allRegistrations, selectedMonth, classes, students, reports]);

  const dayLogs = useMemo(
    () =>
      logs
        .filter((l) => l.env === 'production' && l.date === date)
        .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso)),
    [logs, date]
  );

  const totalRegistered = summary.totalEating + summary.totalNotEating;

  return (
    <div className="space-y-5">
      {/* Header & Top Action Bar */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-bold text-sky-700">{getRoleLabel(currentUserRole).toUpperCase()}</span>
              <span aria-hidden="true">·</span>
              <span>Chế độ tra cứu, tổng hợp &amp; xuất báo cáo chuẩn</span>
            </div>
            <h2 className="mt-0.5 text-xl font-extrabold text-slate-900">
              Báo cáo Tổng hợp Suất ăn – Ngày {formatVietnameseDate(date)}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                onDateChange(e.target.value);
                setSelectedMonth(e.target.value.slice(0, 7));
              }}
              className="min-h-[44px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono font-bold text-slate-900 cursor-pointer"
            />
            {canExportReports && (
              <>
                <button
                  type="button"
                  onClick={() => onExportExcel(selectedMonth)}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Xuất Excel ({formatVietnameseDate(date)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('print');
                    setTimeout(() => window.print(), 250);
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  <Printer className="w-4 h-4" />
                  <span>In Báo cáo A4</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 5 Crisp KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <span className="text-xs text-slate-500 block">Tổng HS toàn trường</span>
            <span className="text-2xl font-extrabold font-mono text-slate-900">
              {summary.totalStudents}
            </span>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5">
            <span className="text-xs text-sky-800 font-semibold block">Đã đăng ký (XN)</span>
            <span className="text-2xl font-extrabold font-mono text-sky-900">
              {totalRegistered}
            </span>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
            <span className="text-xs text-emerald-800 font-semibold block">Số HS CÓ ĂN</span>
            <span className="text-2xl font-extrabold font-mono text-emerald-700">
              {summary.totalEating}
            </span>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5">
            <span className="text-xs text-rose-800 font-semibold block">Số HS KHÔNG ĂN</span>
            <span className="text-2xl font-extrabold font-mono text-rose-700">
              {summary.totalNotEating}
            </span>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 col-span-2 sm:col-span-1">
            <span className="text-xs text-amber-800 font-semibold block">CHƯA XÁC NHẬN</span>
            <span className="text-2xl font-extrabold font-mono text-amber-800">
              {summary.totalUnregistered}
            </span>
          </div>
        </div>

        {/* Sub-tab Switcher */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubTab('daily')}
            className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              subTab === 'daily' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Tổng hợp Ngày &amp; Tra cứu HS</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('monthly')}
            className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              subTab === 'monthly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Thống kê theo Tháng</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              subTab === 'logs' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Lịch sử thay đổi ({dayLogs.length})</span>
          </button>
          {canExportReports && (
            <button
              type="button"
              onClick={() => setSubTab('print')}
              className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                subTab === 'print' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Mẫu In A4 chính thức</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: DAILY BREAKDOWN + STUDENT STATUS LOOKUP */}
      {subTab === 'daily' && (
        <div className="space-y-5">
          {/* Grade Summary Table / Mobile Cards */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h3 className="text-sm font-extrabold text-slate-900 mb-3">
              I. Tổng hợp theo 4 Khối lớp – Ngày {formatVietnameseDate(date)}
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:hidden tabular-nums">
              {summary.grades.map((g) => (
                <div key={`mob_g_${g.grade}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-900">Khối {g.grade}</span>
                    <span className="text-[11px] font-mono text-slate-500">{g.classCount} lớp · {g.totalStudents} HS</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                    <div className="rounded bg-emerald-50 py-1 text-emerald-700 font-bold">
                      Ăn: <span className="font-mono font-extrabold">{g.eatingCount}</span>
                    </div>
                    <div className="rounded bg-rose-50 py-1 text-rose-700 font-bold">
                      Nghỉ: <span className="font-mono font-extrabold">{g.notEatingCount}</span>
                    </div>
                    <div className="rounded bg-amber-50 py-1 text-amber-800 font-bold">
                      Chưa: <span className="font-mono font-extrabold">{g.unregisteredCount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3 text-left font-bold">Khối</th>
                    <th className="py-2.5 px-3 text-right font-bold">Số lớp</th>
                    <th className="py-2.5 px-3 text-right font-bold">Sĩ số</th>
                    <th className="py-2.5 px-3 text-right font-bold text-emerald-700">Có ăn</th>
                    <th className="py-2.5 px-3 text-right font-bold text-rose-700">Không ăn</th>
                    <th className="py-2.5 px-3 text-right font-bold text-amber-800">Chưa xác nhận</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {summary.grades.map((g) => (
                    <tr key={g.grade} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-bold text-slate-900">Khối {g.grade}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{g.classCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{g.totalStudents}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-extrabold text-emerald-700">
                        {g.eatingCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                        {g.notEatingCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                        {g.unregisteredCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Filters for Class & Student Lookup */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-slate-900">
                II. Tra cứu Chi tiết Từng Học sinh &amp; Danh sách Chưa xác nhận
              </h3>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter('unregistered')}
                  className={`min-h-[36px] px-3 py-1 rounded-lg font-bold cursor-pointer ${
                    statusFilter === 'unregistered'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  Lọc HS Chưa xác nhận ({summary.totalUnregistered})
                </button>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="min-h-[36px] px-3 py-1 rounded-lg bg-slate-100 font-bold text-slate-700 cursor-pointer"
                  >
                    Hiện tất cả
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm tên, mã HS, lớp..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900"
                />
              </div>

              <select
                value={String(gradeFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setGradeFilter(v === 'all' ? 'all' : (Number(v) as GradeLevel));
                  setClassFilter('all');
                }}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
              >
                <option value="all">Tất cả 4 Khối</option>
                <option value="6">Khối 6</option>
                <option value="7">Khối 7</option>
                <option value="8">Khối 8</option>
                <option value="9">Khối 9</option>
              </select>

              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
              >
                <option value="all">Tất cả 61 Lớp</option>
                {summary.allClassRows
                  .filter((c) => gradeFilter === 'all' || c.classObj.grade === gradeFilter)
                  .map((c) => (
                    <option key={c.classObj.id} value={c.classObj.id}>
                      Lớp {c.classObj.name} (Ăn: {c.eatingCount} · Chưa XN: {c.unregisteredCount})
                    </option>
                  ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | RegistrationStatus)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="eating">CÓ ĂN ({summary.totalEating})</option>
                <option value="not_eating">KHÔNG ĂN ({summary.totalNotEating})</option>
                <option value="unregistered">CHƯA XÁC NHẬN ({summary.totalUnregistered})</option>
              </select>
            </div>

            {/* Filtered Student List: Mobile Cards (< md) */}
            <div className="md:hidden space-y-2 max-h-[440px] overflow-y-auto pr-0.5 tabular-nums">
              {filteredStudentRows.length === 0 ? (
                <div className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                  Không có học sinh nào phù hợp với điều kiện lọc.
                </div>
              ) : (
                filteredStudentRows.slice(0, 300).map((stu, idx) => {
                  const reg = regMap.get(stu.id);
                  const status: RegistrationStatus = reg ? reg.status : 'unregistered';
                  return (
                    <div
                      key={`mob_stu_${stu.id}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-mono text-slate-500">
                          #{idx + 1} · Lớp {stu.className} · {stu.studentCode}
                        </div>
                        <div className="text-sm font-extrabold text-slate-900 truncate">
                          {stu.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {reg ? `${reg.updatedByName} (${reg.updatedAtIso})` : 'Chưa điểm danh'}
                        </div>
                      </div>
                      {status === 'eating' ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>CÓ ĂN</span>
                        </span>
                      ) : status === 'not_eating' ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-700 shrink-0">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>KHÔNG ĂN</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] font-bold text-amber-800 shrink-0">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>CHƯA XN</span>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Filtered Student List: Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto max-h-[440px] rounded-xl border border-slate-200">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 font-bold text-slate-700">
                  <tr>
                    <th className="p-3 w-12">STT</th>
                    <th className="p-3 w-24">Lớp</th>
                    <th className="p-3">Họ và tên học sinh</th>
                    <th className="p-3 w-24">Mã HS</th>
                    <th className="p-3 w-36">Trạng thái ăn</th>
                    <th className="p-3">Người xác nhận &amp; Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredStudentRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        Không có học sinh nào phù hợp với điều kiện lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredStudentRows.slice(0, 300).map((stu, idx) => {
                      const reg = regMap.get(stu.id);
                      const status: RegistrationStatus = reg ? reg.status : 'unregistered';
                      return (
                        <tr key={stu.id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-3 font-bold text-slate-900">{stu.className}</td>
                          <td className="p-3 font-bold text-slate-900">{stu.fullName}</td>
                          <td className="p-3 font-mono text-slate-600">{stu.studentCode}</td>
                          <td className="p-3">
                            {status === 'eating' ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-bold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>CÓ ĂN</span>
                              </span>
                            ) : status === 'not_eating' ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 border border-rose-200 px-2 py-0.5 font-bold text-rose-700">
                                <XCircle className="w-3.5 h-3.5" />
                                <span>KHÔNG ĂN</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 font-bold text-amber-800">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>CHƯA XÁC NHẬN</span>
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-600">
                            {reg ? `${reg.updatedByName} (${reg.updatedAtIso})` : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Class-level Summary */}
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-700 mb-2">
                Bảng tổng hợp từng lớp ({filteredClassRows.length} lớp)
              </h4>
              {/* Mobile Class Summary Cards (< md) */}
              <div className="md:hidden space-y-2 max-h-80 overflow-y-auto tabular-nums">
                {filteredClassRows.map((row) => (
                  <div
                    key={`mob_cls_${row.classObj.id}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900">
                        Lớp {row.classObj.name}{' '}
                        <span className="font-mono font-normal text-slate-500">({row.totalStudents} HS)</span>
                      </div>
                      <div className="text-[11px] text-slate-600 truncate">{row.classObj.teacherName}</div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold shrink-0">
                      <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-emerald-700">
                        {row.eatingCount} ăn
                      </span>
                      <span className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-rose-700">
                        {row.notEatingCount} nghỉ
                      </span>
                      {row.unregisteredCount > 0 && (
                        <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-800">
                          {row.unregisteredCount} ?
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto max-h-80 rounded-xl border border-slate-200">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 font-bold text-slate-700">
                    <tr>
                      <th className="p-2.5">Lớp</th>
                      <th className="p-2.5">GVCN</th>
                      <th className="p-2.5 text-right">Sĩ số</th>
                      <th className="p-2.5 text-right text-emerald-700">Có ăn</th>
                      <th className="p-2.5 text-right text-rose-700">Không ăn</th>
                      <th className="p-2.5 text-right text-amber-800">Chưa XN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredClassRows.map((row) => (
                      <tr key={row.classObj.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-900">{row.classObj.name}</td>
                        <td className="p-2.5 text-slate-600">{row.classObj.teacherName}</td>
                        <td className="p-2.5 text-right font-mono">{row.totalStudents}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                          {row.eatingCount}
                        </td>
                        <td className="p-2.5 text-right font-mono text-rose-700">
                          {row.notEatingCount}
                        </td>
                        <td className="p-2.5 text-right font-mono text-amber-800">
                          {row.unregisteredCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MONTHLY STATS */}
      {subTab === 'monthly' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Thống kê Suất ăn theo Tháng ({selectedMonth})
              </h3>
              <p className="text-xs text-slate-500">
                Tổng suất ăn cộng dồn trong tháng:{' '}
                <strong className="text-emerald-700 font-mono text-sm">
                  {monthlyStats.totalEatingMonth} suất
                </strong>{' '}
                · Không ăn: <strong className="font-mono">{monthlyStats.totalNotEatingMonth}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-mono font-bold"
              />
            </div>
          </div>

          {/* Mobile Monthly Cards (< md) */}
          <div className="md:hidden space-y-2 tabular-nums">
            {monthlyStats.rows.length === 0 ? (
              <div className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                Chưa có dữ liệu suất ăn nào trong tháng {selectedMonth}.
              </div>
            ) : (
              monthlyStats.rows.map((r) => (
                <button
                  key={`mob_m_${r.date}`}
                  type="button"
                  onClick={() => onDateChange(r.date)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5 hover:bg-slate-100 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-extrabold text-slate-900">
                      {formatVietnameseDate(r.date)}
                    </span>
                    <span className="text-xs font-mono font-extrabold text-emerald-700">
                      Có ăn: {r.eating} · Nghỉ: {r.notEating}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-600">
                    K6: {r.g6} · K7: {r.g7} · K8: {r.g8} · K9: {r.g9}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                  <th className="p-3 text-left font-bold">Ngày phục vụ</th>
                  <th className="p-3 text-right font-bold text-emerald-700">Tổng Có ăn</th>
                  <th className="p-3 text-right font-bold text-rose-700">Không ăn</th>
                  <th className="p-3 text-right font-bold text-amber-800">Chưa XN</th>
                  <th className="p-3 text-right font-bold">Khối 6</th>
                  <th className="p-3 text-right font-bold">Khối 7</th>
                  <th className="p-3 text-right font-bold">Khối 8</th>
                  <th className="p-3 text-right font-bold">Khối 9</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {monthlyStats.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      Chưa có dữ liệu suất ăn nào trong tháng {selectedMonth}.
                    </td>
                  </tr>
                ) : (
                  monthlyStats.rows.map((r) => (
                    <tr
                      key={r.date}
                      onClick={() => onDateChange(r.date)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {formatVietnameseDate(r.date)}
                      </td>
                      <td className="p-3 text-right font-mono font-extrabold text-emerald-700">
                        {r.eating}
                      </td>
                      <td className="p-3 text-right font-mono text-rose-700">{r.notEating}</td>
                      <td className="p-3 text-right font-mono text-amber-800">{r.unregistered}</td>
                      <td className="p-3 text-right font-mono">{r.g6}</td>
                      <td className="p-3 text-right font-mono">{r.g7}</td>
                      <td className="p-3 text-right font-mono">{r.g8}</td>
                      <td className="p-3 text-right font-mono">{r.g9}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CHANGE HISTORY / AUDIT LOGS */}
      {subTab === 'logs' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-extrabold text-slate-900">
            Lịch sử thay đổi dữ liệu – Ngày {formatVietnameseDate(date)}
          </h3>
          {dayLogs.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Chưa có lịch sử thay đổi nào được ghi nhận trong ngày này.
            </p>
          ) : (
            <>
              <div className="md:hidden space-y-2 max-h-[480px] overflow-y-auto">
                {dayLogs.map((l) => (
                  <div
                    key={`mob_log_${l.id}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-slate-900">
                        {l.studentName} <span className="font-normal text-slate-500">({l.className})</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0">{l.timestampIso}</span>
                    </div>
                    <div className="text-slate-700">
                      {l.previousStatus} → <strong>{l.newStatus}</strong> · {l.actorName}
                    </div>
                    {l.reason && <div className="text-[11px] text-slate-500">{l.reason}</div>}
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto max-h-[480px]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                    <tr>
                      <th className="p-3">Thời gian</th>
                      <th className="p-3">Lớp</th>
                      <th className="p-3">Đối tượng / Học sinh</th>
                      <th className="p-3">Thay đổi</th>
                      <th className="p-3">Người thực hiện</th>
                      <th className="p-3">Ghi chú / Lý do</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {dayLogs.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono text-slate-500">{l.timestampIso}</td>
                        <td className="p-3 font-bold">{l.className}</td>
                        <td className="p-3 font-bold text-slate-900">{l.studentName}</td>
                        <td className="p-3">
                          {l.previousStatus} → <strong>{l.newStatus}</strong>
                        </td>
                        <td className="p-3">{l.actorName}</td>
                        <td className="p-3 text-slate-600">{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: A4 PRINT VIEW */}
      {subTab === 'print' && canExportReports && (
        <PrintReportView
          date={date}
          grades={summary.grades}
          allClassRows={summary.allClassRows}
          totalStudents={summary.totalStudents}
          totalEating={summary.totalEating}
          totalNotEating={summary.totalNotEating}
          totalUnregistered={summary.totalUnregistered}
          report={dayReport}
          logs={logs}
          onExportExcel={() => onExportExcel(selectedMonth)}
        />
      )}
    </div>
  );
};
