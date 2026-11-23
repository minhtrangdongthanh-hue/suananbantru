import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, QrCode, X } from 'lucide-react';
import { buildClassQrCode, buildStudentQrCode, SchoolClass, Student } from '../types';

interface QRCodeCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: {
    code: string;
    label: string;
    sublabel: string;
  }[];
}

export const QRCodeCardModal: React.FC<QRCodeCardModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  items,
}) => {
  const [qrImages, setQrImages] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    let cancelled = false;

    const generate = async () => {
      const result: Record<string, string> = {};
      for (const item of items.slice(0, 60)) {
        try {
          result[item.code] = await QRCode.toDataURL(item.code, {
            width: 240,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
        } catch {
          // ignore
        }
      }
      if (!cancelled) setQrImages(result);
    };

    void generate();
    return () => {
      cancelled = true;
    };
  }, [isOpen, items]);

  if (!isOpen) return null;

  const handleDownload = (code: string, label: string) => {
    const dataUrl = qrImages[code];
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `QR_${label.replace(/\s+/g, '_')}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="no-print flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>In thẻ QR</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {items.map((item) => (
            <div
              key={item.code}
              className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col items-center text-center space-y-2 print-break-inside-avoid"
            >
              {qrImages[item.code] ? (
                <img
                  src={qrImages[item.code]}
                  alt={`Mã QR ${item.label}`}
                  className="w-36 h-36 object-contain"
                />
              ) : (
                <div className="w-36 h-36 bg-slate-100 rounded-lg animate-pulse" />
              )}
              <div>
                <p className="text-sm font-extrabold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.sublabel}</p>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">{item.code}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(item.code, item.label)}
                className="no-print inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải ảnh QR</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export function buildClassQrItems(cls: SchoolClass, classStudents: Student[]) {
  return [
    {
      code: buildClassQrCode(cls.id),
      label: `Lớp ${cls.name}`,
      sublabel: `Mã QR mở danh sách Lớp ${cls.name}`,
    },
    ...classStudents.map((s) => ({
      code: s.qrCode || buildStudentQrCode(s.studentCode),
      label: s.fullName,
      sublabel: `Lớp ${s.className} · ${s.studentCode}`,
    })),
  ];
}
