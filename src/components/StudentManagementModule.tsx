import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AppEnvironment,
  ArchivedYearSnapshot,
  buildStudentQrCode,
  BULK_DELETE_CONFIRM_PHRASE,
  GradeLevel,
  sanitizeId,
  SCHOOL_ID,
  SchoolClass,
  Student,
  StudentGender,
} from '../types';
import {
  batchImportStudents,
  bulkResetAllStudentsForNewYear,
  deleteMultipleStudents,
  deleteSingleStudent,
} from '../services/mealService';
import { QRCodeCardModal } from './QRCodeCardModal';

interface StudentManagementModuleProps {
  classes: SchoolClass[];
  students: Student[];
  archivedYears: ArchivedYearSnapshot[];
  academicYear: string;
  onSaveStudent: (student: Student) => Promise<void>;
  env?: AppEnvironment;
  currentUserName: string;
  currentUserUid: string;
  isAdmin: boolean;
  canManageStudents?: boolean;
}

interface ParsedExcelStudentRow {
  rowNum: number;
  studentCode: string;
  fullName: string;
  className: string;
  classId: string;
  grade: GradeLevel;
  gender: StudentGender;
  parentName: string;
  active: boolean;
  valid: boolean;
  errorReason?: string;
  isDuplicateInFile?: boolean;
  existsInSystem?: boolean;
}

function normalizeHeaderText(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeClassToken(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^lop/i, '');
}

function parseGenderValue(val: unknown): StudentGender {
  const norm = normalizeHeaderText(val);
  if (!norm) return '';
  if (norm === 'nam' || norm === 'male' || norm === 'm' || norm === 'trai') return 'Nam';
  if (norm === 'nu' || norm === 'female' || norm === 'f' || norm === 'gai') return 'Nữ';
  return 'Khác';
}

export function StudentManagementModule({
  classes,
  students,
  archivedYears,
  academicYear,
  onSaveStudent,
  env = 'production',
  currentUserName,
  currentUserUid,
  isAdmin,
  canManageStudents = false,
}: StudentManagementModuleProps) {
  const canEditStudents = isAdmin || canManageStudents;
  const [viewMode, setViewMode] = useState<'list' | 'archives'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Selection for multi-delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Excel Import state
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState<'add_only' | 'upsert' | 'replace_all'>('upsert');
  const [previewRows, setPreviewRows] = useState<ParsedExcelStudentRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Single student modal state
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [formData, setFormData] = useState<{
    studentCode: string;
    fullName: string;
    classId: string;
    gender: StudentGender;
    parentName: string;
    active: boolean;
  }>({
    studentCode: '',
    fullName: '',
    classId: classes.find((c) => c.env === env && c.active)?.id || '',
    gender: 'Nam',
    parentName: '',
    active: true,
  });

  // QR Code Modal state
  const [qrModalStudents, setQrModalStudents] = useState<Student[] | null>(null);

  // Bulk Reset 2-step Modal state
  const [resetModalStep, setResetModalStep] = useState<0 | 1 | 2>(0);
  const [resetScope, setResetScope] = useState<'all' | GradeLevel>('all');
  const [resetPhraseInput, setResetPhraseInput] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  // Single & Multi-select Delete Confirmation Modal state
  const [pendingDeleteStudent, setPendingDeleteStudent] = useState<Student | null>(null);
  const [confirmBulkSelected, setConfirmBulkSelected] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const envClasses = useMemo(
    () =>
      classes
        .filter((c) => c.env === env)
        .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order)),
    [classes, env]
  );

  const envStudents = useMemo(
    () =>
      students
        .filter((s) => s.env === env)
        .sort((a, b) =>
          a.className !== b.className
            ? a.className.localeCompare(b.className, 'vi')
            : a.fullName.localeCompare(b.fullName, 'vi')
        ),
    [students, env]
  );

  // Automatically clear stale selection/modals if records were deleted on this or another device
  useEffect(() => {
    const activeIds = new Set(envStudents.map((s) => s.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => activeIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (pendingDeleteStudent && !activeIds.has(pendingDeleteStudent.id)) {
      setPendingDeleteStudent(null);
    }
    if (editingStudent && !activeIds.has(editingStudent.id)) {
      setEditingStudent(null);
      setShowModal(false);
    }
  }, [envStudents, pendingDeleteStudent, editingStudent]);

  const filteredStudents = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return envStudents.filter((s) => {
      const matchesSearch =
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q) ||
        (s.qrCode && s.qrCode.toLowerCase().includes(q));
      const matchesGrade = filterGrade === 'all' || s.grade === Number(filterGrade);
      const matchesClass = filterClassId === 'all' || s.classId === filterClassId;
      const matchesStatus =
        filterStatus === 'all' ||
        (filterStatus === 'active' && s.active) ||
        (filterStatus === 'inactive' && !s.active);
      return matchesSearch && matchesGrade && matchesClass && matchesStatus;
    });
  }, [envStudents, searchTerm, filterGrade, filterClassId, filterStatus]);

  // Auto-detect duplicate (fullName + classId) in active list
  const duplicateNameClassPairs = useMemo(() => {
    const counts = new Map<string, Student[]>();
    for (const s of envStudents) {
      const key = `${s.fullName.trim().toLowerCase()}__${s.classId}`;
      const arr = counts.get(key) || [];
      arr.push(s);
      counts.set(key, arr);
    }
    return Array.from(counts.values()).filter((arr) => arr.length > 1);
  }, [envStudents]);

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = [
      ['STT', 'Mã học sinh', 'Họ và tên', 'Lớp', 'Khối', 'Giới tính', 'Trạng thái học sinh'],
      [1, 'DT60101', 'Nguyễn Văn An', '6/1', 6, 'Nam', 'Đang học bán trú'],
      [2, 'DT60102', 'Trần Thị Bảo Châu', '6/1', 6, 'Nữ', 'Đang học bán trú'],
      [3, 'DT70101', 'Lê Minh Khôi', '7/1', 7, 'Nam', 'Đang học bán trú'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Hoc_Sinh');
    XLSX.writeFile(wb, 'Mau_Nhap_Hoc_Sinh_THCS_Dong_Thanh.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });

        if (rows.length < 2) {
          setErrorMessage('File Excel không có dữ liệu học sinh.');
          return;
        }

        // Smart auto-detect header row among first 5 rows
        let headerRowIdx = 0;
        let colMap = {
          code: -1,
          name: -1,
          className: -1,
          grade: -1,
          gender: -1,
          parentName: -1,
          status: -1,
        };

        for (let r = 0; r < Math.min(5, rows.length); r++) {
          const candidate = rows[r] || [];
          const normalized = candidate.map((c) => normalizeHeaderText(c));
          const nameIdx = normalized.findIndex(
            (h) => h.includes('ho va ten') || h.includes('ho ten') || h === 'ten hoc sinh' || h === 'full name'
          );
          const classIdx = normalized.findIndex((h) => h === 'lop' || h.startsWith('lop ') || h === 'class');

          if (nameIdx !== -1 && classIdx !== -1) {
            headerRowIdx = r;
            colMap = {
              code: normalized.findIndex((h) => h.includes('ma hs') || h.includes('ma hoc sinh') || h === 'code'),
              name: nameIdx,
              className: classIdx,
              grade: normalized.findIndex((h) => h === 'khoi' || h.includes('khoi lop') || h === 'grade'),
              gender: normalized.findIndex((h) => h.includes('gioi tinh') || h === 'phai' || h === 'gender'),
              parentName: normalized.findIndex((h) => h.includes('phu huynh') || h.includes('lien he')),
              status: normalized.findIndex((h) => h.includes('trang thai') || h.includes('status')),
            };
            break;
          }
        }

        // Fallback column layout if headers weren't matched
        if (colMap.name === -1 || colMap.className === -1) {
          colMap = {
            code: 1,
            name: 2,
            className: 3,
            grade: 4,
            gender: 5,
            parentName: -1,
            status: 6,
          };
        }

        const existingByCode = new Set(envStudents.map((s) => s.studentCode.toUpperCase()));
        const existingByNameClass = new Set(
          envStudents.map((s) => `${s.fullName.trim().toLowerCase()}__${s.classId}`)
        );
        const seenNameClassInFile = new Set<string>();
        const seenCodeInFile = new Set<string>();

        const parsedRows: ParsedExcelStudentRow[] = [];
        const errors: string[] = [];

        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i] || [];
          const rawName = String(row[colMap.name] ?? '').trim();
          const rawClass = String(row[colMap.className] ?? '').trim();
          if (!rawName && !rawClass) continue; // skip blank row

          const rawCode = colMap.code >= 0 ? String(row[colMap.code] ?? '').trim() : '';
          const rawGender = colMap.gender >= 0 ? row[colMap.gender] : '';
          const rawParent = colMap.parentName >= 0 ? String(row[colMap.parentName] ?? '').trim() : '';
          const rawStatus = colMap.status >= 0 ? String(row[colMap.status] ?? 'Đang học').trim() : 'Đang học';

          const token = normalizeClassToken(rawClass);
          const matchedClass = envClasses.find(
            (c) => normalizeClassToken(c.name) === token
          );

          const generatedCode =
            rawCode.toUpperCase() ||
            sanitizeId(`DT${matchedClass ? `${matchedClass.grade}${String(matchedClass.order).padStart(2, '0')}` : 'HS'}_${i}_${rawName.slice(0, 4)}`).toUpperCase();

          let errorReason = '';
          if (!rawName) errorReason = 'Thiếu họ và tên học sinh';
          else if (!matchedClass) errorReason = `Lớp "${rawClass}" không nằm trong 61 lớp`;

          if (errorReason) {
            errors.push(`Dòng ${i + 1} (${rawName || 'Trống'}): ${errorReason}`);
          }

          const nameClassKey = matchedClass
            ? `${rawName.toLowerCase()}__${matchedClass.id}`
            : `${rawName.toLowerCase()}__${token}`;
          const isDupInFile =
            seenNameClassInFile.has(nameClassKey) ||
            (rawCode !== '' && seenCodeInFile.has(generatedCode));

          seenNameClassInFile.add(nameClassKey);
          seenCodeInFile.add(generatedCode);

          const existsInSystem =
            existingByCode.has(generatedCode) || existingByNameClass.has(nameClassKey);

          const lowerStatus = normalizeHeaderText(rawStatus);
          const isActive =
            !lowerStatus.includes('ngung') &&
            !lowerStatus.includes('nghi') &&
            !lowerStatus.includes('chuyen truong');

          parsedRows.push({
            rowNum: i + 1,
            studentCode: generatedCode,
            fullName: rawName,
            className: matchedClass ? matchedClass.name : rawClass,
            classId: matchedClass ? matchedClass.id : '',
            grade: matchedClass ? matchedClass.grade : 6,
            gender: parseGenderValue(rawGender),
            parentName: rawParent,
            active: isActive,
            valid: !errorReason,
            errorReason,
            isDuplicateInFile: isDupInFile,
            existsInSystem,
          });
        }

        setPreviewRows(parsedRows);
        setImportErrors(errors);
        setImporting(true);
      } catch (err) {
        setErrorMessage(`Lỗi đọc file Excel: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    const validRows = previewRows.filter((r) => r.valid && r.classId);
    if (validRows.length === 0) {
      setErrorMessage('Không có dòng học sinh hợp lệ để nhập.');
      return;
    }

    setImportBusy(true);
    setErrorMessage(null);
    try {
      const studentsToImport = validRows.map((r) => ({
        id: sanitizeId(`${env}_stu_${r.studentCode}`),
        studentCode: r.studentCode,
        fullName: r.fullName,
        classId: r.classId,
        className: r.className,
        grade: r.grade,
        gender: r.gender,
        qrCode: buildStudentQrCode(r.studentCode),
        parentName: r.parentName,
        parentUid: 'internal',
        active: r.active,
        env,
        schoolId: SCHOOL_ID,
        visibility: 'school' as const,
        updatedByUid: currentUserUid,
      }));

      const res = await batchImportStudents({
        studentsList: studentsToImport,
        mode: importMode,
        academicYear,
        actorUid: currentUserUid,
        actorName: currentUserName,
        env,
      });

      setSuccessMessage(
        `Đã nhập thành công ${res.importedCount} học sinh từ file Excel${
          res.skippedCount > 0 ? ` (bỏ qua ${res.skippedCount} học sinh đã tồn tại)` : ''
        }.`
      );
      setImporting(false);
      setPreviewRows([]);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingStudent(null);
    setFormData({
      studentCode: `DT${Math.floor(10000 + Math.random() * 90000)}`,
      fullName: '',
      classId: envClasses.find((c) => c.active)?.id || '',
      gender: 'Nam',
      parentName: '',
      active: true,
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (stu: Student) => {
    setEditingStudent(stu);
    setFormData({
      studentCode: stu.studentCode,
      fullName: stu.fullName,
      classId: stu.classId,
      gender: stu.gender || '',
      parentName: stu.parentName || '',
      active: stu.active,
    });
    setShowModal(true);
  };

  const handleSaveSingleStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const classObj = envClasses.find((c) => c.id === formData.classId);
    if (!classObj) return;

    await onSaveStudent({
      id: editingStudent ? editingStudent.id : sanitizeId(`${env}_stu_${formData.studentCode.toUpperCase()}`),
      studentCode: formData.studentCode.trim().toUpperCase(),
      fullName: formData.fullName.trim(),
      classId: classObj.id,
      className: classObj.name,
      grade: classObj.grade,
      gender: formData.gender,
      qrCode: editingStudent?.qrCode || buildStudentQrCode(formData.studentCode),
      parentName: formData.parentName.trim(),
      parentUid: editingStudent?.parentUid || 'internal',
      active: formData.active,
      env,
      schoolId: SCHOOL_ID,
      visibility: 'school',
      updatedByUid: currentUserUid,
    });

    setShowModal(false);
    setSuccessMessage(`Đã lưu thông tin học sinh ${formData.fullName}.`);
  };

  const handleConfirmDeleteOne = async () => {
    if (!canEditStudents || !pendingDeleteStudent) return;
    const stu = pendingDeleteStudent;
    setDeleteBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteSingleStudent({
        student: stu,
        actorUid: currentUserUid,
        actorName: currentUserName,
        env,
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(stu.id);
        return next;
      });
      setPendingDeleteStudent(null);
      setSuccessMessage(`Đã xóa vĩnh viễn học sinh ${stu.fullName} (${stu.className}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleConfirmBulkDeleteSelected = async () => {
    if (!canEditStudents || selectedIds.size === 0) return;
    const targets = envStudents.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) {
      setConfirmBulkSelected(false);
      return;
    }
    setDeleteBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const count = await deleteMultipleStudents({
        studentsToDelete: targets,
        actorUid: currentUserUid,
        actorName: currentUserName,
        env,
      });
      setSelectedIds(new Set());
      setConfirmBulkSelected(false);
      setSuccessMessage(`Đã xóa vĩnh viễn ${count} học sinh đã chọn khỏi danh sách.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleConfirmBulkReset = async () => {
    setResetBusy(true);
    setErrorMessage(null);
    try {
      const res = await bulkResetAllStudentsForNewYear({
        confirmationPhrase: resetPhraseInput,
        scope: resetScope,
        academicYear,
        actorUid: currentUserUid,
        actorName: currentUserName,
        env,
      });
      setResetModalStep(0);
      setResetPhraseInput('');
      setSelectedIds(new Set());
      setSuccessMessage(
        `Đã tự động sao lưu ${res.archivedCount} học sinh vào Kho lưu trữ (${res.archiveId}) và xóa sạch ${res.deletedCount} học sinh khỏi danh sách hiện hành để sẵn sàng nhập năm học mới.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setResetBusy(false);
    }
  };

  const handleExportExcel = (list: Student[] = filteredStudents, suffix = 'HienHanh') => {
    const wb = XLSX.utils.book_new();
    const exportRows = list.map((s, idx) => ({
      STT: idx + 1,
      'Mã học sinh': s.studentCode,
      'Họ và tên': s.fullName,
      'Lớp': s.className,
      'Khối': s.grade,
      'Giới tính': s.gender || '',
      'Trạng thái học sinh': s.active ? 'Đang tham gia bán trú' : 'Ngừng bán trú',
      'Mã QR học sinh': s.qrCode || buildStudentQrCode(s.studentCode),
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Hoc_Sinh');
    XLSX.writeFile(wb, `Danh_Sach_Hoc_Sinh_THCS_Dong_Thanh_${suffix}.xlsx`);
  };

  const allFilteredSelected =
    filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map((s) => s.id)));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Main Actions */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">
              DANH SÁCH HỌC SINH ({envStudents.length} HS)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quản lý toàn bộ học sinh 61 lớp, nhập/xuất Excel, tạo mã QR học sinh và chốt chuyển năm học mới.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 self-start">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Danh sách hiện hành ({envStudents.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('archives')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'archives' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Lưu trữ năm cũ ({archivedYears.filter((a) => a.env === env).length})</span>
            </button>
          </div>
        </div>

        {viewMode === 'list' && (
          <div className="flex flex-wrap items-center gap-2.5">
            {canEditStudents && (
              <>
                <label className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Tải lên Excel cả trường</span>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
                </label>

                <button
                  type="button"
                  onClick={handleOpenAddModal}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <span>Thêm học sinh</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-4 h-4 text-sky-600" />
              <span>Tải Excel mẫu</span>
            </button>

            <button
              type="button"
              onClick={() => handleExportExcel(filteredStudents, 'HienHanh')}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>Tải xuống Excel</span>
            </button>

            {filteredStudents.length > 0 && (
              <button
                type="button"
                onClick={() => setQrModalStudents(filteredStudents.slice(0, 60))}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                <QrCode className="w-4 h-4 text-sky-600" />
                <span>In thẻ QR ({Math.min(60, filteredStudents.length)})</span>
              </button>
            )}

            {isAdmin && envStudents.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setResetScope('all');
                  setResetPhraseInput('');
                  setResetModalStep(1);
                }}
                className="min-h-[44px] sm:ml-auto inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>XÓA TOÀN BỘ DANH SÁCH HỌC SINH</span>
              </button>
            )}
          </div>
        )}
      </div>

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-700 hover:underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {/* Duplicate Name+Class Warning */}
      {viewMode === 'list' && duplicateNameClassPairs.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              Phát hiện {duplicateNameClassPairs.length} trường hợp trùng Họ tên trong cùng Lớp:
            </p>
            <p className="mt-0.5 text-amber-800">
              {duplicateNameClassPairs
                .slice(0, 5)
                .map((arr) => `${arr[0].fullName} (${arr[0].className})`)
                .join(', ')}
              {duplicateNameClassPairs.length > 5 ? '...' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Excel Preview Modal / Card */}
      {importing && viewMode === 'list' && (
        <div className="rounded-2xl border-2 border-sky-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-sky-600" />
                <span>Xem trước &amp; Kiểm tra file Excel trước khi nhập</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Đọc được <strong>{previewRows.length}</strong> dòng · Hợp lệ:{' '}
                <strong className="text-emerald-700">{previewRows.filter((r) => r.valid).length}</strong> · Lỗi:{' '}
                <strong className="text-rose-700">{previewRows.filter((r) => !r.valid).length}</strong> · Trùng lặp:{' '}
                <strong className="text-amber-700">
                  {previewRows.filter((r) => r.isDuplicateInFile || r.existsInSystem).length}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setImporting(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Hủy nhập Excel
            </button>
          </div>

          {importErrors.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 max-h-32 overflow-y-auto space-y-1">
              <p className="font-bold">Cảnh báo các dòng lỗi (sẽ không được nhập nếu thiếu lớp):</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {importErrors.slice(0, 20).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
            <span className="font-bold text-slate-800 shrink-0">Chế độ xử lý khi nhập:</span>
            <select
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as 'add_only' | 'upsert' | 'replace_all')}
              className="min-h-[40px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-900"
            >
              <option value="upsert">Thêm mới &amp; Cập nhật học sinh trùng mã (Khuyên dùng)</option>
              <option value="add_only">Chỉ thêm học sinh mới (Bỏ qua học sinh đã có)</option>
              <option value="replace_all">Sao lưu danh sách cũ &amp; Thay thế toàn bộ bằng file này</option>
            </select>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 font-bold text-slate-700 sticky top-0">
                <tr>
                  <th className="p-2.5">Dòng</th>
                  <th className="p-2.5">Mã HS</th>
                  <th className="p-2.5">Họ và tên</th>
                  <th className="p-2.5">Lớp</th>
                  <th className="p-2.5">Khối</th>
                  <th className="p-2.5">Giới tính</th>
                  <th className="p-2.5">Trạng thái</th>
                  <th className="p-2.5">Kiểm tra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.slice(0, 200).map((row) => (
                  <tr key={row.rowNum} className={row.valid ? 'hover:bg-slate-50' : 'bg-rose-50/70'}>
                    <td className="p-2.5 font-mono text-slate-400">{row.rowNum}</td>
                    <td className="p-2.5 font-mono font-semibold">{row.studentCode}</td>
                    <td className="p-2.5 font-bold text-slate-900">{row.fullName}</td>
                    <td className="p-2.5">{row.className}</td>
                    <td className="p-2.5 font-mono">{row.grade}</td>
                    <td className="p-2.5">{row.gender || '—'}</td>
                    <td className="p-2.5">{row.active ? 'Đang học' : 'Ngừng'}</td>
                    <td className="p-2.5">
                      {!row.valid ? (
                        <span className="text-rose-600 font-bold">{row.errorReason}</span>
                      ) : row.isDuplicateInFile ? (
                        <span className="text-amber-700 font-bold">Trùng trong file</span>
                      ) : row.existsInSystem ? (
                        <span className="text-sky-700 font-bold">Đã có trên hệ thống</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">Hợp lệ (Mới)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setImporting(false)}
              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={importBusy || previewRows.filter((r) => r.valid).length === 0}
              onClick={handleConfirmImport}
              className="min-h-[44px] rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {importBusy
                ? 'Đang nhập dữ liệu...'
                : `Xác nhận nhập ${previewRows.filter((r) => r.valid).length} học sinh`}
            </button>
          </div>
        </div>
      )}

      {viewMode === 'list' ? (
        <>
          {/* Filter & Search Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm tên, lớp, mã HS, mã QR..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <select
              value={filterGrade}
              onChange={(e) => {
                setFilterGrade(e.target.value);
                setFilterClassId('all');
              }}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="all">Tất cả 4 Khối</option>
              <option value="6">Khối 6 (14 lớp)</option>
              <option value="7">Khối 7 (13 lớp)</option>
              <option value="8">Khối 8 (15 lớp)</option>
              <option value="9">Khối 9 (19 lớp)</option>
            </select>

            <select
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="all">Tất cả 61 Lớp</option>
              {envClasses
                .filter((c) => filterGrade === 'all' || c.grade === Number(filterGrade))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    Lớp {c.name}
                  </option>
                ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="all">Tất cả Trạng thái</option>
              <option value="active">Đang tham gia bán trú</option>
              <option value="inactive">Đã ngừng bán trú</option>
            </select>
          </div>

          {/* Bulk Selection Toolbar */}
          {canEditStudents && selectedIds.size > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-rose-900">
                Đã chọn <span className="font-mono text-sm">{selectedIds.size}</span> học sinh
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
                >
                  Bỏ chọn
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkSelected(true)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa các học sinh đã chọn</span>
                </button>
              </div>
            </div>
          )}

          {/* Student List (Mobile Cards + Desktop 7-Column Table) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">
                Hiển thị <span className="font-mono text-slate-900">{filteredStudents.length}</span> học sinh
              </span>
              {canEditStudents && filteredStudents.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  className="font-bold text-sky-700 hover:underline cursor-pointer"
                >
                  {allFilteredSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả đang lọc'}
                </button>
              )}
            </div>

            {filteredStudents.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-bold text-slate-800">
                  Danh sách học sinh đang trống
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Chưa có học sinh nào trong bộ lọc. Quản trị viên có thể nhấn{' '}
                  <strong>Tải lên Excel cả trường</strong> hoặc <strong>Thêm học sinh</strong> để bắt đầu.
                </p>
              </div>
            ) : (
              <>
                {/* Mobile Cards (< md) */}
                <div className="divide-y divide-slate-100 md:hidden">
                  {filteredStudents.map((s, idx) => {
                    const qr = s.qrCode || buildStudentQrCode(s.studentCode);
                    return (
                      <div key={s.id} className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            {canEditStudents && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(s.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedIds);
                                  if (e.target.checked) next.add(s.id);
                                  else next.delete(s.id);
                                  setSelectedIds(next);
                                }}
                                className="mt-1 w-4 h-4 rounded"
                              />
                            )}
                            <div>
                              <span className="text-[11px] font-mono text-slate-500">
                                #{idx + 1} · Lớp {s.className} (Khối {s.grade}) · {s.gender || 'Chưa rõ giới tính'}
                              </span>
                              <h4 className="text-base font-extrabold text-slate-900">{s.fullName}</h4>
                              <p className="text-xs font-mono text-sky-700 mt-0.5">QR: {qr}</p>
                            </div>
                          </div>
                          <span
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold shrink-0 ${
                              s.active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {s.active ? 'Đang học' : 'Ngừng'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQrModalStudents([s])}
                            className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800 cursor-pointer"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Xem QR</span>
                          </button>
                          {canEditStudents && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(s)}
                                className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteStudent(s)}
                                className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Xóa</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop 7-Column Table (>= md) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold text-slate-700 border-b border-slate-200">
                      <tr>
                        <th className="p-3.5 w-16">
                          <div className="flex items-center gap-2">
                            {canEditStudents && (
                              <input
                                type="checkbox"
                                checked={allFilteredSelected}
                                onChange={toggleSelectAllFiltered}
                                className="w-4 h-4 rounded cursor-pointer"
                              />
                            )}
                            <span>STT</span>
                          </div>
                        </th>
                        <th className="p-3.5">Họ và tên</th>
                        <th className="p-3.5 w-20">Lớp</th>
                        <th className="p-3.5 w-20">Khối</th>
                        <th className="p-3.5 w-24">Giới tính</th>
                        <th className="p-3.5 w-44">Trạng thái học sinh</th>
                        <th className="p-3.5">Mã QR học sinh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {filteredStudents.map((s, idx) => {
                        const qr = s.qrCode || buildStudentQrCode(s.studentCode);
                        return (
                          <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3.5 font-mono text-slate-500">
                              <div className="flex items-center gap-2">
                                {canEditStudents && (
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.has(s.id)}
                                    onChange={(e) => {
                                      const next = new Set(selectedIds);
                                      if (e.target.checked) next.add(s.id);
                                      else next.delete(s.id);
                                      setSelectedIds(next);
                                    }}
                                    className="w-4 h-4 rounded cursor-pointer"
                                  />
                                )}
                                <span>{idx + 1}</span>
                              </div>
                            </td>
                            <td className="p-3.5">
                              <div className="font-extrabold text-slate-900 text-sm">{s.fullName}</div>
                              <div className="font-mono text-[11px] text-slate-500">Mã HS: {s.studentCode}</div>
                            </td>
                            <td className="p-3.5 font-bold text-slate-800">{s.className}</td>
                            <td className="p-3.5 font-mono text-slate-700">Khối {s.grade}</td>
                            <td className="p-3.5 text-slate-700">{s.gender || '—'}</td>
                            <td className="p-3.5">
                              {s.active ? (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                                  <UserCheck className="w-3.5 h-3.5" />
                                  <span>Đang học bán trú</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 border border-slate-200">
                                  <UserX className="w-3.5 h-3.5" />
                                  <span>Ngừng bán trú</span>
                                </span>
                              )}
                            </td>
                            <td className="p-3.5">
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => setQrModalStudents([s])}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 font-mono text-[11px] font-bold text-sky-800 hover:bg-sky-100 cursor-pointer"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>{qr}</span>
                                </button>
                                {canEditStudents && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditModal(s)}
                                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPendingDeleteStudent(s)}
                                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        /* Archived School Years View */
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Kho Lưu trữ Danh sách Học sinh Năm học cũ
            </h3>
            <p className="text-xs text-slate-500">
              Mỗi lần thực hiện "XÓA TOÀN BỘ DANH SÁCH HỌC SINH", hệ thống tự động chụp bản sao lưu an toàn vào đây.
            </p>
          </div>
          {archivedYears.filter((a) => a.env === env).length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Chưa có bản lưu trữ năm học cũ nào.
            </p>
          ) : (
            <div className="space-y-3">
              {archivedYears
                .filter((a) => a.env === env)
                .map((arc) => (
                  <div
                    key={arc.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm">
                        Năm học {arc.academicYear} · {arc.scope} ({arc.studentCount} học sinh)
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        Lưu trữ lúc: <span className="font-mono">{arc.archivedAtIso}</span> · Thực hiện bởi:{' '}
                        <strong>{arc.archivedByName}</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleExportExcel(arc.students, `LuuTru_${arc.academicYear.replace(/\s+/g, '')}`)
                      }
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3.5 py-2 font-bold text-emerald-800 hover:bg-emerald-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Tải Excel bản lưu trữ</span>
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Single Student Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingStudent ? 'Cập nhật thông tin học sinh' : 'Thêm học sinh mới'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSingleStudent} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mã học sinh *</label>
                <input
                  type="text"
                  required
                  value={formData.studentCode}
                  onChange={(e) => setFormData({ ...formData, studentCode: e.target.value })}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Họ và tên học sinh *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Nguyễn Văn An"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Lớp *</label>
                  <select
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    {envClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        Lớp {c.name} (Khối {c.grade})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Giới tính</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value as StudentGender })}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú liên hệ (tùy chọn)</label>
                <input
                  type="text"
                  placeholder="Thông tin phụ huynh / SĐT (nếu cần)"
                  value={formData.parentName}
                  onChange={(e) => setFormData({ ...formData, parentName: e.target.value })}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <label className="flex items-center gap-2 pt-1 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="w-4 h-4 rounded text-sky-600"
                />
                <span>Đang học bán trú chính thức</span>
              </label>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                >
                  Lưu học sinh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2-Step Bulk Delete Modal */}
      {resetModalStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-extrabold">
                {resetModalStep === 1
                  ? 'Cảnh báo: Xóa danh sách học sinh năm học cũ'
                  : 'Xác nhận lần 2 để thực hiện Xóa toàn bộ'}
              </h3>
            </div>

            {resetModalStep === 1 ? (
              <div className="space-y-4 text-xs text-slate-700">
                <p>
                  Thao tác này dùng vào đầu năm học mới để dọn sạch danh sách học sinh cũ trước khi nhập danh sách mới từ Excel.
                </p>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 space-y-1">
                  <p className="font-bold">Cam kết an toàn dữ liệu:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Tự động sao lưu toàn bộ học sinh hiện tại vào <strong>Kho lưu trữ năm cũ</strong> trước khi xóa.</li>
                    <li>Không xóa tài khoản giáo viên/kế toán/y tế, không xóa cấu hình 61 lớp, không xóa báo cáo lịch sử cũ.</li>
                    <li>Đồng bộ xóa sạch trên tất cả thiết bị (không tự khôi phục từ bộ nhớ đệm).</li>
                  </ul>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">Phạm vi xóa:</label>
                  <select
                    value={String(resetScope)}
                    onChange={(e) =>
                      setResetScope(
                        e.target.value === 'all' ? 'all' : (Number(e.target.value) as GradeLevel)
                      )
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    <option value="all">Toàn trường (Tất cả {envStudents.length} học sinh)</option>
                    <option value="6">Chỉ Khối 6 ({envStudents.filter((s) => s.grade === 6).length} HS)</option>
                    <option value="7">Chỉ Khối 7 ({envStudents.filter((s) => s.grade === 7).length} HS)</option>
                    <option value="8">Chỉ Khối 8 ({envStudents.filter((s) => s.grade === 8).length} HS)</option>
                    <option value="9">Chỉ Khối 9 ({envStudents.filter((s) => s.grade === 9).length} HS)</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalStep(0)}
                    className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2 font-bold text-slate-700 cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetModalStep(2)}
                    className="min-h-[44px] rounded-xl bg-rose-600 px-4 py-2 font-extrabold text-white hover:bg-rose-700 cursor-pointer"
                  >
                    Tiếp tục xác nhận
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs text-slate-700">
                <p>
                  Để xác nhận chắc chắn không bấm nhầm, vui lòng nhập chính xác cụm từ xác nhận bên dưới:
                </p>
                <div className="rounded-xl bg-slate-100 p-3 text-center font-mono text-sm font-extrabold text-rose-700 select-all">
                  {BULK_DELETE_CONFIRM_PHRASE}
                </div>
                <input
                  type="text"
                  value={resetPhraseInput}
                  onChange={(e) => setResetPhraseInput(e.target.value)}
                  placeholder={`Nhập đúng: ${BULK_DELETE_CONFIRM_PHRASE}`}
                  className="w-full min-h-[46px] rounded-xl border-2 border-rose-300 px-3 py-2 text-sm font-mono font-bold text-slate-900"
                />
                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalStep(1)}
                    className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2 font-bold text-slate-700 cursor-pointer"
                  >
                    Quay lại
                  </button>
                  <button
                    type="button"
                    disabled={resetBusy || resetPhraseInput.trim() !== BULK_DELETE_CONFIRM_PHRASE}
                    onClick={handleConfirmBulkReset}
                    className="min-h-[44px] rounded-xl bg-rose-600 px-5 py-2 font-extrabold text-white hover:bg-rose-700 disabled:opacity-40 cursor-pointer"
                  >
                    {resetBusy ? 'Đang sao lưu & xóa...' : 'XÁC NHẬN XÓA TOÀN BỘ'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Card Modal */}
      {qrModalStudents && (
        <QRCodeCardModal
          isOpen={true}
          onClose={() => setQrModalStudents(null)}
          title="Mã QR Học sinh Bán trú"
          subtitle="Dùng camera điện thoại quét mã QR này để xác nhận CÓ ĂN / KHÔNG ĂN ngay lập tức"
          items={qrModalStudents.map((s) => ({
            code: s.qrCode || buildStudentQrCode(s.studentCode),
            label: s.fullName,
            sublabel: `Lớp ${s.className} · ${s.studentCode}`,
          }))}
        />
      )}

      {/* Single Student Delete Confirmation Modal */}
      {pendingDeleteStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold">Xác nhận xóa học sinh</h3>
            </div>
            <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
              <p>
                Bạn có chắc chắn muốn xóa vĩnh viễn học sinh{' '}
                <strong className="text-slate-900">{pendingDeleteStudent.fullName}</strong> (Mã HS:{' '}
                <span className="font-mono font-bold">{pendingDeleteStudent.studentCode}</span> · Lớp{' '}
                <strong>{pendingDeleteStudent.className}</strong>)?
              </p>
              <p className="text-slate-500">
                Hồ sơ học sinh và các đăng ký suất ăn chưa khóa sổ của học sinh này sẽ bị xóa đồng bộ trên tất cả thiết bị (báo cáo đã chốt lịch sử và nhật ký kiểm toán vẫn được bảo toàn).
              </p>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setPendingDeleteStudent(null)}
                className="min-h-[42px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleConfirmDeleteOne}
                className="min-h-[42px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deleteBusy ? 'Đang xóa...' : 'Xác nhận xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-select Delete Confirmation Modal */}
      {confirmBulkSelected && selectedIds.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold">
                Xác nhận xóa {selectedIds.size} học sinh đã chọn
              </h3>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Hệ thống sẽ xóa vĩnh viễn <strong>{selectedIds.size}</strong> học sinh đang chọn cùng các đăng ký chưa khóa sổ liên quan, đồng thời ghi nhận dấu vết xóa để không tự khôi phục khi đồng bộ lại.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setConfirmBulkSelected(false)}
                className="min-h-[42px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleConfirmBulkDeleteSelected}
                className="min-h-[42px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deleteBusy ? 'Đang xóa...' : `Xác nhận xóa ${selectedIds.size} HS`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
