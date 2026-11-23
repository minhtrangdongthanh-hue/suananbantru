import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ImagePlus,
  Lock,
  Search,
  Settings,
  X,
} from 'lucide-react';
import {
  buildClassQrCode,
  buildStudentQrCode,
  formatVietnameseDate,
  MealRegistration,
  RegistrationStatus,
  SchoolClass,
  Student,
  UserRole,
} from '../types';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  isLocked: boolean;
  currentUserRole: UserRole;
  assignedClassId?: string;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  onSelectClass: (classId: string) => void;
  onConfirmStudentMeal: (
    student: Student,
    status: 'eating' | 'not_eating'
  ) => Promise<{ syncedToCloud?: boolean; pendingReason?: string } | void>;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  date,
  isLocked,
  currentUserRole,
  assignedClassId,
  classes,
  students,
  registrations,
  onSelectClass,
  onConfirmStudentMeal,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'denied' | 'unavailable'>('starting');
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string>('');
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
  } | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const resolveQrValue = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    setStatusFeedback(null);

    // 1. Check if QR matches a Student (qrCode, studentCode, or id)
    const matchedStudent = students.find(
      (s) =>
        s.env === 'production' &&
        s.active &&
        (s.qrCode?.toLowerCase() === code.toLowerCase() ||
          buildStudentQrCode(s.studentCode).toLowerCase() === code.toLowerCase() ||
          s.studentCode.toLowerCase() === code.toLowerCase() ||
          s.id.toLowerCase() === code.toLowerCase())
    );

    if (matchedStudent) {
      if (
        currentUserRole === 'teacher' &&
        assignedClassId &&
        matchedStudent.classId !== assignedClassId
      ) {
        setStatusFeedback({
          type: 'error',
          message: `Học sinh ${matchedStudent.fullName} thuộc Lớp ${matchedStudent.className}. Bạn chỉ được quét học sinh trong lớp mình phụ trách.`,
        });
        return;
      }
      onSelectClass(matchedStudent.classId);
      setScannedStudent(matchedStudent);
      return;
    }

    // 2. Check if QR matches a Class (DT_CLASS_..., classId, or className like "6/1")
    const matchedClass = classes.find(
      (c) =>
        c.env === 'production' &&
        c.active &&
        (buildClassQrCode(c.id).toLowerCase() === code.toLowerCase() ||
          c.id.toLowerCase() === code.toLowerCase() ||
          c.name.toLowerCase() === code.toLowerCase() ||
          `class:${c.name}`.toLowerCase() === code.toLowerCase())
    );

    if (matchedClass) {
      if (
        currentUserRole === 'teacher' &&
        assignedClassId &&
        matchedClass.id !== assignedClassId
      ) {
        setStatusFeedback({
          type: 'error',
          message: `Mã QR của Lớp ${matchedClass.name}. Bạn không có quyền mở danh sách lớp khác.`,
        });
        return;
      }
      onSelectClass(matchedClass.id);
      setScannedStudent(null);
      setStatusFeedback({
        type: 'success',
        message: `Đã nhận diện mã QR Lớp ${matchedClass.name}. Đang mở danh sách lớp...`,
      });
      setTimeout(() => {
        onClose();
      }, 900);
      return;
    }

    setStatusFeedback({
      type: 'error',
      message: `Không tìm thấy lớp hoặc học sinh khớp với mã QR "${code}".`,
    });
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      lastScannedRef.current = { code: '', at: 0 };
      setScannedStudent(null);
      setStatusFeedback(null);
      return;
    }

    let cancelled = false;

    const startCamera = async () => {
      setCameraState('starting');
      setCameraErrorDetail('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('unavailable');
        setCameraErrorDetail('Trình duyệt không hỗ trợ truy cập camera trực tiếp.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('active');

        const scanLoop = () => {
          if (cancelled || !videoRef.current || !canvasRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (qr && qr.data) {
                const now = Date.now();
                const normalized = qr.data.trim().toLowerCase();
                if (
                  lastScannedRef.current.code !== normalized ||
                  now - lastScannedRef.current.at >= 1500
                ) {
                  lastScannedRef.current = { code: normalized, at: now };
                  resolveQrValue(qr.data);
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanLoop);
        };
        rafRef.current = requestAnimationFrame(scanLoop);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.toLowerCase().includes('permission')) {
          setCameraState('denied');
          setCameraErrorDetail('Quyền truy cập Camera đã bị từ chối.');
        } else {
          setCameraState('unavailable');
          setCameraErrorDetail(msg || 'Không tìm thấy camera trên thiết bị.');
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen]);

  const handleUploadQrImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr && qr.data) {
          resolveQrValue(qr.data);
        } else {
          setStatusFeedback({
            type: 'error',
            message: 'Không đọc được mã QR từ ảnh vừa chọn. Vui lòng chọn ảnh rõ nét hơn.',
          });
        }
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  };

  if (!isOpen) return null;

  const currentReg = scannedStudent
    ? registrations.find(
        (r) => r.env === 'production' && r.date === date && r.studentId === scannedStudent.id
      )
    : undefined;
  const currentStatus: RegistrationStatus = currentReg ? currentReg.status : 'unregistered';
  const canModify = !isLocked || currentUserRole === 'admin';

  const handleConfirm = async (newStatus: 'eating' | 'not_eating') => {
    if (!scannedStudent) return;
    setSaving(true);
    setStatusFeedback(null);
    try {
      const res = await onConfirmStudentMeal(scannedStudent, newStatus);
      const statusLabel = newStatus === 'eating' ? 'CÓ ĂN' : 'KHÔNG ĂN';
      if (res && res.syncedToCloud === false) {
        setStatusFeedback({
          type: 'warning',
          message: `Đã lưu tạm trên máy: ${scannedStudent.fullName} — ${statusLabel}, nhưng CHƯA gửi lên Cloud (${
            res.pendingReason || 'mạng yếu'
          }). Vui lòng kiểm tra mạng và bấm "Đồng bộ lên Cloud ngay".`,
        });
      } else {
        setStatusFeedback({
          type: 'success',
          message: `Đã lưu lên máy chủ: ${scannedStudent.fullName} — ${statusLabel} (${formatVietnameseDate(
            date
          )}).`,
        });
      }
    } catch (err) {
      setStatusFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <Camera className="w-5 h-5 text-sky-400" />
            <div>
              <h3 className="text-base font-bold">Quét mã QR Điểm danh Suất ăn</h3>
              <p className="text-xs text-slate-300">Ngày {formatVietnameseDate(date)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto space-y-4">
          {/* Camera Viewport */}
          {!scannedStudent && (
            <div className="space-y-3">
              {cameraState === 'active' || cameraState === 'starting' ? (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-200">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-52 h-52 rounded-2xl border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.38)]" />
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 text-center">
                    <span className="inline-block rounded-lg bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-white">
                      {cameraState === 'starting'
                        ? 'Đang bật camera điện thoại...'
                        : 'Đưa mã QR của Lớp hoặc Học sinh vào khung vuông'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-xs text-amber-950">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-sm">
                        {cameraState === 'denied'
                          ? 'Điện thoại chưa cấp quyền Camera'
                          : 'Không thể mở Camera trực tiếp'}
                      </p>
                      <p className="mt-1 text-amber-900">{cameraErrorDetail}</p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white p-3 border border-amber-200 space-y-1.5 text-slate-700">
                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5 text-sky-600" />
                      <span>Hướng dẫn cấp quyền Camera trên điện thoại Android:</span>
                    </p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Nhấn vào biểu tượng <strong>Ổ khóa / Cài đặt trang web</strong> bên cạnh thanh địa chỉ trình duyệt Chrome.</li>
                      <li>Chọn mục <strong>Quyền (Permissions) → Máy ảnh (Camera) → Cho phép (Allow)</strong>.</li>
                      <li>Tải lại trang và mở lại nút <strong>Quét mã QR</strong>.</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Upload QR Image or Enter Code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 cursor-pointer">
                  <ImagePlus className="w-4 h-4 text-sky-600" />
                  <span>Chọn ảnh chứa mã QR</span>
                  <input type="file" accept="image/*" onChange={handleUploadQrImage} className="hidden" />
                </label>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    resolveQrValue(manualInput);
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="Hoặc nhập mã QR / Mã HS..."
                    className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Tìm
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Scanned Student Big Action Confirmation Card */}
          {scannedStudent && (
            <div className="rounded-2xl border-2 border-sky-200 bg-sky-50/40 p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-sky-700">
                    ĐÃ NHẬN DIỆN HỌC SINH · LỚP {scannedStudent.className}
                  </span>
                  <h4 className="mt-1 text-xl font-extrabold text-slate-900">
                    {scannedStudent.fullName}
                  </h4>
                  <p className="text-xs font-mono text-slate-600 mt-0.5">
                    Mã HS: {scannedStudent.studentCode} · Mã QR: {scannedStudent.qrCode || buildStudentQrCode(scannedStudent.studentCode)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    lastScannedRef.current = { code: '', at: 0 };
                    setScannedStudent(null);
                    setStatusFeedback(null);
                  }}
                  className="text-xs font-bold text-sky-700 hover:underline shrink-0 cursor-pointer"
                >
                  Quét mã khác
                </button>
              </div>

              <div className="rounded-xl bg-white border border-slate-200 p-3 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Trạng thái hiện tại:</span>
                <span
                  className={`font-extrabold text-sm ${
                    currentStatus === 'eating'
                      ? 'text-emerald-700'
                      : currentStatus === 'not_eating'
                      ? 'text-rose-700'
                      : 'text-slate-600'
                  }`}
                >
                  {currentStatus === 'eating'
                    ? 'CÓ ĂN'
                    : currentStatus === 'not_eating'
                    ? 'KHÔNG ĂN'
                    : 'CHƯA XÁC NHẬN'}
                </span>
              </div>

              {!canModify ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Đã khóa sổ ngày {formatVietnameseDate(date)}. Không thể chỉnh sửa.</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleConfirm('eating')}
                    className={`min-h-[56px] rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 transition-transform active:scale-[0.98] cursor-pointer ${
                      currentStatus === 'eating'
                        ? 'bg-emerald-700 text-white ring-4 ring-emerald-200'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    <Check className="w-5 h-5" />
                    <span>CÓ ĂN</span>
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleConfirm('not_eating')}
                    className={`min-h-[56px] rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 transition-transform active:scale-[0.98] cursor-pointer ${
                      currentStatus === 'not_eating'
                        ? 'bg-rose-700 text-white ring-4 ring-rose-200'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                    }`}
                  >
                    <X className="w-5 h-5" />
                    <span>KHÔNG ĂN</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {statusFeedback && (
            <div
              className={`rounded-xl border p-3.5 text-xs font-bold flex items-center gap-2 ${
                statusFeedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : statusFeedback.type === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : statusFeedback.type === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-sky-200 bg-sky-50 text-sky-900'
              }`}
            >
              {statusFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : statusFeedback.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusFeedback.message}</span>
            </div>
          )}

          {/* Fallback Search Notice */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              <span>Không quét được mã? Đóng để tìm theo tên học sinh.</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="font-bold text-slate-800 hover:underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
