import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  return (
    <>
      {isInstallable ? (
        <button
          type="button"
          onClick={install}
          className="min-h-[32px] flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Cài App</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          className="min-h-[32px] flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-slate-500" />
          <span>{isIOS ? 'Cài iPhone' : 'Cài App'}</span>
        </button>
      )}

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 no-print">
          <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Cài đặt Ứng dụng Bán Trú THCS Đông Thạnh
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4 text-sm text-slate-600">
              <div>
                <p className="font-semibold text-slate-900">1. Trên iPhone / iPad (Safari):</p>
                <p className="mt-1">
                  Nhấn nút <strong>Chia sẻ (Share)</strong> ở thanh công cụ dưới cùng, sau đó chọn{' '}
                  <strong>Thêm vào Màn hình chính (Add to Home Screen)</strong>.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">2. Trên Android (Chrome):</p>
                <p className="mt-1">
                  Nhấn biểu tượng <strong>Menu (3 chấm)</strong> ở góc phải trên cùng, sau đó chọn{' '}
                  <strong>Cài đặt ứng dụng (Install App)</strong> hoặc{' '}
                  <strong>Thêm vào màn hình chính</strong>.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">3. Trên Máy tính (Chrome / Edge):</p>
                <p className="mt-1">
                  Nhấn biểu tượng <strong>Cài đặt</strong> trên thanh địa chỉ trình duyệt để mở như phần mềm độc lập.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-6 w-full rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 left-3 right-3 md:right-auto md:max-w-md z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg no-print">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Đang ngoại tuyến — Dữ liệu bộ nhớ đệm vẫn hoạt động và sẽ tự đồng bộ khi có mạng.</span>
    </div>
  );
};
