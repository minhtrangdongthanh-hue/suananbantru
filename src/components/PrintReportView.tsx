import React, { useState } from 'react';
import { FileSpreadsheet, Printer, CheckCircle2, Filter } from 'lucide-react';
import {
  ClassSummaryRow,
  DailyReport,
  formatVietnameseDate,
  GradeLevel,
  GradeSummary,
  RegistrationLog,
} from '../types';

interface PrintReportViewProps {
  date: string;
  grades: GradeSummary[];
  allClassRows: ClassSummaryRow[];
  totalStudents: number;
  totalEating: number;
  totalNotEating: number;
  totalUnregistered: number;
  report: DailyReport | null;
  logs: RegistrationLog[];
  onExportExcel: () => void;
}

export const PrintReportView: React.FC<PrintReportViewProps> = ({
  date,
  grades,
  allClassRows,
  totalStudents,
  totalEating,
  totalNotEating,
  totalUnregistered,
  report,
  logs,
  onExportExcel,
}) => {
  const [printMode, setPrintMode] = useState<'school_summary' | 'class_students'>('school_summary');
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<'all' | GradeLevel>('all');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('all');
  const [hideZeroMealClasses, setHideZeroMealClasses] = useState<boolean>(false);

  const postLockLogs = logs.filter((l) => l.date === date && l.isAfterCutoff);

  const filteredClassRows = allClassRows.filter((row) => {
    if (selectedGradeFilter !== 'all' && row.classObj.grade !== selectedGradeFilter) return false;
    if (selectedClassFilter !== 'all' && row.classObj.id !== selectedClassFilter) return false;
    if (hideZeroMealClasses && row.eatingCount === 0) return false;
    return true;
  });

  const handlePrintA4 = () => {
    window.print();
  };

  return (
    <div className="space-y-5">
      {/* Control Toolbar (Hidden when printing) */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setPrintMode('school_summary')}
              className={`min-h-[38px] px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                printMode === 'school_summary'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mẫu 1: Tổng hợp chia suất (A4)
            </button>
            <button
              type="button"
              onClick={() => setPrintMode('class_students')}
              className={`min-h-[38px] px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                printMode === 'class_students'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mẫu 2: Danh sách HS ăn theo lớp
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedGradeFilter}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedGradeFilter(v === 'all' ? 'all' : (Number(v) as GradeLevel));
                setSelectedClassFilter('all');
              }}
              className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              <option value="all">Tất cả 4 khối (61 lớp)</option>
              <option value="6">Khối 6 (14 lớp)</option>
              <option value="7">Khối 7 (13 lớp)</option>
              <option value="8">Khối 8 (15 lớp)</option>
              <option value="9">Khối 9 (19 lớp)</option>
            </select>

            <select
              value={selectedClassFilter}
              onChange={(e) => setSelectedClassFilter(e.target.value)}
              className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              <option value="all">Tất cả lớp</option>
              {allClassRows
                .filter((c) => selectedGradeFilter === 'all' || c.classObj.grade === selectedGradeFilter)
                .map((c) => (
                  <option key={c.classObj.id} value={c.classObj.id}>
                    Lớp {c.classObj.name} ({c.eatingCount} suất)
                  </option>
                ))}
            </select>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideZeroMealClasses}
                onChange={(e) => setHideZeroMealClasses(e.target.checked)}
                className="rounded border-slate-300 text-slate-900"
              />
              <span>Ẩn lớp 0 suất</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExportExcel}
            className="min-h-[42px] flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>XUẤT EXCEL (.XLSX)</span>
          </button>
          <button
            type="button"
            onClick={handlePrintA4}
            className="min-h-[42px] flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>IN BÁO CÁO A4</span>
          </button>
        </div>
      </div>

      {/* Printable A4 Sheet Container */}
      <div className="print-container mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs text-slate-900">
        {/* National / School Header */}
        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-300 text-xs">
          <div>
            <p className="font-semibold text-slate-700">UBND HUYỆN HÓC MÔN</p>
            <p className="font-bold text-slate-900 text-sm">TRƯỜNG THCS ĐÔNG THẠNH</p>
            <p className="text-slate-500 mt-0.5">Bộ phận Quản lý Bán trú · Kế toán · Y tế</p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-slate-700">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
            <p className="font-bold text-slate-900">Độc lập - Tự do - Hạnh phúc</p>
            <p className="text-slate-500 mt-0.5">
              {report?.isLocked
                ? `Đã chốt chính thức lúc: ${report.lockedAtIso}`
                : 'Bản tổng hợp trước giờ khóa sổ 08:00'}
            </p>
          </div>
        </div>

        {/* Report Main Title */}
        <div className="text-center my-6">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {printMode === 'school_summary'
              ? 'BẢNG TỔNG HỢP SUẤT ĂN BÁN TRÚ'
              : 'DANH SÁCH HỌC SINH ĐĂNG KÝ ĂN BÁN TRÚ THEO LỚP'}
          </h1>
          <p className="text-sm font-medium text-slate-700 mt-1">
            Ngày phục vụ: <span className="font-bold tabular-nums">{formatVietnameseDate(date)}</span>
          </p>
        </div>

        {/* Reconciliation Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs">
          <div>
            <span className="text-slate-500 block">Chốt ban đầu (08:00)</span>
            <span className="font-mono font-bold text-base text-slate-900 tabular-nums">
              {report?.isLocked ? report.initialTotalEating : totalEating} suất
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Điều chỉnh sau 08:00</span>
            <span className="font-mono font-bold text-base text-slate-900 tabular-nums">
              {report?.isLocked
                ? `${totalEating - report.initialTotalEating >= 0 ? '+' : ''}${
                    totalEating - report.initialTotalEating
                  } suất (${report.adjustmentCount} lần)`
                : '0 suất'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Tổng suất ăn chính thức</span>
            <span className="font-mono font-bold text-base text-emerald-700 tabular-nums">
              {totalEating} suất
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Không ăn / Chưa XN</span>
            <span className="font-mono font-semibold text-sm text-slate-700 tabular-nums">
              {totalNotEating} không ăn · {totalUnregistered} chưa XN
            </span>
          </div>
        </div>

        {/* Grade Breakdown Summary Table */}
        <div className="mb-6">
          <h2 className="text-xs font-bold text-slate-700 mb-2">I. TỔNG HỢP THEO KHỐI (TOÀN TRƯỜNG)</h2>
          <table className="w-full border-collapse border border-slate-300 text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-800">
                <th className="border border-slate-300 px-3 py-2 text-left font-bold">Khối lớp</th>
                <th className="border border-slate-300 px-3 py-2 text-right font-bold">Số lớp</th>
                <th className="border border-slate-300 px-3 py-2 text-right font-bold">Sĩ số</th>
                <th className="border border-slate-300 px-3 py-2 text-right font-bold">Có ăn</th>
                <th className="border border-slate-300 px-3 py-2 text-right font-bold">Không ăn</th>
                <th className="border border-slate-300 px-3 py-2 text-right font-bold">Chưa xác nhận</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {grades.map((g) => (
                <tr key={g.grade}>
                  <td className="border border-slate-300 px-3 py-1.5 font-semibold">Khối {g.grade}</td>
                  <td className="border border-slate-300 px-3 py-1.5 text-right font-mono">{g.classCount}</td>
                  <td className="border border-slate-300 px-3 py-1.5 text-right font-mono">{g.totalStudents}</td>
                  <td className="border border-slate-300 px-3 py-1.5 text-right font-mono font-bold text-slate-900">
                    {g.eatingCount}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 text-right font-mono">{g.notEatingCount}</td>
                  <td className="border border-slate-300 px-3 py-1.5 text-right font-mono">{g.unregisteredCount}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-bold">
                <td className="border border-slate-300 px-3 py-2">Tổng cộng toàn trường</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-mono">{allClassRows.length}</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-mono">{totalStudents}</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-mono text-sm text-emerald-800">
                  {totalEating}
                </td>
                <td className="border border-slate-300 px-3 py-2 text-right font-mono">{totalNotEating}</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-mono">{totalUnregistered}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mode 1: Standard A4 Class Meal Distribution Table */}
        {printMode === 'school_summary' && (
          <div className="mb-6">
            <h2 className="text-xs font-bold text-slate-700 mb-2">
              II. BẢNG CHIA SUẤT ĂN CHI TIẾT TỪNG LỚP
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800">
                  <th className="border border-slate-300 px-2.5 py-2 text-center font-bold w-12">STT</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-center font-bold w-14">Khối</th>
                  <th className="border border-slate-300 px-3 py-2 text-left font-bold">Lớp</th>
                  <th className="border border-slate-300 px-3 py-2 text-left font-bold">GVCN</th>
                  <th className="border border-slate-300 px-3 py-2 text-right font-bold w-24">Có ăn</th>
                  <th className="border border-slate-300 px-3 py-2 text-right font-bold w-24">Không ăn</th>
                  <th className="border border-slate-300 px-3 py-2 text-left font-bold w-32">Ký nhận</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {filteredClassRows.map((row, index) => (
                  <tr key={row.classObj.id} className="print-break-inside-avoid">
                    <td className="border border-slate-300 px-2.5 py-1.5 text-center font-mono">
                      {index + 1}
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-center font-mono">
                      {row.classObj.grade}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 font-semibold text-slate-900">
                      {row.classObj.name}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-slate-600">
                      {row.classObj.teacherName}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-right font-mono font-bold text-slate-900">
                      {row.eatingCount}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-right font-mono text-slate-600">
                      {row.notEatingCount}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5"></td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={4} className="border border-slate-300 px-3 py-2 text-right">
                    Tổng cộng ({filteredClassRows.length} lớp hiển thị)
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono text-sm text-emerald-800">
                    {filteredClassRows.reduce((acc, r) => acc + r.eatingCount, 0)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono text-sm text-rose-700">
                    {filteredClassRows.reduce((acc, r) => acc + r.notEatingCount, 0)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Mode 2: Student List by Class */}
        {printMode === 'class_students' && (
          <div className="space-y-6 mb-6">
            <h2 className="text-xs font-bold text-slate-700">
              II. DANH SÁCH HỌC SINH ĐĂNG KÝ ĂN THEO TỪNG LỚP (ĐỐI CHIẾU PHÁT CƠM)
            </h2>
            {filteredClassRows.filter((r) => r.eatingStudents.length > 0).length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center border border-slate-200 rounded-lg">
                Không có học sinh đăng ký ăn trong bộ lọc hiện tại.
              </p>
            ) : (
              filteredClassRows
                .filter((r) => r.eatingStudents.length > 0)
                .map((row) => (
                  <div key={row.classObj.id} className="print-break-inside-avoid border border-slate-300 rounded-lg p-3">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 text-xs">
                      <div>
                        <span className="font-bold text-sm text-slate-900">Lớp {row.classObj.name}</span>
                        <span className="text-slate-500 ml-2">· GVCN: {row.classObj.teacherName}</span>
                      </div>
                      <span className="font-mono font-bold text-slate-900">
                        Tổng lớp {row.classObj.name}: {row.eatingCount} suất ăn
                      </span>
                    </div>
                    <table className="w-full border-collapse border border-slate-300 text-xs">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="border border-slate-300 px-2 py-1 text-center w-12">STT</th>
                          <th className="border border-slate-300 px-2.5 py-1 text-left w-28">Mã HS</th>
                          <th className="border border-slate-300 px-2.5 py-1 text-left">Họ và tên học sinh</th>
                          <th className="border border-slate-300 px-2.5 py-1 text-left">Người xác nhận</th>
                          <th className="border border-slate-300 px-2.5 py-1 text-center w-24">Đánh dấu</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {row.eatingStudents.map((item, idx) => (
                          <tr key={item.student.id}>
                            <td className="border border-slate-300 px-2 py-1 text-center font-mono">
                              {idx + 1}
                            </td>
                            <td className="border border-slate-300 px-2.5 py-1 font-mono">
                              {item.student.studentCode}
                            </td>
                            <td className="border border-slate-300 px-2.5 py-1 font-medium">
                              {item.student.fullName}
                            </td>
                            <td className="border border-slate-300 px-2.5 py-1 text-slate-600">
                              {item.registration.updatedByName} (
                              {item.registration.updatedByRole === 'teacher' ? 'GVCN' : 'Admin'})
                            </td>
                            <td className="border border-slate-300 px-2.5 py-1 text-center">☐</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
            )}
          </div>
        )}

        {/* Post-Lock Adjustments Audit Section */}
        {postLockLogs.length > 0 && (
          <div className="mb-6 print-break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-700 mb-2">
              III. CHI TIẾT ĐIỀU CHỈNH NGOẠI LỆ SAU KHI KHÓA SỔ 08:00 ({postLockLogs.length} LẦN)
            </h2>
            <table className="w-full border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Thời gian</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Học sinh / Lớp</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Thay đổi</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Người thực hiện</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-left">Lý do điều chỉnh</th>
                </tr>
              </thead>
              <tbody>
                {postLockLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{log.timestampIso}</td>
                    <td className="border border-slate-300 px-2 py-1 font-medium">
                      {log.studentName} ({log.className})
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      {log.previousStatus} → <strong>{log.newStatus}</strong>
                    </td>
                    <td className="border border-slate-300 px-2 py-1">{log.actorName}</td>
                    <td className="border border-slate-300 px-2 py-1">{log.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report?.isLocked && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Trạng thái khóa sổ:</strong> Đã chốt chính thức {totalEating} suất ăn lúc {report.lockedAtIso}.
            </span>
          </div>
        )}

        {/* 3 Required Signatures */}
        <div className="grid grid-cols-3 gap-6 mt-10 pt-4 text-center text-xs print-break-inside-avoid">
          <div>
            <p className="font-bold text-slate-900">KẾ TOÁN / NGƯỜI LẬP BẢNG</p>
            <p className="text-slate-500 text-[11px] mt-0.5">(Ký, ghi rõ họ tên)</p>
            <div className="h-24"></div>
            <p className="font-semibold text-slate-800">{report?.lockedByName || '...........................'}</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">NHÂN VIÊN Y TẾ</p>
            <p className="text-slate-500 text-[11px] mt-0.5">(Ký, ghi rõ họ tên)</p>
            <div className="h-24"></div>
            <p className="font-semibold text-slate-800">...........................</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">BAN GIÁM HIỆU DUYỆT</p>
            <p className="text-slate-500 text-[11px] mt-0.5">(Ký, ghi rõ họ tên)</p>
            <div className="h-24"></div>
            <p className="font-semibold text-slate-800">...........................</p>
          </div>
        </div>
      </div>
    </div>
  );
};
