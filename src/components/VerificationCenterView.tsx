import React, { useState } from 'react';
import { CheckCircle2, Play, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { clearSandboxData } from '../services/mealService';
import { runFull12ScenarioVerification } from '../services/verificationSuite';
import { TestScenarioResult } from '../types';

export const VerificationCenterView: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [results, setResults] = useState<TestScenarioResult[]>([]);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [allPassed, setAllPassed] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRunTests = async () => {
    setRunning(true);
    setErrorMsg(null);
    setSummaryText(null);
    setResults([]);
    try {
      const outcome = await runFull12ScenarioVerification((progress) => {
        setResults(progress);
      });
      setResults(outcome.results);
      setAllPassed(outcome.allPassed);
      setSummaryText(outcome.summaryText);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleCleanSandbox = async () => {
    setCleaning(true);
    setErrorMsg(null);
    try {
      await clearSandboxData();
      setResults([]);
      setSummaryText(
        'Đã xóa toàn bộ dữ liệu kiểm thử (sandbox) thành công. Dữ liệu thật được giữ nguyên 100%.'
      );
      setAllPassed(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>MÔI TRƯỜNG KIỂM THỬ ĐỘC LẬP (SANDBOX ISOLATION)</span>
            </div>
            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              Nghiệm thu Tự động 16 Kịch bản Thực tế
            </h2>
            <p className="mt-1 text-xs text-slate-600 max-w-3xl">
              Toàn bộ 16 bài kiểm tra dưới đây thực thi trên phân vùng{' '}
              <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">env = "sandbox"</code>, tuyệt đối không trộn lẫn vào dữ liệu chính thức của trường (<code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">env = "production"</code>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={running || cleaning}
              onClick={handleRunTests}
              className="min-h-[44px] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4 text-sky-400" />
              <span>{running ? 'Đang chạy 16 kịch bản...' : 'CHẠY KIỂM THỬ 16 KỊCH BẢN'}</span>
            </button>

            <button
              type="button"
              disabled={running || cleaning}
              onClick={handleCleanSandbox}
              className="min-h-[44px] flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>{cleaning ? 'Đang dọn...' : 'Xóa dữ liệu kiểm thử'}</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800">
            {errorMsg}
          </div>
        )}

        {summaryText && (
          <div
            className={`mt-4 rounded-xl border p-4 text-xs font-bold flex items-center gap-2.5 ${
              allPassed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                : 'border-amber-200 bg-amber-50 text-amber-950'
            }`}
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{summaryText}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {(results.length > 0
            ? results
            : [
                { id: 1, title: '1. Đăng nhập hệ thống & Xác thực tài khoản', description: 'Xác thực Google Auth và khởi tạo phiên làm việc hợp lệ.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 2, title: '2. Phân quyền 4 nhóm (GVCN · Kế toán · Y tế · Admin) & Mã lớp', description: 'Ma trận 4 nhóm × 6 chức năng, khóa Admin và mã chia sẻ lớp có chống hồi sinh.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 3, title: '3. Chặn truy cập trái lớp & sai vai trò', description: 'GVCN không được điểm danh lớp khác; Kế toán & Y tế chỉ được xem.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 4, title: '4. Tạo mã QR chuẩn & Kiểm tra dữ liệu Excel', description: 'Định dạng mã QR duy nhất cho Lớp và Học sinh.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 5, title: '5. Cập nhật trạng thái học sinh bán trú', description: 'Ngừng và kích hoạt lại học sinh an toàn.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 6, title: '6. GVCN xác nhận & Chống trùng khi quét QR nhiều lần', description: 'Quét lặp cùng trạng thái không tạo bản ghi thừa.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 7, title: '7. Xác nhận hàng loạt lớp 6/1', description: 'GVCN xác nhận CÓ ĂN cho cả lớp cùng lúc.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 8, title: '8. Ràng buộc duy nhất Học sinh + Ngày', description: 'Mỗi học sinh tối đa 1 bản ghi mỗi ngày.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 9, title: '9. Kiểm tra khóa sổ tự động 08:00 (GMT+7)', description: 'Chốt số lượng ban đầu đúng 08:00.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 10, title: '10. Chặn GVCN sau khóa sổ & Admin điều chỉnh ngoại lệ', description: 'Admin điều chỉnh bắt buộc lý do, giữ số ban đầu.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 11, title: '11. Đối soát toàn trường & Học sinh chưa xác nhận', description: 'Khớp 100% Tổng == 4 khối == 61 lớp == Báo cáo.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 12, title: '12. Xuất Excel 5 sheets & In A4 chuẩn Kế toán/Y tế', description: 'Đầy đủ sheet tổng hợp, lớp, chi tiết, tháng, lịch sử.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 13, title: '13. Bảo vệ Admin gốc & chống khóa Admin cuối cùng', description: 'Không cho phép khóa hoặc hạ quyền Admin cuối cùng.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 14, title: '14. Hoạt động ngoại tuyến (Hybrid Store)', description: 'Lưu trữ bộ nhớ thiết bị & hàng đợi đồng bộ khi mất mạng.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 15, title: '15. Kiểm tra đồng bộ dữ liệu sau khi đăng nhập lại', description: 'Đọc mới từ localStorage xác nhận bản ghi khớp 100%.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
                { id: 16, title: '16. Xóa toàn bộ HS đầu năm mới & Chống tự khôi phục cache', description: 'Lưu trữ năm cũ, xóa sạch danh sách HS về 0.', passed: false, details: 'Chưa chạy kiểm thử', durationMs: 0 },
              ]
          ).map((item) => {
            const hasRun = results.length > 0;
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 text-xs ${
                  !hasRun
                    ? 'border-slate-200 bg-slate-50/50'
                    : item.passed
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-rose-200 bg-rose-50/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {hasRun ? (
                      item.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-slate-300 inline-block shrink-0" />
                    )}
                    <h4 className="font-bold text-slate-900">{item.title}</h4>
                  </div>
                  {hasRun && (
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">
                      {item.durationMs} ms
                    </span>
                  )}
                </div>
                <p className="mt-1 text-slate-600">{item.description}</p>
                {hasRun && (
                  <p className="mt-2 pt-2 border-t border-slate-200/70 font-mono text-[11px] text-slate-800">
                    {item.details}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
