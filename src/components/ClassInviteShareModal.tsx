import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Link2,
  Lock,
  QrCode,
  RefreshCw,
  Share2,
  Unlock,
  X,
} from 'lucide-react';
import { ClassInvite, copyTextSafe, getPublicAppOrigin, getRoleLabel, SchoolClass, UserRole } from '../types';

export interface RoleInviteTarget {
  role: 'accountant' | 'medical';
  title: string;
  subtitle: string;
}

interface ClassInviteShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolClass: SchoolClass | null;
  roleTarget?: RoleInviteTarget | null;
  invite: ClassInvite | null;
  onCreateOrRotate?: (cls: SchoolClass, existing?: ClassInvite | null) => Promise<ClassInvite>;
  onCreateOrRotateRole?: (
    role: 'accountant' | 'medical',
    existing?: ClassInvite | null
  ) => Promise<ClassInvite>;
  onToggleActive?: (invite: ClassInvite, active: boolean) => Promise<void>;
}

export function buildClassInviteUrl(code: string): string {
  const origin = getPublicAppOrigin();
  if (!origin) return `?invite=${encodeURIComponent(code)}`;
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}

export const ClassInviteShareModal: React.FC<ClassInviteShareModalProps> = ({
  isOpen,
  onClose,
  schoolClass,
  roleTarget = null,
  invite,
  onCreateOrRotate,
  onCreateOrRotateRole,
  onToggleActive,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<'code' | 'link' | 'message' | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const shareUrl = invite ? buildClassInviteUrl(invite.code) : '';

  useEffect(() => {
    if (!isOpen || !invite) {
      setQrDataUrl((prev) => (prev ? '' : prev));
      return;
    }
    let active = true;
    QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [isOpen, invite, shareUrl]);

  if (!isOpen || (!schoolClass && !roleTarget)) return null;

  const isRoleMode = !schoolClass && Boolean(roleTarget);
  const effectiveRole: UserRole = roleTarget ? roleTarget.role : 'teacher';
  const targetTitle = schoolClass
    ? `Lớp ${schoolClass.name} (Khối ${schoolClass.grade})`
    : roleTarget?.title || getRoleLabel(effectiveRole);
  const targetSubtitle = schoolClass
    ? `GVCN phụ trách: ${schoolClass.teacherName}`
    : roleTarget?.subtitle || 'Quyền xem và thao tác theo phân quyền nhóm';
  const shortTarget = schoolClass
    ? `Lớp ${schoolClass.name}`
    : roleTarget?.title || getRoleLabel(effectiveRole);

  const copyText = async (text: string, key: 'code' | 'link' | 'message') => {
    const ok = await copyTextSafe(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } else {
      setErrorMsg('Trình duyệt chưa cấp quyền sao chép tự động, vui lòng chạm giữ vào ô văn bản để sao chép.');
    }
  };

  const handleNativeShare = async () => {
    if (!invite) return;
    const message = schoolClass
      ? `Mời Thầy/Cô GVCN ${shortTarget} vào điểm danh suất ăn bán trú Trường THCS Đông Thạnh (không cần đăng nhập Google).\nMã lớp: ${invite.code}\nMở link trực tiếp: ${shareUrl}`
      : `Mời ${shortTarget} truy cập Hệ thống Quản lý Suất ăn Bán trú Trường THCS Đông Thạnh theo đúng quyền được cấp (không cần đăng nhập Google).\nMã truy cập: ${invite.code}\nMở link trực tiếp: ${shareUrl}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Liên kết truy cập ${shortTarget} – THCS Đông Thạnh`,
          text: message,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to copying message if user cancels or native share is unavailable
      }
    }
    await copyText(message, 'message');
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl || !invite) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    const safeName = schoolClass
      ? `GVCN_Lop_${schoolClass.name.replace('/', '_')}`
      : effectiveRole === 'accountant'
      ? 'Ke_Toan'
      : 'Nhan_Vien_Y_Te';
    a.download = `LinkTruyCap_${safeName}_${invite.code}.png`;
    a.click();
  };

  const handleCreateOrRotate = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      if (isRoleMode && roleTarget && onCreateOrRotateRole) {
        await onCreateOrRotateRole(roleTarget.role, invite);
      } else if (schoolClass && onCreateOrRotate) {
        await onCreateOrRotate(schoolClass, invite);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    if (!onToggleActive || !invite) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await onToggleActive(invite, !invite.active);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="text-[11px] font-bold text-sky-700">
              {isRoleMode
                ? 'CHIA SẺ LINK TRUY CẬP BỘ PHẬN (KHÔNG CẦN ĐĂNG NHẬP)'
                : 'CHIA SẺ LINK ĐIỂM DANH LỚP (KHÔNG CẦN ĐĂNG NHẬP)'}
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">
              {isRoleMode ? targetTitle : `Link & Mã vào ${targetTitle}`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{targetSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800">
            {errorMsg}
          </div>
        )}

        {!invite ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center space-y-3">
            <KeyRound className="w-10 h-10 text-sky-600 mx-auto" />
            <div className="space-y-1">
              <h4 className="text-sm font-extrabold text-slate-900">
                {shortTarget} chưa có link / mã chia sẻ
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tạo liên kết và mã QR để gửi cho <strong>{shortTarget}</strong> bấm vào xem và thao tác đúng theo quyền đã cấp mà không cần đăng nhập Google.
              </p>
            </div>
            {(onCreateOrRotate || onCreateOrRotateRole) && (
              <button
                type="button"
                disabled={busy}
                onClick={handleCreateOrRotate}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4 text-sky-400" />
                <span>{busy ? 'Đang tạo link...' : `Tạo link vào ${shortTarget}`}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Code & Status Card */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 block">
                  MÃ TRUY CẬP · {shortTarget.toUpperCase()}
                </span>
                <div className="text-2xl font-extrabold font-mono tracking-wider text-slate-900 tabular-nums mt-0.5">
                  {invite.code}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 font-bold ${
                      invite.active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}
                  >
                    {invite.active ? 'Đang mở truy cập' : 'Đang tạm khóa'}
                  </span>
                  <span className="text-slate-500 font-mono tabular-nums">
                    Lượt mở: {invite.usageCount}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyText(invite.code, 'code')}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  {copiedKey === 'code' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Đã sao chép</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-sky-400" />
                      <span>Copy Mã</span>
                    </>
                  )}
                </button>

                {onToggleActive && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleToggle}
                    className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold cursor-pointer whitespace-nowrap ${
                      invite.active
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    {invite.active ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Tạm khóa</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Mở lại</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Share URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Đường dẫn (Link) mở thẳng giao diện {shortTarget}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => copyText(shareUrl, 'link')}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'link' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Đã copy link</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5 text-sky-600" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Đường dẫn dùng tên miền công khai cho điện thoại giáo viên / thành viên — mở trực tiếp không cần đăng nhập Google.
              </p>
            </div>

            {/* Scannable QR Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-40 h-40 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center shrink-0">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`Mã QR vào ${shortTarget}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <QrCode className="w-12 h-12 text-slate-300" />
                )}
              </div>

              <div className="flex-1 space-y-2 text-xs text-slate-600">
                <p className="font-bold text-slate-900">
                  Hướng dẫn truy cập nhanh cho thành viên:
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Bấm trực tiếp vào link hoặc quét mã QR bên cạnh bằng điện thoại / Zalo.
                  </li>
                  <li>
                    Hệ thống mở thẳng khu vực của <strong>{shortTarget}</strong> theo đúng quyền Quản trị đã cấp (không cần đăng nhập Google).
                  </li>
                </ol>

                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer whitespace-nowrap"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{copiedKey === 'message' ? 'Đã copy tin nhắn mời' : 'Gửi link qua Zalo/SMS'}</span>
                  </button>

                  {qrDataUrl && (
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải ảnh QR</span>
                    </button>
                  )}

                  {(onCreateOrRotate || onCreateOrRotateRole) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleCreateOrRotate}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Đổi link mới (hủy link cũ)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
