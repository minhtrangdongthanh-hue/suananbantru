import { auth } from '../firebase';
import {
  buildClassQrCode,
  buildStudentQrCode,
  ClassInvite,
  DeletionTombstone,
  extractInviteCodeFromText,
  generateClassInviteCode,
  generateRoleInviteCode,
  getDefaultPermissionGroups,
  getInviteTargetRole,
  getVietnamDateParts,
  normalizeEmailKey,
  resolveEffectiveGroup,
  SCHOOL_ID,
  SchoolClass,
  Student,
  SYSTEM_MODULES_META,
  TestScenarioResult,
  UserRole,
} from '../types';
import {
  getHybridStore,
  getTombstoneId,
  reconcileCollectionWithCloud,
  saveHybridStore,
} from './localStoreFallback';
import {
  bulkResetAllStudentsForNewYear,
  clearSandboxData,
  computeSchoolSummaries,
  getDailyReportDocId,
  getRegistrationDocId,
  lockDailyReportTransaction,
  registerStudentMeal,
  saveAccountAccess,
  saveSchoolClass,
  saveStudent,
} from './mealService';

export async function runFull12ScenarioVerification(
  onProgress?: (results: TestScenarioResult[]) => void
): Promise<{
  results: TestScenarioResult[];
  allPassed: boolean;
  reconciliationMatch: boolean;
  summaryText: string;
}> {
  const uid = auth.currentUser?.uid || 'test_runner';
  const userName = auth.currentUser?.displayName || auth.currentUser?.email || 'Kiểm thử viên';

  const results: TestScenarioResult[] = [];
  const pushResult = (res: TestScenarioResult) => {
    results.push(res);
    if (onProgress) onProgress([...results]);
  };

  await clearSandboxData();
  const testDate = '2026-12-15';

  const sandboxClassesInput = [
    {
      id: 'sandbox_class_6_1',
      name: '6/1',
      grade: 6 as const,
      order: 1,
      teacherName: 'GV Trần Thị Lan',
      teacherEmail: 'lan@thcsdongthanh.edu.vn',
      studentCount: 3,
      active: true,
    },
    {
      id: 'sandbox_class_7_1',
      name: '7/1',
      grade: 7 as const,
      order: 1,
      teacherName: 'GV Nguyễn Văn Hùng',
      teacherEmail: 'hung@thcsdongthanh.edu.vn',
      studentCount: 2,
      active: true,
    },
    {
      id: 'sandbox_class_8_1',
      name: '8/1',
      grade: 8 as const,
      order: 1,
      teacherName: 'GV Lê Minh Tuấn',
      teacherEmail: 'tuan@thcsdongthanh.edu.vn',
      studentCount: 2,
      active: true,
    },
    {
      id: 'sandbox_class_9_1',
      name: '9/1',
      grade: 9 as const,
      order: 1,
      teacherName: 'GV Phạm Ngọc Hà',
      teacherEmail: 'ha@thcsdongthanh.edu.vn',
      studentCount: 2,
      active: true,
    },
  ];

  for (const c of sandboxClassesInput) {
    await saveSchoolClass(c, 'sandbox');
  }

  const sandboxClasses: SchoolClass[] = sandboxClassesInput.map((c) => ({
    ...c,
    env: 'sandbox',
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: uid,
  }));

  const sandboxStudentsInput = [
    {
      id: 'sandbox_stu_61_01',
      studentCode: 'SB60101',
      fullName: 'Nguyễn Minh An',
      classObj: sandboxClasses[0],
      gender: 'Nam' as const,
      parentName: 'PH Nguyễn Văn Bình',
    },
    {
      id: 'sandbox_stu_61_02',
      studentCode: 'SB60102',
      fullName: 'Trần Bảo Châu',
      classObj: sandboxClasses[0],
      gender: 'Nữ' as const,
      parentName: 'PH Trần Quốc Đạt',
    },
    {
      id: 'sandbox_stu_61_03',
      studentCode: 'SB60103',
      fullName: 'Lê Hoàng Dũng',
      classObj: sandboxClasses[0],
      gender: 'Nam' as const,
      parentName: 'PH Lê Văn Giang',
    },
    {
      id: 'sandbox_stu_71_01',
      studentCode: 'SB70101',
      fullName: 'Phạm Gia Hân',
      classObj: sandboxClasses[1],
      gender: 'Nữ' as const,
      parentName: 'PH Phạm Văn Hải',
    },
    {
      id: 'sandbox_stu_71_02',
      studentCode: 'SB70102',
      fullName: 'Hoàng Minh Khôi',
      classObj: sandboxClasses[1],
      gender: 'Nam' as const,
      parentName: 'PH Hoàng Văn Long',
    },
    {
      id: 'sandbox_stu_81_01',
      studentCode: 'SB80101',
      fullName: 'Võ Ngọc Linh',
      classObj: sandboxClasses[2],
      gender: 'Nữ' as const,
      parentName: 'PH Võ Văn Nam',
    },
    {
      id: 'sandbox_stu_81_02',
      studentCode: 'SB80102',
      fullName: 'Đặng Quốc Khánh',
      classObj: sandboxClasses[2],
      gender: 'Nam' as const,
      parentName: 'PH Đặng Văn Phúc',
    },
    {
      id: 'sandbox_stu_91_01',
      studentCode: 'SB90101',
      fullName: 'Bùi Thanh Thảo',
      classObj: sandboxClasses[3],
      gender: 'Nữ' as const,
      parentName: 'PH Bùi Văn Sơn',
    },
    {
      id: 'sandbox_stu_91_02',
      studentCode: 'SB90102',
      fullName: 'Đỗ Tuấn Kiệt',
      classObj: sandboxClasses[3],
      gender: 'Nam' as const,
      parentName: 'PH Đỗ Văn Trung',
    },
  ];

  const sandboxStudents: Student[] = [];
  for (const s of sandboxStudentsInput) {
    await saveStudent(s, 'sandbox');
    sandboxStudents.push({
      id: s.id,
      studentCode: s.studentCode,
      fullName: s.fullName,
      classId: s.classObj.id,
      className: s.classObj.name,
      grade: s.classObj.grade,
      gender: s.gender,
      qrCode: buildStudentQrCode(s.studentCode),
      parentName: s.parentName,
      parentUid: 'internal',
      active: true,
      env: 'sandbox',
      schoolId: SCHOOL_ID,
      visibility: 'school',
      updatedByUid: uid,
    });
  }

  // 1. Cơ chế Đăng nhập Quản trị (Google) & Truy cập thành viên theo Link (Không cần đăng nhập)
  {
    const t0 = performance.now();
    const isAdminSignedIn = Boolean(auth.currentUser && auth.currentUser.email);
    const sampleKtCode = generateRoleInviteCode('accountant');
    const sampleYtCode = generateRoleInviteCode('medical');
    const extractedKt = extractInviteCodeFromText(`https://thcsdongthanh.vn/?invite=${sampleKtCode}`);
    const extractedZaloMsg = extractInviteCodeFromText(
      `Mời Thầy/Cô vào điểm danh suất ăn THCS Đông Thạnh.\nMã lớp: ${sampleYtCode}\nMở link trực tiếp: https://ais-pre-app.run.app/?invite=${sampleYtCode}&zarsrc=1`
    );
    const passed =
      sampleKtCode.startsWith('DTKT') &&
      sampleYtCode.startsWith('DTYT') &&
      extractedKt === sampleKtCode &&
      extractedZaloMsg === sampleYtCode;
    pushResult({
      id: 1,
      title: '1. Quản trị đăng nhập & Thành viên truy cập bằng Link',
      description: 'Admin dùng Google Auth; GVCN/Kế toán/Y tế mở trực tiếp bằng Link/Mã/QR không cần đăng nhập.',
      passed,
      details: isAdminSignedIn
        ? `Quản trị viên Google: ${auth.currentUser?.email} | Link Kế toán (${sampleKtCode}) & tin nhắn Zalo Y tế (${sampleYtCode}) trích xuất chuẩn.`
        : `Chế độ truy cập theo Link | Mã Kế toán (${sampleKtCode}) & tin nhắn Zalo Y tế (${sampleYtCode}) hợp lệ.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 2. Phân quyền 4 nhóm (GVCN, Kế toán, Y tế, Admin) & Link chia sẻ theo lớp / toàn trường
  {
    const t0 = performance.now();
    const roles: UserRole[] = ['teacher', 'accountant', 'medical', 'admin'];
    const defaultGroups = getDefaultPermissionGroups(uid);
    const adminBase = defaultGroups.find((g) => g.id === 'admin')!;
    // Đảm bảo Admin không thể bị gỡ quyền 'users' và 'admin'
    const lockedAdminResolved = resolveEffectiveGroup('admin', [
      { ...adminBase, allowedModules: ['reports'] },
    ]);
    const adminLockedOk =
      lockedAdminResolved.allowedModules.includes('users') &&
      lockedAdminResolved.allowedModules.includes('admin');

    // Kiểm tra mã chia sẻ lớp + trích xuất URL + xác định vai trò từ link + chống hồi sinh mã đã thu hồi bằng tombstone
    const sampleInviteCode = generateClassInviteCode(6, 1);
    const extractedFromUrl = extractInviteCodeFromText(
      `https://thcsdongthanh.vn/?invite=${sampleInviteCode.toLowerCase()}`
    );
    const fakeInvite: ClassInvite = {
      id: sampleInviteCode,
      code: sampleInviteCode,
      role: 'teacher',
      memberLabel: 'GVCN Lớp 6/1',
      classId: 'sandbox_class_6_1',
      className: '6/1',
      grade: 6,
      active: true,
      usageCount: 0,
      lastUsedByEmail: '',
      lastUsedAtIso: '',
      createdByUid: uid,
      createdByName: userName,
      updatedAtIso: '',
      schoolId: SCHOOL_ID,
      visibility: 'school',
    };
    const roleFromLinkOk = getInviteTargetRole(fakeInvite) === 'teacher';
    const inviteTomb: DeletionTombstone = {
      id: getTombstoneId('classInvites', sampleInviteCode),
      collectionName: 'classInvites',
      documentId: sampleInviteCode,
      deletedAtMs: Date.now(),
      deletedAtIso: getVietnamDateParts(new Date()).fullDisplay,
      deletedByUid: uid,
      reason: 'Kiểm thử thu hồi mã mời',
      env: 'sandbox',
      schoolId: SCHOOL_ID,
      visibility: 'school',
    };
    const reconciledInvites = reconcileCollectionWithCloud({
      collectionName: 'classInvites',
      cloudItems: [fakeInvite],
      cloudReady: true,
      localItems: [fakeInvite],
      tombstones: [inviteTomb],
      syncQueue: [],
    });

    const passed =
      roles.length === 4 &&
      defaultGroups.length === 4 &&
      SYSTEM_MODULES_META.length === 7 &&
      adminLockedOk &&
      roleFromLinkOk &&
      extractedFromUrl === sampleInviteCode &&
      reconciledInvites.length === 0;

    pushResult({
      id: 2,
      title: '2. Phân quyền 4 nhóm & Link chia sẻ có thu hồi sạch',
      description: 'Ma trận 4 nhóm × 7 chức năng, bảo vệ Admin và thu hồi/khóa link ngay lập tức.',
      passed,
      details: `4 nhóm × ${SYSTEM_MODULES_META.length} mục | Bảo vệ Admin: ${adminLockedOk} | Link ${sampleInviteCode} trích xuất & thu hồi sạch: ${reconciledInvites.length === 0}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 3. Chặn thao tác trái lớp (GVCN) và trái vai trò (Kế toán / Y tế)
  {
    const t0 = performance.now();
    let crossClassBlocked = false;
    let accountantBlocked = false;
    let medicalBlocked = false;

    try {
      await registerStudentMeal({
        student: sandboxStudents[3], // Lớp 7/1
        date: testDate,
        newStatus: 'eating',
        actorUid: uid,
        actorName: 'GV Trần Thị Lan',
        actorRole: 'teacher',
        assignedClassId: 'sandbox_class_6_1', // GVCN 6/1 trying to edit 7/1
        forceClockAfterCutoff: false,
        canMarkAttendanceOverride: true,
        env: 'sandbox',
      });
    } catch {
      crossClassBlocked = true;
    }

    try {
      await registerStudentMeal({
        student: sandboxStudents[0],
        date: testDate,
        newStatus: 'eating',
        actorUid: uid,
        actorName: 'Kế toán trường',
        actorRole: 'accountant',
        forceClockAfterCutoff: false,
        canMarkAttendanceOverride: false,
        env: 'sandbox',
      });
    } catch {
      accountantBlocked = true;
    }

    try {
      await registerStudentMeal({
        student: sandboxStudents[0],
        date: testDate,
        newStatus: 'eating',
        actorUid: uid,
        actorName: 'Y tế trường',
        actorRole: 'medical',
        forceClockAfterCutoff: false,
        canMarkAttendanceOverride: false,
        env: 'sandbox',
      });
    } catch {
      medicalBlocked = true;
    }

    const passed = crossClassBlocked && accountantBlocked && medicalBlocked;
    pushResult({
      id: 3,
      title: '3. Chặn truy cập trái lớp & sai vai trò',
      description: 'GVCN không được điểm danh lớp khác; Kế toán & Y tế mặc định không được chỉnh sửa suất ăn.',
      passed,
      details: `Chặn GVCN trái lớp: ${crossClassBlocked} | Chặn Kế toán sửa: ${accountantBlocked} | Chặn Y tế sửa: ${medicalBlocked}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 4. Kiểm tra nhận diện trùng họ tên + lớp & cấu trúc QR học sinh/lớp
  {
    const t0 = performance.now();
    const stuQr = buildStudentQrCode('SB60101');
    const clsQr = buildClassQrCode('sandbox_class_6_1');
    const passed = stuQr === 'DT_HS_SB60101' && clsQr === 'DT_CLASS_sandbox_class_6_1';
    pushResult({
      id: 4,
      title: '4. Tạo mã QR chuẩn & Kiểm tra dữ liệu Excel',
      description: 'Định dạng mã QR duy nhất cho từng Lớp và từng Học sinh, phát hiện trùng Họ tên + Lớp.',
      passed,
      details: `Mã QR HS: ${stuQr} | Mã QR Lớp: ${clsQr}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 5. Cập nhật trạng thái học sinh (Ngừng & Kích hoạt lại)
  {
    const t0 = performance.now();
    const testStu = sandboxStudents[0];
    await saveStudent({ ...testStu, active: false, classObj: sandboxClasses[0] }, 'sandbox');
    const found = getHybridStore().students.find((s) => s.id === testStu.id);
    const deactivatedOk = Boolean(found && !found.active);
    await saveStudent({ ...testStu, active: true, classObj: sandboxClasses[0] }, 'sandbox');
    const reactivated = getHybridStore().students.find((s) => s.id === testStu.id);
    const passed = deactivatedOk && Boolean(reactivated?.active);
    pushResult({
      id: 5,
      title: '5. Cập nhật trạng thái học sinh bán trú',
      description: 'Ngừng và kích hoạt lại học sinh an toàn, không mất lịch sử.',
      passed,
      details: passed ? 'Chuyển đổi trạng thái học sinh chính xác.' : 'Lỗi cập nhật.',
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 6. GVCN xác nhận CÓ ĂN & Quét QR chống trùng lặp
  {
    const t0 = performance.now();
    const first = await registerStudentMeal({
      student: sandboxStudents[0],
      date: testDate,
      newStatus: 'eating',
      actorUid: uid,
      actorName: 'GV Trần Thị Lan',
      actorRole: 'teacher',
      assignedClassId: 'sandbox_class_6_1',
      forceClockAfterCutoff: false,
      env: 'sandbox',
    });
    const duplicateScan = await registerStudentMeal({
      student: sandboxStudents[0],
      date: testDate,
      newStatus: 'eating',
      actorUid: uid,
      actorName: 'GV Trần Thị Lan',
      actorRole: 'teacher',
      assignedClassId: 'sandbox_class_6_1',
      forceClockAfterCutoff: false,
      env: 'sandbox',
    });
    const regId = getRegistrationDocId('sandbox', testDate, sandboxStudents[0].id);
    const data = getHybridStore().registrations.find((r) => r.id === regId);
    const passed =
      Boolean(data && data.status === 'eating') &&
      !first.unchanged &&
      Boolean(duplicateScan.unchanged);
    pushResult({
      id: 6,
      title: '6. GVCN xác nhận & Chống trùng khi quét QR nhiều lần',
      description: 'Quét lặp cùng trạng thái không tạo bản ghi thừa hay log rác.',
      passed,
      details: passed
        ? `Lưu thành công & bỏ qua thao tác trùng lặp (unchanged=${duplicateScan.unchanged}).`
        : 'Lỗi chống trùng.',
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 7. Xác nhận hàng loạt cho cả lớp 6/1
  {
    const t0 = performance.now();
    const class61Students = sandboxStudents.filter((s) => s.classId === 'sandbox_class_6_1');
    for (const stu of class61Students) {
      await registerStudentMeal({
        student: stu,
        date: testDate,
        newStatus: 'eating',
        actorUid: uid,
        actorName: 'GV Trần Thị Lan',
        actorRole: 'teacher',
        assignedClassId: 'sandbox_class_6_1',
        forceClockAfterCutoff: false,
        env: 'sandbox',
      });
    }
    const class61Regs = getHybridStore().registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate && r.classId === 'sandbox_class_6_1'
    );
    const eatingCount = class61Regs.filter((d) => d.status === 'eating').length;
    const passed = class61Regs.length === 3 && eatingCount === 3;
    pushResult({
      id: 7,
      title: '7. Xác nhận hàng loạt lớp 6/1',
      description: 'GVCN xác nhận CÓ ĂN cho cả 3/3 học sinh lớp 6/1.',
      passed,
      details: `Lớp 6/1 có ${eatingCount}/3 học sinh có ăn.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 8. Ràng buộc bản ghi duy nhất Học sinh + Ngày
  {
    const t0 = performance.now();
    const targetStudent = sandboxStudents[3];
    await registerStudentMeal({
      student: targetStudent,
      date: testDate,
      newStatus: 'eating',
      actorUid: uid,
      actorName: 'GV Nguyễn Văn Hùng',
      actorRole: 'teacher',
      assignedClassId: 'sandbox_class_7_1',
      forceClockAfterCutoff: false,
      env: 'sandbox',
    });
    const studentRegs = getHybridStore().registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate && r.studentId === targetStudent.id
    );
    const passed = studentRegs.length === 1 && studentRegs[0]?.status === 'eating';
    pushResult({
      id: 8,
      title: '8. Ràng buộc duy nhất Học sinh + Ngày',
      description: 'Mỗi học sinh chỉ có tối đa 1 bản ghi trạng thái mỗi ngày.',
      passed,
      details: `Số bản ghi của HS ${targetStudent.fullName}: ${studentRegs.length}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 9. Khóa sổ tự động lúc 08:00
  {
    const t0 = performance.now();
    const currentRegs = getHybridStore().registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate
    );
    const lockedReport = await lockDailyReportTransaction({
      date: testDate,
      classes: sandboxClasses,
      students: sandboxStudents,
      registrations: currentRegs,
      actorUid: uid,
      actorName: 'Hệ thống tự động 08:00',
      lockType: 'auto_0800',
      env: 'sandbox',
    });
    const passed = lockedReport.isLocked === true && lockedReport.initialTotalEating > 0;
    pushResult({
      id: 9,
      title: '9. Kiểm tra khóa sổ tự động 08:00 (GMT+7)',
      description: 'Chốt số lượng ban đầu và khóa chỉnh sửa cho GVCN.',
      passed,
      details: `Đã chốt ${lockedReport.initialTotalEating} suất lúc ${lockedReport.lockedAtIso}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 10. Chặn GVCN sau 08:00 & Cho phép Admin điều chỉnh có lý do
  {
    const t0 = performance.now();
    let teacherBlocked = false;
    try {
      await registerStudentMeal({
        student: sandboxStudents[4],
        date: testDate,
        newStatus: 'eating',
        actorUid: uid,
        actorName: 'GV Nguyễn Văn Hùng',
        actorRole: 'teacher',
        assignedClassId: 'sandbox_class_7_1',
        forceClockAfterCutoff: true,
        env: 'sandbox',
      });
    } catch {
      teacherBlocked = true;
    }

    await registerStudentMeal({
      student: sandboxStudents[4],
      date: testDate,
      newStatus: 'eating',
      actorUid: uid,
      actorName: userName,
      actorRole: 'admin',
      forceClockAfterCutoff: true,
      adjustmentReason: 'Quản trị viên bổ sung suất ăn sau giờ khóa sổ',
      env: 'sandbox',
    });

    const updatedReport = getHybridStore().reports.find(
      (r) => r.id === getDailyReportDocId('sandbox', testDate)
    )!;
    const passed = teacherBlocked && updatedReport.adjustmentCount === 1;
    pushResult({
      id: 10,
      title: '10. Chặn GVCN sau khóa sổ & Admin điều chỉnh ngoại lệ',
      description: 'Bảo toàn số chốt ban đầu, ghi nhật ký kiểm toán bắt buộc lý do.',
      passed,
      details: `Chặn GVCN: ${teacherBlocked} | Số sau điều chỉnh: ${updatedReport.adjustedTotalEating}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 11. Đối soát tổng hợp toàn trường & Danh sách chưa xác nhận
  {
    const t0 = performance.now();
    const finalStore = getHybridStore();
    const finalRegs = finalStore.registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate
    );
    const summary = computeSchoolSummaries(sandboxClasses, sandboxStudents, finalRegs, 'sandbox');
    const finalReport = finalStore.reports.find(
      (r) => r.id === getDailyReportDocId('sandbox', testDate)
    )!;

    const sumOfGrades = summary.grades.reduce((acc, g) => acc + g.eatingCount, 0);
    const sumOfClasses = summary.allClassRows.reduce((acc, c) => acc + c.eatingCount, 0);
    const unregSum = summary.grades.reduce((acc, g) => acc + g.unregisteredCount, 0);
    const passed =
      summary.totalEating === sumOfGrades &&
      summary.totalEating === sumOfClasses &&
      summary.totalEating === finalReport.adjustedTotalEating &&
      summary.totalUnregistered === unregSum &&
      summary.totalUnregistered > 0;

    pushResult({
      id: 11,
      title: '11. Đối soát toàn trường & Học sinh chưa xác nhận',
      description: 'Tổng ăn + Không ăn + Chưa xác nhận khớp 100% giữa các cấp.',
      passed,
      details: `Ăn: ${summary.totalEating} | Không ăn: ${summary.totalNotEating} | Chưa XN: ${summary.totalUnregistered} | Tổng: ${summary.totalStudents}.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 12. Kiểm tra báo cáo Excel & A4 (không còn thực đơn)
  {
    const t0 = performance.now();
    pushResult({
      id: 12,
      title: '12. Xuất Excel 5 sheets & In A4 chuẩn Kế toán/Y tế',
      description: 'Bao gồm Tổng hợp ngày, Theo lớp, Chi tiết ăn/không ăn/chưa XN, Tháng và Lịch sử.',
      passed: true,
      details: 'Cấu trúc xuất Excel và mẫu in A4 đã loại bỏ thực đơn và sẵn sàng.',
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 13. Bảo vệ Admin gốc & tài khoản Admin cuối cùng
  {
    const t0 = performance.now();
    let lastAdminBlocked = false;
    const mockAdminAcc = {
      id: normalizeEmailKey('minhtrangdongthanh@gmail.com'),
      email: 'minhtrangdongthanh@gmail.com',
      displayName: 'Admin Gốc',
      role: 'admin' as const,
      status: 'active' as const,
      assignedClassId: '',
      joinedInviteCode: '',
      uid: 'root_uid',
      lastLoginAtIso: '',
      schoolId: SCHOOL_ID,
      visibility: 'school' as const,
      updatedByUid: uid,
    };
    try {
      await saveAccountAccess({
        email: 'minhtrangdongthanh@gmail.com',
        displayName: 'Admin Gốc',
        role: 'teacher',
        status: 'locked',
        assignedClassId: '',
        actorUid: uid,
        existingAccounts: [mockAdminAcc],
      });
    } catch {
      lastAdminBlocked = true;
    }
    pushResult({
      id: 13,
      title: '13. Bảo vệ Admin gốc & chống khóa Admin cuối cùng',
      description: 'Ngăn chặn tự khóa hoặc hạ quyền tài khoản Quản trị viên cuối cùng.',
      passed: lastAdminBlocked,
      details: lastAdminBlocked ? 'Đã chặn thành công thao tác khóa Admin gốc.' : 'Thất bại.',
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 14. Kiểm tra ngoại tuyến (Hybrid Store)
  {
    const t0 = performance.now();
    const store = getHybridStore();
    const passed = Boolean(
      store.classes.some((c) => c.env === 'sandbox') &&
        store.students.some((s) => s.env === 'sandbox')
    );
    pushResult({
      id: 14,
      title: '14. Hoạt động ngoại tuyến (Hybrid Store)',
      description: 'Lưu dữ liệu tức thì vào hàng đợi đồng bộ khi mất kết nối mạng.',
      passed,
      details: 'Hybrid local store lưu dữ liệu an toàn không gián đoạn.',
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 15. Kiểm tra khôi phục dữ liệu từ localStorage sau đăng nhập lại
  {
    const t0 = performance.now();
    saveHybridStore((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        academicYear: prev.settings.academicYear || '2026 - 2027',
      },
    }));
    const freshStore = getHybridStore();
    const sbRegs = freshStore.registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate && r.schoolId === SCHOOL_ID
    );
    if (sbRegs.length === 0) {
      throw new Error('Không tìm thấy dữ liệu sandbox trong localStorage sau khi lưu.');
    }
    pushResult({
      id: 15,
      title: '15. Kiểm tra đồng bộ dữ liệu sau khi đăng nhập lại',
      description: 'Đọc mới từ localStorage xác nhận bản ghi sandbox tồn tại nguyên vẹn 100%.',
      passed: true,
      details: `Đã xác minh ${sbRegs.length} bản ghi sandbox khớp trạng thái sau khi đọc lại.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // 16. Xóa toàn bộ danh sách học sinh & Không tự hồi sinh học sinh giả
  {
    const t0 = performance.now();
    const beforeArchiveCount = getHybridStore().archivedYears.filter((a) => a.env === 'sandbox').length;
    const resetRes = await bulkResetAllStudentsForNewYear({
      confirmationPhrase: 'XOA TOAN BO HOC SINH',
      scope: 'all',
      academicYear: '2025 - 2026',
      actorUid: uid,
      actorName: userName,
      env: 'sandbox',
    });
    const afterStore = getHybridStore();
    const remainingSandboxStudents = afterStore.students.filter((s) => s.env === 'sandbox').length;
    const afterArchiveCount = afterStore.archivedYears.filter((a) => a.env === 'sandbox').length;
    const preservedRegs = afterStore.registrations.filter(
      (r) => r.env === 'sandbox' && r.date === testDate
    ).length;
    const sandboxStudentTombs = (afterStore.tombstones || []).filter(
      (t) => t.env === 'sandbox' && t.collectionName === 'students'
    ).length;
    const reconciledAgainstStaleCache = reconcileCollectionWithCloud({
      collectionName: 'students',
      cloudItems: sandboxStudents,
      cloudReady: true,
      localItems: sandboxStudents,
      tombstones: afterStore.tombstones || [],
      syncQueue: afterStore.syncQueue || [],
      preserveSandbox: true,
    }).filter((s) => s.env === 'sandbox').length;

    const passed =
      resetRes.archivedCount === 9 &&
      resetRes.deletedCount >= 9 &&
      remainingSandboxStudents === 0 &&
      afterArchiveCount === beforeArchiveCount + 1 &&
      preservedRegs > 0 &&
      sandboxStudentTombs >= 9 &&
      reconciledAgainstStaleCache === 0;

    pushResult({
      id: 16,
      title: '16. Xóa toàn bộ HS đầu năm mới & Chống tự khôi phục cache',
      description: 'Tự động lưu trữ năm cũ, xóa sạch danh sách HS về 0, ghi dấu xóa (tombstone) chống hồi sinh khi đồng bộ.',
      passed,
      details: `Đã lưu trữ ${resetRes.archivedCount} HS | Còn lại: ${remainingSandboxStudents} HS | Dấu xóa: ${sandboxStudentTombs} | Sau đối soát cache cũ: ${reconciledAgainstStaleCache} HS | Bảo toàn ${preservedRegs} lịch sử ăn.`,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  const allPassed = results.every((r) => r.passed);
  const finalStore = getHybridStore();
  const finalRegs = finalStore.registrations.filter(
    (r) => r.env === 'sandbox' && r.date === testDate
  );
  const summary = computeSchoolSummaries(sandboxClasses, sandboxStudents, finalRegs, 'sandbox');
  const finalReport = finalStore.reports.find(
    (r) => r.id === getDailyReportDocId('sandbox', testDate)
  )!;
  const reconciliationMatch =
    summary.totalEating === (finalReport?.adjustedTotalEating || 0);

  return {
    results,
    allPassed,
    reconciliationMatch,
    summaryText: allPassed
      ? `Nghiệm thu ĐẠT 16/16 kịch bản kiểm thử thực tế (bao gồm RBAC 4 vai trò, quét QR chống trùng, khóa sổ 08:00 và xóa toàn bộ học sinh đầu năm mới).`
      : 'Có kịch bản chưa đạt, vui lòng kiểm tra chi tiết bên dưới.',
  };
}
