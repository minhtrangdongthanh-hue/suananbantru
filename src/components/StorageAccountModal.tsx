import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Database,
  Download,
  RefreshCw,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import {
  activeFirebaseConfig,
  ActiveFirebaseConfig,
  saveCustomFirebaseConfig,
} from '../firebase';
import {
  importBackupJsonData,
  syncCurrentDataToCloudDatabase,
} from '../services/mealService';

interface StorageAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  userUid: string;
  userDisplayName: string;
  userRole: string;
  quotaExceeded: boolean;
  counts: {
    classes: number;
    students: number;
    registrations: number;
    reports: number;
    logs: number;
  };
  onSwitchGoogleAccount: () => Promise<void>;
  onExportBackupJson: () => void;
}

export const StorageAccountModal: React.FC<StorageAccountModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  userUid,
  userDisplayName,
  userRole,
  quotaExceeded,
  counts,
  onSwitchGoogleAccount,
  onExportBackupJson,
}) => {
  const [projectId, setProjectId] = useState(activeFirebaseConfig.projectId);
  const [apiKey, setApiKey] = useState(activeFirebaseConfig.apiKey);
  const [authDomain, setAuthDomain] = useState(activeFirebaseConfig.authDomain);
  const [appId, setAppId] = useState(activeFirebaseConfig.appId);
  const [firestoreDatabaseId, setFirestoreDatabaseId] = useState(
    activeFirebaseConfig.firestoreDatabaseId || '(default)'
  );
  const [rawJsonInput, setRawJsonInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleParseConfigJson = (text: string) => {
    setRawJsonInput(text);
    setErrorMsg(null);
    try {
      const cleaned = text
        .replace(/const\s+firebaseConfig\s*=\s*/, '')
        .replace(/;$/, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.projectId) setProjectId(parsed.projectId);
      if (parsed.apiKey) setApiKey(parsed.apiKey);
      if (parsed.authDomain) setAuthDomain(parsed.authDomain);
      if (parsed.appId) setAppId(parsed.appId);
      if (parsed.firestoreDatabaseId) setFirestoreDatabaseId(parsed.firestoreDatabaseId);
      setStatusMsg('Đã nhận diện cấu hình Firebase mới từ chuỗi JSON.');
    } catch {
      // Allow manual typing if not valid JSON yet
    }
  };

  const handleApplyNewFirebaseProject = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!projectId.trim() || !apiKey.trim() || !authDomain.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Project ID, API Key và Auth Domain của tài khoản Firebase mới.');
      return;
    }
    const dbIdClean =
      !firestoreDatabaseId.trim() || firestoreDatabaseId.trim() === '(default)'
        ? undefined
        : firestoreDatabaseId.trim();

    const newConfig: ActiveFirebaseConfig = {
      projectId: projectId.trim(),
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      appId: appId.trim() || '1:000000000000:web:default',
      firestoreDatabaseId: dbIdClean,
      isCustom: true,
    };
    saveCustomFirebaseConfig(newConfig);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const content = await file.text();
      const res = importBackupJsonData(content);
      setStatusMsg(
        `Đã khôi phục thành công: ${res.classesCount} lớp, ${res.studentsCount} học sinh, ${res.registrationsCount} bản ghi đăng ký.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSyncToCloud = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await syncCurrentDataToCloudDatabase();
      setStatusMsg(
        `Đã đẩy thành công ${res.syncedCount} bản ghi lên Cloud Firestore (${activeFirebaseConfig.projectId}).`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể đồng bộ lên Cloud (kiểm tra hạn mức hoặc cấu hình dự án).'
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto no-print">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-extrabold text-slate-900">
              Kiểm tra Tài khoản Đang Lưu & Chuyển Bộ nhớ sang Tài khoản Khác
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
            {errorMsg}
          </div>
        )}

        {/* Section 1: Current Storage & Account Inspection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">1. TÀI KHOẢN GOOGLE ĐANG ĐĂNG NHẬP</span>
              <span className="font-mono text-[11px] text-emerald-700 font-semibold">
                Đang hoạt động
              </span>
            </div>
            <div className="space-y-1 text-slate-600 pt-1">
              <p>
                Email: <strong className="text-slate-900 font-mono">{userEmail}</strong>
              </p>
              <p>
                Họ tên: <strong className="text-slate-900">{userDisplayName}</strong>
              </p>
              <p>
                Vai trò: <strong className="text-slate-900 uppercase">{userRole}</strong>
              </p>
              <p className="truncate">
                Mã UID: <span className="font-mono text-slate-500">{userUid}</span>
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={onSwitchGoogleAccount}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                <span>Đổi sang Tài khoản Google khác</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">2. BỘ NHỚ CLOUD FIRESTORE HIỆN TẠI</span>
              <span
                className={`font-semibold ${
                  quotaExceeded ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {activeFirebaseConfig.isCustom ? 'Dự án tùy chỉnh' : 'Dự án mặc định'}
              </span>
            </div>
            <div className="space-y-1 text-slate-600 pt-1 font-mono text-[11px]">
              <p>
                Project ID:{' '}
                <strong className="text-slate-900">{activeFirebaseConfig.projectId}</strong>
              </p>
              <p className="truncate">
                Database ID:{' '}
                <strong className="text-slate-900">
                  {activeFirebaseConfig.firestoreDatabaseId || '(default)'}
                </strong>
              </p>
              <p className="truncate">
                Auth Domain:{' '}
                <span className="text-slate-700">{activeFirebaseConfig.authDomain}</span>
              </p>
              <p className="font-sans text-xs text-slate-700 pt-1">
                Đang lưu: <strong>{counts.classes}</strong> lớp ·{' '}
                <strong>{counts.students}</strong> HS ·{' '}
                <strong>{counts.registrations}</strong> ĐK ăn ·{' '}
                <strong>{counts.reports}</strong> báo cáo
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Backup & Restore Between Accounts */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-900">
            BƯỚC A: SAO LƯU & CHUYỂN DỮ LIỆU GIỮA CÁC TÀI KHOẢN (KHÔNG MẤT DỮ LIỆU)
          </h3>
          <p className="text-xs text-slate-600">
            Tải file sao lưu toàn bộ dữ liệu hiện tại về máy, sau đó đăng nhập tài khoản mới hoặc kết nối Database mới và nhấn Khôi phục.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onExportBackupJson}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-600" />
              <span>1. Tải file Sao lưu (.JSON) về máy</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Khôi phục dữ liệu từ file (.JSON)</span>
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={handleSyncToCloud}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>
                {syncing ? 'Đang đẩy dữ liệu...' : '3. Đẩy dữ liệu hiện tại lên Cloud Database'}
              </span>
            </button>
          </div>
        </div>

        {/* Section 3: Switch to Another Firebase Project / Account */}
        <form
          onSubmit={handleApplyNewFirebaseProject}
          className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900">
              BƯỚC B: CHUYỂN NƠI LƯU BỘ NHỚ CLOUD SANG DỰ ÁN FIREBASE CỦA TÀI KHOẢN KHÁC
            </h3>
            {activeFirebaseConfig.isCustom && (
              <button
                type="button"
                onClick={() => saveCustomFirebaseConfig(null)}
                className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Khôi phục Database mặc định</span>
              </button>
            )}
          </div>
          <p className="text-xs text-slate-600">
            Nếu bạn tạo một dự án Firebase mới trên tài khoản Google khác (tại{' '}
            <code className="font-mono bg-slate-100 px-1 rounded">console.firebase.google.com</code>
            ), hãy dán JSON cấu hình hoặc nhập thông tin dưới đây để chuyển toàn bộ nơi lưu trữ sang dự án đó:
          </p>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Dán nhanh đối tượng JSON cấu hình Firebase (tùy chọn):
            </label>
            <textarea
              rows={2}
              value={rawJsonInput}
              onChange={(e) => handleParseConfigJson(e.target.value)}
              placeholder='{"projectId": "ten-du-an-moi", "apiKey": "AIza...", "authDomain": "ten-du-an-moi.firebaseapp.com", "appId": "1:..."}'
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Project ID mới *
              </label>
              <input
                type="text"
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Firestore Database ID (Mặc định: <code className="font-mono">(default)</code>)
              </label>
              <input
                type="text"
                value={firestoreDatabaseId}
                onChange={(e) => setFirestoreDatabaseId(e.target.value)}
                placeholder="(default)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Web API Key *
              </label>
              <input
                type="text"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Auth Domain *
              </label>
              <input
                type="text"
                required
                value={authDomain}
                onChange={(e) => setAuthDomain(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              Lưu & Chuyển sang Bộ nhớ Mới
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
