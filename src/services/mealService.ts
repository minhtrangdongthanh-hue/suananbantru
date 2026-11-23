import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  setFirestoreNetworkEnabled,
} from '../firebase';
import {
  AccountAccess,
  AccountStatus,
  AppEnvironment,
  ArchivedYearSnapshot,
  BOOTSTRAPPED_ADMIN_EMAIL,
  buildStudentQrCode,
  BULK_DELETE_CONFIRM_PHRASE,
  ClassInvite,
  ClassSummaryRow,
  DailyReport,
  DEFAULT_CUTOFF_TIME,
  DeletionTombstone,
  extractInviteCodeFromText,
  formatVietnameseDate,
  generateClassInviteCode,
  generateRoleInviteCode,
  getDefaultPermissionGroups,
  getInviteDisplayLabel,
  getInviteTargetRole,
  getRoleLabel,
  getVietnamDateParts,
  GradeLevel,
  GradeSummary,
  isDateLockedByClock,
  MealBillingConfig,
  MealPayment,
  MealPaymentLog,
  MealPricingLog,
  MealPricingRule,
  MealRegistration,
  MonthlySettlement,
  normalizeEmailKey,
  normalizeInviteCode,
  PaymentMethod,
  PermissionGroup,
  RegistrationLog,
  RegistrationStatus,
  resolveEffectiveGroup,
  sanitizeId,
  sanitizeString,
  SCHOOL_ID,
  SchoolClass,
  SchoolSetting,
  Student,
  StudentGender,
  TombstoneCollection,
  UserProfile,
  UserRole,
} from '../types';
import {
  applyTombstonesToStore,
  buildTombstoneSet,
  canWriteToCloudFirestore,
  clearTombstonesInStore,
  filterOutTombstoned,
  flushSyncQueueToFirestore,
  generateDefault61Classes,
  getHybridStore,
  getTombstoneId,
  isQuotaOrTimeoutError,
  isTrueQuotaError,
  markQuotaExceeded,
  mergeTombstones,
  queueSyncOperation,
  reconcileCollectionWithCloud,
  saveHybridStore,
  withFastFirestoreTimeout,
} from './localStoreFallback';
import {
  computeMonthlyBillingReport,
  getDefaultMealBillingConfig,
} from './monthlyMealEngine';

function createTombstoneRecord(params: {
  collectionName: TombstoneCollection;
  documentId: string;
  deletedByUid: string;
  reason: string;
  env: AppEnvironment;
}): DeletionTombstone {
  const vnNow = getVietnamDateParts(new Date());
  return {
    id: getTombstoneId(params.collectionName, params.documentId),
    collectionName: params.collectionName,
    documentId: params.documentId,
    deletedAtMs: Date.now(),
    deletedAtIso: vnNow.fullDisplay,
    deletedByUid: sanitizeString(params.deletedByUid || 'system', 128, 'system'),
    reason: sanitizeString(params.reason, 500, 'Đã xác nhận xóa'),
    env: params.env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };
}

async function clearCloudTombstoneIfPresent(
  collectionName: TombstoneCollection,
  documentId: string,
  env: AppEnvironment
): Promise<void> {
  if (env === 'sandbox') return;
  if (!auth.currentUser) return;
  const tombId = getTombstoneId(collectionName, documentId);
  const store = getHybridStore();
  const hasLocalTomb = (store.tombstones || []).some((t) => t.id === tombId);
  if (!hasLocalTomb) {
    // Only issue a deleteDoc if a tombstone actually exists locally to clear
    return;
  }
  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'delete',
      collectionName: 'deletionTombstones',
      documentId: tombId,
    });
    return;
  }
  try {
    await withFastFirestoreTimeout(async () => {
      await deleteDoc(doc(db, 'deletionTombstones', tombId));
    }, 5000);
  } catch (err) {
    if (isTrueQuotaError(err)) {
      markQuotaExceeded(true);
    }
    if (isQuotaOrTimeoutError(err)) {
      queueSyncOperation({
        action: 'delete',
        collectionName: 'deletionTombstones',
        documentId: tombId,
      });
    }
    // Ignore not-found if tombstone never existed on Cloud
  }
}

export function getMonthlySettlementDocId(env: AppEnvironment, month: string): string {
  return sanitizeId(`${env}_${month}`);
}

export function getBillingConfigDocId(env: AppEnvironment): string {
  return sanitizeId(`${env}_billing_config`);
}

export function getRegistrationDocId(env: AppEnvironment, date: string, studentId: string): string {
  return sanitizeId(`${env}_${date}_${studentId}`);
}

export function getDailyReportDocId(env: AppEnvironment, date: string): string {
  return sanitizeId(`${env}_${date}`);
}

export async function initializeStandard61Classes(
  env: AppEnvironment = 'production'
): Promise<number> {
  const uid = auth.currentUser?.uid || 'system';
  const classesData = generateDefault61Classes(env, uid);

  saveHybridStore((prev) => {
    const otherEnv = prev.classes.filter((c) => c.env !== env);
    return {
      ...prev,
      classes: [...otherEnv, ...classesData],
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      for (const cls of classesData) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'classes',
          documentId: cls.id,
          payload: cls,
        });
      }
    }
    return classesData.length;
  }

  try {
    const batch = writeBatch(db);
    for (const cls of classesData) {
      const ref = doc(db, 'classes', cls.id);
      batch.set(ref, {
        ...cls,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await withFastFirestoreTimeout(() => batch.commit(), 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      return classesData.length;
    }
    handleFirestoreError(error, OperationType.WRITE, 'classes');
  }

  return classesData.length;
}

export async function saveSchoolClass(
  classInput: {
    id?: string;
    name: string;
    grade: GradeLevel;
    order: number;
    teacherName: string;
    teacherEmail: string;
    studentCount: number;
    active: boolean;
  },
  env: AppEnvironment = 'production'
): Promise<void> {
  const uid = auth.currentUser?.uid || 'system';
  const id = classInput.id
    ? sanitizeId(classInput.id)
    : sanitizeId(`${env}_class_${classInput.grade}_${classInput.order}`);

  const payload: SchoolClass = {
    id,
    name: sanitizeString(classInput.name, 32, `${classInput.grade}/${classInput.order}`),
    grade: classInput.grade,
    order: Math.max(1, Math.min(100, Number(classInput.order) || 1)),
    teacherName: sanitizeString(classInput.teacherName, 120, 'Chưa phân công'),
    teacherEmail: sanitizeString(classInput.teacherEmail, 256, ''),
    studentCount: Math.max(0, Math.min(100, Number(classInput.studentCount) || 0)),
    active: Boolean(classInput.active),
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: uid,
  };

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'classes', [id]);
    const filtered = cleared.classes.filter((c) => c.id !== id);
    return {
      ...cleared,
      classes: [...filtered, payload],
    };
  });

  await clearCloudTombstoneIfPresent('classes', id, env);

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'classes',
        documentId: id,
        payload,
      });
    }
    return;
  }

  const ref = doc(db, 'classes', id);
  try {
    await withFastFirestoreTimeout(async () => {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          name: payload.name,
          grade: payload.grade,
          order: payload.order,
          teacherName: payload.teacherName,
          teacherEmail: payload.teacherEmail,
          studentCount: payload.studentCount,
          active: payload.active,
          updatedByUid: uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'classes',
        documentId: id,
        payload,
      });
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `classes/${id}`);
  }
}

export async function saveStudent(
  studentInput: {
    id?: string;
    studentCode: string;
    fullName: string;
    classObj?: SchoolClass;
    classId?: string;
    className?: string;
    grade?: GradeLevel;
    gender?: StudentGender;
    qrCode?: string;
    parentName?: string;
    parentUid?: string;
    active?: boolean;
    updatedByUid?: string;
  },
  env: AppEnvironment = 'production'
): Promise<string> {
  const uid = studentInput.updatedByUid || auth.currentUser?.uid || 'system';
  const code = sanitizeString(studentInput.studentCode.toUpperCase(), 32, `HS${Date.now()}`);
  const id = studentInput.id ? sanitizeId(studentInput.id) : sanitizeId(`${env}_stu_${code}`);

  const store = getHybridStore();
  const targetClassId = studentInput.classObj?.id || studentInput.classId || 'production_class_6_1';
  const foundClass = store.classes.find((c) => c.id === targetClassId) ||
    studentInput.classObj || {
      id: targetClassId,
      name: studentInput.className || '6/1',
      grade: (studentInput.grade || 6) as GradeLevel,
      order: 1,
      teacherName: 'GVCN',
      teacherEmail: '',
      studentCount: 1,
      active: true,
      env,
      schoolId: SCHOOL_ID,
      visibility: 'school' as const,
      updatedByUid: uid,
    };

  const payload: Student = {
    id,
    studentCode: code,
    fullName: sanitizeString(studentInput.fullName, 120, 'Học sinh'),
    classId: foundClass.id,
    className: foundClass.name,
    grade: foundClass.grade,
    gender: studentInput.gender || '',
    qrCode: sanitizeString(studentInput.qrCode || buildStudentQrCode(code), 128),
    parentName: sanitizeString(studentInput.parentName || '', 120, ''),
    parentUid: sanitizeString(studentInput.parentUid || 'internal', 128, 'internal'),
    active: studentInput.active !== undefined ? studentInput.active : true,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: uid,
  };

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'students', [id]);
    const filtered = cleared.students.filter((s) => s.id !== id);
    return {
      ...cleared,
      students: [...filtered, payload],
    };
  });

  await clearCloudTombstoneIfPresent('students', id, env);

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'students',
        documentId: id,
        payload,
      });
    }
    return id;
  }

  const ref = doc(db, 'students', id);
  try {
    await withFastFirestoreTimeout(async () => {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          studentCode: payload.studentCode,
          fullName: payload.fullName,
          classId: payload.classId,
          className: payload.className,
          grade: payload.grade,
          gender: payload.gender,
          qrCode: payload.qrCode,
          parentName: payload.parentName,
          parentUid: payload.parentUid,
          active: payload.active,
          updatedByUid: uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'students',
        documentId: id,
        payload,
      });
      return id;
    }
    handleFirestoreError(error, OperationType.WRITE, `students/${id}`);
  }

  return id;
}

export async function deleteSingleStudent(params: {
  student: Student;
  actorUid: string;
  actorName: string;
  actorRole?: UserRole;
  env?: AppEnvironment;
}): Promise<void> {
  const env = params.env || params.student.env || 'production';
  const studentId = params.student.id;
  const vnNow = getVietnamDateParts(new Date());
  const storeSnapshot = getHybridStore();

  // Identify unlocked active meal registrations belonging to the deleted student so active day reports stay clean
  const lockedReportDates = new Set(
    storeSnapshot.reports.filter((r) => r.env === env && r.isLocked).map((r) => r.date)
  );
  const unlockedStudentRegIds = storeSnapshot.registrations
    .filter(
      (r) =>
        r.env === env &&
        r.studentId === studentId &&
        !lockedReportDates.has(r.date)
    )
    .map((r) => r.id);

  const studentTombstone = createTombstoneRecord({
    collectionName: 'students',
    documentId: studentId,
    deletedByUid: params.actorUid,
    reason: `Xóa học sinh ${params.student.fullName} (${params.student.studentCode})`,
    env,
  });

  const regTombstones: DeletionTombstone[] = unlockedStudentRegIds.map((regId) =>
    createTombstoneRecord({
      collectionName: 'registrations',
      documentId: regId,
      deletedByUid: params.actorUid,
      reason: `Xóa đăng ký suất ăn chưa khóa của học sinh đã xóa (${params.student.studentCode})`,
      env,
    })
  );

  const allNewTombstones = [studentTombstone, ...regTombstones];
  const unlockedRegIdSet = new Set(unlockedStudentRegIds);

  const logPayload: RegistrationLog = {
    id: sanitizeId(`${env}_log_del_${studentId}_${Date.now()}`),
    registrationId: studentId,
    date: vnNow.dateStr,
    studentId,
    studentName: params.student.fullName,
    classId: params.student.classId,
    className: params.student.className,
    grade: params.student.grade,
    previousStatus: 'unregistered',
    newStatus: 'unregistered',
    actorUid: params.actorUid,
    actorName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    actorRole: params.actorRole || 'admin',
    timestampIso: vnNow.fullDisplay,
    isAfterCutoff: false,
    reason: `Xóa học sinh ${params.student.fullName} (${params.student.studentCode}) khỏi danh sách đang hoạt động`,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const withTombstones = applyTombstonesToStore(prev, allNewTombstones);
    return {
      ...withTombstones,
      students: withTombstones.students.filter((s) => s.id !== studentId),
      registrations: withTombstones.registrations.filter((r) => !unlockedRegIdSet.has(r.id)),
      logs: [logPayload, ...withTombstones.logs],
      syncQueue: withTombstones.syncQueue.filter(
        (q) =>
          !(q.collectionName === 'students' && q.documentId === studentId) &&
          !(q.collectionName === 'registrations' && unlockedRegIdSet.has(q.documentId))
      ),
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      for (const tomb of allNewTombstones) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'deletionTombstones',
          documentId: tomb.id,
          payload: tomb,
        });
      }
      queueSyncOperation({
        action: 'delete',
        collectionName: 'students',
        documentId: studentId,
      });
      for (const regId of unlockedStudentRegIds) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'registrations',
          documentId: regId,
        });
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      // Also inspect Firestore for any unlocked registrations for this student that may not be cached locally
      const cloudRegsSnap = await getDocs(
        query(
          collection(db, 'registrations'),
          where('schoolId', '==', SCHOOL_ID),
          where('studentId', '==', studentId)
        )
      );
      const cloudUnlockedRegIds = cloudRegsSnap.docs
        .filter((d) => {
          const data = d.data() as MealRegistration;
          return data.env === env && !lockedReportDates.has(data.date);
        })
        .map((d) => d.id);

      const allUnlockedRegIds = Array.from(
        new Set([...unlockedStudentRegIds, ...cloudUnlockedRegIds])
      );
      const extraRegTombs = allUnlockedRegIds
        .filter((id) => !unlockedRegIdSet.has(id))
        .map((regId) =>
          createTombstoneRecord({
            collectionName: 'registrations',
            documentId: regId,
            deletedByUid: params.actorUid,
            reason: `Xóa đăng ký suất ăn chưa khóa của học sinh đã xóa (${params.student.studentCode})`,
            env,
          })
        );
      if (extraRegTombs.length > 0) {
        saveHybridStore((prev) => applyTombstonesToStore(prev, extraRegTombs));
      }

      const batch = writeBatch(db);
      for (const tomb of [...allNewTombstones, ...extraRegTombs]) {
        batch.set(
          doc(db, 'deletionTombstones', tomb.id),
          {
            ...tomb,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      batch.delete(doc(db, 'students', studentId));
      for (const regId of allUnlockedRegIds) {
        batch.delete(doc(db, 'registrations', regId));
      }
      batch.set(doc(db, 'registrationLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      for (const tomb of allNewTombstones) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'deletionTombstones',
          documentId: tomb.id,
          payload: tomb,
        });
      }
      queueSyncOperation({
        action: 'delete',
        collectionName: 'students',
        documentId: studentId,
      });
      for (const regId of unlockedStudentRegIds) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'registrations',
          documentId: regId,
        });
      }
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `students/${studentId}`);
  }
}

export async function deleteMultipleStudents(params: {
  studentsToDelete: Student[];
  actorUid: string;
  actorName: string;
  actorRole?: UserRole;
  env?: AppEnvironment;
}): Promise<number> {
  const env = params.env || 'production';
  const idsToDelete = new Set(params.studentsToDelete.map((s) => s.id));
  if (idsToDelete.size === 0) return 0;

  const vnNow = getVietnamDateParts(new Date());
  const storeSnapshot = getHybridStore();
  const lockedReportDates = new Set(
    storeSnapshot.reports.filter((r) => r.env === env && r.isLocked).map((r) => r.date)
  );
  const unlockedRegIds = storeSnapshot.registrations
    .filter(
      (r) => r.env === env && idsToDelete.has(r.studentId) && !lockedReportDates.has(r.date)
    )
    .map((r) => r.id);
  const unlockedRegIdSet = new Set(unlockedRegIds);

  const studentTombstones: DeletionTombstone[] = params.studentsToDelete.map((s) =>
    createTombstoneRecord({
      collectionName: 'students',
      documentId: s.id,
      deletedByUid: params.actorUid,
      reason: `Xóa hàng loạt học sinh ${s.fullName} (${s.studentCode})`,
      env,
    })
  );
  const regTombstones: DeletionTombstone[] = unlockedRegIds.map((regId) =>
    createTombstoneRecord({
      collectionName: 'registrations',
      documentId: regId,
      deletedByUid: params.actorUid,
      reason: 'Xóa đăng ký chưa khóa theo học sinh đã xóa hàng loạt',
      env,
    })
  );
  const allNewTombstones = [...studentTombstones, ...regTombstones];

  const logPayload: RegistrationLog = {
    id: sanitizeId(`${env}_log_bulkdel_${Date.now()}`),
    registrationId: 'bulk_delete',
    date: vnNow.dateStr,
    studentId: 'bulk',
    studentName: `${idsToDelete.size} học sinh`,
    classId: 'all',
    className: 'Nhiều lớp',
    grade: 6,
    previousStatus: 'unregistered',
    newStatus: 'unregistered',
    actorUid: params.actorUid,
    actorName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    actorRole: params.actorRole || 'admin',
    timestampIso: vnNow.fullDisplay,
    isAfterCutoff: false,
    reason: `Xóa ${idsToDelete.size} học sinh được chọn khỏi danh sách đang hoạt động`,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const withTombstones = applyTombstonesToStore(prev, allNewTombstones);
    return {
      ...withTombstones,
      students: withTombstones.students.filter((s) => !idsToDelete.has(s.id)),
      registrations: withTombstones.registrations.filter((r) => !unlockedRegIdSet.has(r.id)),
      logs: [logPayload, ...withTombstones.logs],
      syncQueue: withTombstones.syncQueue.filter(
        (q) =>
          !(q.collectionName === 'students' && idsToDelete.has(q.documentId)) &&
          !(q.collectionName === 'registrations' && unlockedRegIdSet.has(q.documentId))
      ),
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      for (const tomb of allNewTombstones) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'deletionTombstones',
          documentId: tomb.id,
          payload: tomb,
        });
      }
      for (const s of params.studentsToDelete) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'students',
          documentId: s.id,
        });
      }
      for (const regId of unlockedRegIds) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'registrations',
          documentId: regId,
        });
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return idsToDelete.size;
  }

  try {
    type BatchOp = () => void;
    let batch = writeBatch(db);
    let ops = 0;
    const flushBatch = async (force = false) => {
      if (ops >= 350 || (force && ops > 0)) {
        await withFastFirestoreTimeout(() => batch.commit(), 8000);
        batch = writeBatch(db);
        ops = 0;
      }
    };
    const enqueueOp = async (fn: BatchOp) => {
      fn();
      ops++;
      await flushBatch();
    };

    for (const tomb of allNewTombstones) {
      await enqueueOp(() =>
        batch.set(
          doc(db, 'deletionTombstones', tomb.id),
          {
            ...tomb,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );
    }
    for (const sId of Array.from(idsToDelete)) {
      await enqueueOp(() => batch.delete(doc(db, 'students', sId)));
    }
    for (const regId of unlockedRegIds) {
      await enqueueOp(() => batch.delete(doc(db, 'registrations', regId)));
    }
    await enqueueOp(() =>
      batch.set(doc(db, 'registrationLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      })
    );
    await flushBatch(true);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      for (const tomb of allNewTombstones) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'deletionTombstones',
          documentId: tomb.id,
          payload: tomb,
        });
      }
      for (const s of params.studentsToDelete) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'students',
          documentId: s.id,
        });
      }
      for (const regId of unlockedRegIds) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'registrations',
          documentId: regId,
        });
      }
      return idsToDelete.size;
    }
    handleFirestoreError(error, OperationType.DELETE, 'students');
  }

  return idsToDelete.size;
}

/**
 * Bulk Reset All Students for New School Year (Section 5)
 * - Strictly requires exact confirmation phrase: XOA TOAN BO HOC SINH
 * - Auto-archives current student list into /archivedYears before deleting
 * - Deletes active students in selected scope (all or specific grade)
 * - Bumps studentListVersion in /settings so all devices clear cache & never restore deleted students
 * - NEVER deletes users, permissions, settings, past meal registrations, dailyReports, or audit logs!
 */
export async function bulkResetAllStudentsForNewYear(params: {
  confirmationPhrase: string;
  scope: 'all' | GradeLevel;
  academicYear: string;
  actorUid: string;
  actorName: string;
  env?: AppEnvironment;
}): Promise<{ archivedCount: number; deletedCount: number; archiveId: string }> {
  if (params.confirmationPhrase.trim() !== BULK_DELETE_CONFIRM_PHRASE) {
    throw new Error(
      `Cụm từ xác nhận không chính xác. Vui lòng nhập đúng: ${BULK_DELETE_CONFIRM_PHRASE}`
    );
  }

  const env = params.env || 'production';
  const vnNow = getVietnamDateParts(new Date());
  const store = getHybridStore();

  const targetStudents = store.students.filter(
    (s) => s.env === env && (params.scope === 'all' ? true : s.grade === params.scope)
  );
  const targetIds = new Set(targetStudents.map((s) => s.id));

  const archiveId = sanitizeId(`${env}_archive_${Date.now()}`);
  const scopeLabel = params.scope === 'all' ? 'Toàn trường (4 Khối)' : `Khối ${params.scope}`;

  const archiveSnapshot: ArchivedYearSnapshot = {
    id: archiveId,
    academicYear: sanitizeString(params.academicYear, 32, '2026 - 2027'),
    archivedAtIso: vnNow.fullDisplay,
    archivedByUid: params.actorUid,
    archivedByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    scope: scopeLabel,
    studentCount: targetStudents.length,
    students: targetStudents,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const logPayload: RegistrationLog = {
    id: sanitizeId(`${env}_log_reset_${Date.now()}`),
    registrationId: archiveId,
    date: vnNow.dateStr,
    studentId: 'bulk_reset',
    studentName: `${targetStudents.length} học sinh (${scopeLabel})`,
    classId: 'all',
    className: scopeLabel,
    grade: params.scope === 'all' ? 6 : params.scope,
    previousStatus: 'unregistered',
    newStatus: 'unregistered',
    actorUid: params.actorUid,
    actorName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    actorRole: 'admin',
    timestampIso: vnNow.fullDisplay,
    isAfterCutoff: false,
    reason: `XÓA TOÀN BỘ DANH SÁCH HỌC SINH (${scopeLabel}) để cập nhật năm học mới. Đã tự động sao lưu ${targetStudents.length} HS vào lưu trữ ${archiveId}.`,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const nextVersion = (store.settings?.studentListVersion || 1) + 1;
  const resetTombstones: DeletionTombstone[] = Array.from(targetIds).map((sId) =>
    createTombstoneRecord({
      collectionName: 'students',
      documentId: sId,
      deletedByUid: params.actorUid,
      reason: `Xóa toàn bộ học sinh (${scopeLabel}) chuyển năm học mới`,
      env,
    })
  );

  saveHybridStore((prev) => {
    const withTombstones = applyTombstonesToStore(prev, resetTombstones);
    return {
      ...withTombstones,
      students: withTombstones.students.filter((s) => !targetIds.has(s.id)),
      archivedYears: [archiveSnapshot, ...withTombstones.archivedYears],
      logs: [logPayload, ...withTombstones.logs],
      settings: {
        ...withTombstones.settings,
        studentListVersion: nextVersion,
        lastBulkResetAtIso: vnNow.fullDisplay,
        updatedByUid: params.actorUid,
      },
      syncQueue: withTombstones.syncQueue.filter(
        (q) => !(q.collectionName === 'students' && targetIds.has(q.documentId))
      ),
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'archivedYears',
        documentId: archiveId,
        payload: archiveSnapshot,
      });
      for (const tomb of resetTombstones) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'deletionTombstones',
          documentId: tomb.id,
          payload: tomb,
        });
      }
      for (const sId of targetIds) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'students',
          documentId: sId,
        });
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'settings',
        documentId: 'general_settings',
        payload: getHybridStore().settings,
      });
    }
    return {
      archivedCount: targetStudents.length,
      deletedCount: targetStudents.length,
      archiveId,
    };
  }

  try {
    // 1. Archive snapshot + audit log + bump setting version
    await withFastFirestoreTimeout(async () => {
      await setDoc(doc(db, 'archivedYears', archiveId), {
        ...archiveSnapshot,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'registrationLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      const currentSettings = getHybridStore().settings;
      await setDoc(
        doc(db, 'settings', 'general_settings'),
        {
          ...currentSettings,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }, 3000);

    // 2. Also query cloud students in scope in case some exist on cloud that weren't in local
    const cloudSnap = await withFastFirestoreTimeout(
      () =>
        getDocs(
          query(
            collection(db, 'students'),
            where('schoolId', '==', SCHOOL_ID),
            where('env', '==', env)
          )
        ),
      3000
    );

    const cloudIdsToDelete = cloudSnap.docs
      .filter((d) => {
        if (params.scope === 'all') return true;
        return (d.data() as Student).grade === params.scope;
      })
      .map((d) => d.id);

    const allDeleteIds = Array.from(new Set([...Array.from(targetIds), ...cloudIdsToDelete]));
    const allTombstones = allDeleteIds.map((sId) =>
      createTombstoneRecord({
        collectionName: 'students',
        documentId: sId,
        deletedByUid: params.actorUid,
        reason: `Xóa toàn bộ học sinh (${scopeLabel}) chuyển năm học mới`,
        env,
      })
    );
    saveHybridStore((prev) => applyTombstonesToStore(prev, allTombstones));

    for (let i = 0; i < allDeleteIds.length; i += 170) {
      const chunkIds = allDeleteIds.slice(i, i + 170);
      const chunkTombs = allTombstones.slice(i, i + 170);
      const batch = writeBatch(db);
      for (const tomb of chunkTombs) {
        batch.set(
          doc(db, 'deletionTombstones', tomb.id),
          {
            ...tomb,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const sId of chunkIds) {
        batch.delete(doc(db, 'students', sId));
      }
      await withFastFirestoreTimeout(() => batch.commit(), 8000);
    }

    return {
      archivedCount: targetStudents.length,
      deletedCount: allDeleteIds.length,
      archiveId,
    };
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      return {
        archivedCount: targetStudents.length,
        deletedCount: targetStudents.length,
        archiveId,
      };
    }
    handleFirestoreError(error, OperationType.DELETE, 'students');
  }
}

export async function batchImportStudents(params: {
  studentsList: Omit<Student, 'createdAt' | 'updatedAt'>[];
  mode: 'add_only' | 'upsert' | 'replace_all';
  academicYear: string;
  actorUid: string;
  actorName: string;
  env?: AppEnvironment;
}): Promise<{ importedCount: number; skippedCount: number }> {
  const env = params.env || 'production';
  const vnNow = getVietnamDateParts(new Date());

  if (params.mode === 'replace_all') {
    await bulkResetAllStudentsForNewYear({
      confirmationPhrase: BULK_DELETE_CONFIRM_PHRASE,
      scope: 'all',
      academicYear: params.academicYear,
      actorUid: params.actorUid,
      actorName: params.actorName,
      env,
    });
  }

  const store = getHybridStore();
  const existingById = new Map<string, Student>();
  const existingByCode = new Map<string, Student>();
  for (const s of store.students) {
    if (s.env === env) {
      existingById.set(s.id, s);
      existingByCode.set(s.studentCode.toUpperCase(), s);
    }
  }

  const toWrite: Student[] = [];
  let skippedCount = 0;

  for (const stu of params.studentsList) {
    const existing = existingById.get(stu.id) || existingByCode.get(stu.studentCode.toUpperCase());
    if (params.mode === 'add_only' && existing) {
      skippedCount++;
      continue;
    }
    const finalId = existing ? existing.id : stu.id;
    toWrite.push({
      ...stu,
      id: finalId,
      updatedByUid: params.actorUid,
    });
  }

  const logPayload: RegistrationLog = {
    id: sanitizeId(`${env}_log_import_${Date.now()}`),
    registrationId: 'excel_import',
    date: vnNow.dateStr,
    studentId: 'excel',
    studentName: `${toWrite.length} học sinh`,
    classId: 'all',
    className: 'Nhập Excel',
    grade: 6,
    previousStatus: 'unregistered',
    newStatus: 'unregistered',
    actorUid: params.actorUid,
    actorName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    actorRole: 'admin',
    timestampIso: vnNow.fullDisplay,
    isAfterCutoff: false,
    reason: `Nhập danh sách học sinh từ Excel (${toWrite.length} HS, chế độ: ${params.mode})`,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const writtenIds = Array.from(new Set(toWrite.map((s) => s.id)));
  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'students', writtenIds);
    const map = new Map<string, Student>();
    for (const s of cleared.students) map.set(s.id, s);
    for (const s of toWrite) map.set(s.id, s);
    return {
      ...cleared,
      students: Array.from(map.values()),
      logs: [logPayload, ...cleared.logs],
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      for (const s of toWrite) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'deletionTombstones',
          documentId: getTombstoneId('students', s.id),
        });
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'students',
          documentId: s.id,
          payload: s,
        });
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return { importedCount: toWrite.length, skippedCount };
  }

  for (const id of writtenIds) {
    await clearCloudTombstoneIfPresent('students', id, env);
  }

  try {
    for (let i = 0; i < toWrite.length; i += 350) {
      const chunk = toWrite.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const stu of chunk) {
        batch.set(
          doc(db, 'students', stu.id),
          {
            ...stu,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (i === 0) {
        batch.set(doc(db, 'registrationLogs', logPayload.id), {
          ...logPayload,
          createdAt: serverTimestamp(),
        });
      }
      await withFastFirestoreTimeout(() => batch.commit(), 8000);
    }
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      for (const s of toWrite) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'students',
          documentId: s.id,
          payload: s,
        });
      }
      return { importedCount: toWrite.length, skippedCount };
    }
    handleFirestoreError(error, OperationType.WRITE, 'students');
  }

  return { importedCount: toWrite.length, skippedCount };
}

/**
 * Core Atomic Meal Registration Function
 * - Enforces single record per Student + Date (prevents duplicates on repeat QR scans)
 * - Enforces GVCN class restriction and 08:00 lock
 */
export async function registerStudentMeal(params: {
  student: Student;
  date: string;
  newStatus: RegistrationStatus;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  assignedClassId?: string;
  canMarkAttendanceOverride?: boolean;
  cutoffTime?: string;
  forceClockAfterCutoff?: boolean;
  adjustmentReason?: string;
  env?: AppEnvironment;
}): Promise<{
  registrationId: string;
  logId: string;
  isAfterCutoff: boolean;
  unchanged?: boolean;
  syncedToCloud: boolean;
  pendingReason?: string;
}> {
  const env = params.env || params.student.env || 'production';
  const cutoff = params.cutoffTime || DEFAULT_CUTOFF_TIME;
  const regId = getRegistrationDocId(env, params.date, params.student.id);
  const reportId = getDailyReportDocId(env, params.date);
  const logId = sanitizeId(
    `${env}_log_${params.date}_${params.student.id}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  );

  // Enforce GVCN class scope
  if (
    params.actorRole === 'teacher' &&
    params.assignedClassId &&
    params.student.classId !== params.assignedClassId
  ) {
    throw new Error(
      `Bạn chỉ được phép điểm danh suất ăn cho lớp mình phụ trách. Không có quyền thao tác lớp ${params.student.className}.`
    );
  }

  const groupAllowsMark =
    params.canMarkAttendanceOverride !== undefined
      ? params.canMarkAttendanceOverride
      : resolveEffectiveGroup(params.actorRole, getHybridStore().permissionGroups).canMarkAttendance;

  if ((params.actorRole === 'accountant' || params.actorRole === 'medical') && !groupAllowsMark) {
    throw new Error(
      'Vai trò Kế toán / Y tế hiện chỉ có quyền xem báo cáo và đối chiếu, không chỉnh sửa đăng ký.'
    );
  }

  const vnNow = getVietnamDateParts(new Date());
  const clockLocked =
    params.forceClockAfterCutoff !== undefined
      ? params.forceClockAfterCutoff
      : isDateLockedByClock(params.date, cutoff);

  const effectiveRole: 'teacher' | 'admin' | 'accountant' | 'medical' =
    params.actorRole === 'admin'
      ? 'admin'
      : params.actorRole === 'accountant'
      ? 'accountant'
      : params.actorRole === 'medical'
      ? 'medical'
      : 'teacher';

  const storeSnapshot = getHybridStore();
  const targetMonth = params.date.slice(0, 7);
  const settlementId = getMonthlySettlementDocId(env, targetMonth);
  const settledMonth = (storeSnapshot.monthlySettlements || []).find(
    (s) => s.id === settlementId && s.isLocked
  );
  if (settledMonth && effectiveRole !== 'admin') {
    throw new Error(
      `Tháng ${targetMonth} đã khóa sổ quyết toán. Chỉ Quản trị viên mới được phép điều chỉnh suất ăn trong tháng đã quyết toán.`
    );
  }

  const existingLocalReport = storeSnapshot.reports.find((r) => r.id === reportId);
  const isAfterCutoff =
    clockLocked || Boolean(existingLocalReport?.isLocked) || Boolean(settledMonth);

  if (isAfterCutoff && effectiveRole !== 'admin') {
    throw new Error(
      `Đã khóa sổ lúc ${cutoff} ngày ${formatVietnameseDate(params.date)}. Tài khoản không phải Quản trị viên không thể chỉnh sửa sau khi đã khóa sổ. Vui lòng liên hệ Quản trị viên.`
    );
  }

  const cleanReason = sanitizeString(params.adjustmentReason || '', 500, '');
  if (isAfterCutoff && effectiveRole === 'admin' && cleanReason.length < 3) {
    throw new Error(
      'Điều chỉnh sau giờ khóa sổ hoặc trong tháng đã quyết toán bắt buộc phải nhập lý do cụ thể để lưu nhật ký kiểm toán.'
    );
  }

  const existingLocalReg = storeSnapshot.registrations.find((r) => r.id === regId);
  const previousStatus: RegistrationStatus = existingLocalReg
    ? existingLocalReg.status
    : 'unregistered';

  // Idempotency guard: if status already matches AND no pending sync exists for this reg, avoid duplicate writes
  const hasPendingQueueForReg = (storeSnapshot.syncQueue || []).some(
    (q) => q.collectionName === 'registrations' && q.documentId === regId
  );
  if (existingLocalReg && previousStatus === params.newStatus && !hasPendingQueueForReg) {
    return { registrationId: regId, logId: '', isAfterCutoff, unchanged: true, syncedToCloud: true };
  }

  const regPayload: MealRegistration = {
    id: regId,
    date: params.date,
    studentId: params.student.id,
    studentCode: sanitizeString(params.student.studentCode, 32, 'HS'),
    studentName: sanitizeString(params.student.fullName, 120, 'Học sinh'),
    classId: params.student.classId,
    className: sanitizeString(params.student.className, 32, ''),
    grade: params.student.grade,
    status: params.newStatus,
    updatedByUid: params.actorUid,
    updatedByName: sanitizeString(params.actorName, 120, 'Người dùng'),
    updatedByRole: effectiveRole,
    updatedAtIso: vnNow.fullDisplay,
    isPostLockAdjustment: isAfterCutoff,
    adjustmentReason: isAfterCutoff
      ? cleanReason
      : sanitizeString(cleanReason || 'Xác nhận trong giờ quy định', 500, ''),
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const logPayload: RegistrationLog = {
    id: logId,
    registrationId: regId,
    date: params.date,
    studentId: params.student.id,
    studentName: regPayload.studentName,
    classId: params.student.classId,
    className: regPayload.className,
    grade: params.student.grade,
    previousStatus,
    newStatus: params.newStatus,
    actorUid: params.actorUid,
    actorName: regPayload.updatedByName,
    actorRole: effectiveRole,
    timestampIso: vnNow.fullDisplay,
    isAfterCutoff,
    reason: isAfterCutoff
      ? cleanReason
      : `Cập nhật bởi ${effectiveRole === 'teacher' ? 'GVCN' : 'Quản trị viên'} trước ${cutoff}`,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore(
    (prev) => {
      const otherRegs = prev.registrations.filter((r) => r.id !== regId);
      const updatedRegs = [...otherRegs, regPayload];
      const updatedLogs = [logPayload, ...prev.logs];

      let updatedReports = prev.reports;
      const targetRep = prev.reports.find((r) => r.id === reportId);
      if (targetRep && targetRep.isLocked && previousStatus !== params.newStatus) {
        let eatingDelta = 0;
        if (previousStatus !== 'eating' && params.newStatus === 'eating') eatingDelta = 1;
        if (previousStatus === 'eating' && params.newStatus !== 'eating') eatingDelta = -1;

        let notEatingDelta = 0;
        if (previousStatus !== 'not_eating' && params.newStatus === 'not_eating')
          notEatingDelta = 1;
        if (previousStatus === 'not_eating' && params.newStatus !== 'not_eating')
          notEatingDelta = -1;

        let unregDelta = 0;
        if (previousStatus !== 'unregistered' && params.newStatus === 'unregistered')
          unregDelta = 1;
        if (previousStatus === 'unregistered' && params.newStatus !== 'unregistered')
          unregDelta = -1;

        const patchedReport: DailyReport = {
          ...targetRep,
          initialTotalEating: targetRep.initialTotalEating,
          adjustedTotalEating: Math.max(0, targetRep.adjustedTotalEating + eatingDelta),
          totalNotEating: Math.max(0, targetRep.totalNotEating + notEatingDelta),
          totalUnregistered: Math.max(0, targetRep.totalUnregistered + unregDelta),
          grade6Eating:
            params.student.grade === 6
              ? Math.max(0, targetRep.grade6Eating + eatingDelta)
              : targetRep.grade6Eating,
          grade7Eating:
            params.student.grade === 7
              ? Math.max(0, targetRep.grade7Eating + eatingDelta)
              : targetRep.grade7Eating,
          grade8Eating:
            params.student.grade === 8
              ? Math.max(0, targetRep.grade8Eating + eatingDelta)
              : targetRep.grade8Eating,
          grade9Eating:
            params.student.grade === 9
              ? Math.max(0, targetRep.grade9Eating + eatingDelta)
              : targetRep.grade9Eating,
          adjustmentCount: targetRep.adjustmentCount + 1,
        };
        updatedReports = [...prev.reports.filter((r) => r.id !== reportId), patchedReport];
      }

      return {
        ...prev,
        registrations: updatedRegs,
        logs: updatedLogs,
        reports: updatedReports,
      };
    },
    { skipTombstoneSweep: true }
  );

  if (env === 'sandbox') {
    return { registrationId: regId, logId, isAfterCutoff, syncedToCloud: true };
  }

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'registrations',
      documentId: regId,
      payload: regPayload,
    });
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'registrationLogs',
      documentId: logId,
      payload: logPayload,
    });
    return {
      registrationId: regId,
      logId,
      isAfterCutoff,
      syncedToCloud: false,
      pendingReason: 'Thiết bị đang ngoại tuyến (không có mạng).',
    };
  }

  if (getHybridStore().quotaExceeded) {
    markQuotaExceeded(false);
  }
  await setFirestoreNetworkEnabled(true);

  const regRef = doc(db, 'registrations', regId);
  const reportRef = doc(db, 'dailyReports', reportId);
  const logRef = doc(db, 'registrationLogs', logId);

  const commitUnlockedFastBatch = async () => {
    // Fast path: 1 round-trip writeBatch with zero dailyReports transaction contention
    const writeWithMode = async (mode: 'update' | 'create') => {
      const batch = writeBatch(db);
      if (mode === 'update') {
        batch.update(regRef, {
          status: regPayload.status,
          updatedByUid: regPayload.updatedByUid,
          updatedByName: regPayload.updatedByName,
          updatedByRole: regPayload.updatedByRole,
          updatedAtIso: regPayload.updatedAtIso,
          isPostLockAdjustment: regPayload.isPostLockAdjustment,
          adjustmentReason: regPayload.adjustmentReason,
          studentName: regPayload.studentName,
          studentCode: regPayload.studentCode,
          classId: regPayload.classId,
          className: regPayload.className,
          grade: regPayload.grade,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(regRef, {
          ...regPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(logRef, {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    };

    if (existingLocalReg) {
      try {
        await writeWithMode('update');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code || '';
        if (code === 'not-found' || msg.includes('No document to update') || msg.includes('not-found')) {
          await writeWithMode('create');
        } else {
          throw err;
        }
      }
    } else {
      const snap = await getDoc(regRef);
      await writeWithMode(snap.exists() ? 'update' : 'create');
    }
  };

  const commitLockedTransaction = async () => {
    await runTransaction(db, async (tx) => {
      const [regSnap, reportSnap] = await Promise.all([tx.get(regRef), tx.get(reportRef)]);
      if (regSnap.exists()) {
        tx.update(regRef, {
          status: regPayload.status,
          updatedByUid: regPayload.updatedByUid,
          updatedByName: regPayload.updatedByName,
          updatedByRole: regPayload.updatedByRole,
          updatedAtIso: regPayload.updatedAtIso,
          isPostLockAdjustment: regPayload.isPostLockAdjustment,
          adjustmentReason: regPayload.adjustmentReason,
          studentName: regPayload.studentName,
          studentCode: regPayload.studentCode,
          classId: regPayload.classId,
          className: regPayload.className,
          grade: regPayload.grade,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(regRef, {
          ...regPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(logRef, {
        ...logPayload,
        createdAt: serverTimestamp(),
      });

      if (
        reportSnap.exists() &&
        reportSnap.data()?.isLocked &&
        previousStatus !== params.newStatus
      ) {
        const rep = reportSnap.data() as DailyReport;
        let eatingDelta = 0;
        if (previousStatus !== 'eating' && params.newStatus === 'eating') eatingDelta = 1;
        if (previousStatus === 'eating' && params.newStatus !== 'eating') eatingDelta = -1;

        let notEatingDelta = 0;
        if (previousStatus !== 'not_eating' && params.newStatus === 'not_eating')
          notEatingDelta = 1;
        if (previousStatus === 'not_eating' && params.newStatus !== 'not_eating')
          notEatingDelta = -1;

        let unregDelta = 0;
        if (previousStatus !== 'unregistered' && params.newStatus === 'unregistered')
          unregDelta = 1;
        if (previousStatus === 'unregistered' && params.newStatus !== 'unregistered')
          unregDelta = -1;

        tx.update(reportRef, {
          isLocked: rep.isLocked,
          lockedAtIso: rep.lockedAtIso,
          lockedByUid: rep.lockedByUid,
          lockedByName: rep.lockedByName,
          lockType: rep.lockType,
          initialTotalEating: rep.initialTotalEating,
          adjustedTotalEating: Math.max(0, (rep.adjustedTotalEating || 0) + eatingDelta),
          totalNotEating: Math.max(0, (rep.totalNotEating || 0) + notEatingDelta),
          totalUnregistered: Math.max(0, (rep.totalUnregistered || 0) + unregDelta),
          totalStudents: rep.totalStudents,
          grade6Eating:
            params.student.grade === 6
              ? Math.max(0, (rep.grade6Eating || 0) + eatingDelta)
              : rep.grade6Eating,
          grade7Eating:
            params.student.grade === 7
              ? Math.max(0, (rep.grade7Eating || 0) + eatingDelta)
              : rep.grade7Eating,
          grade8Eating:
            params.student.grade === 8
              ? Math.max(0, (rep.grade8Eating || 0) + eatingDelta)
              : rep.grade8Eating,
          grade9Eating:
            params.student.grade === 9
              ? Math.max(0, (rep.grade9Eating || 0) + eatingDelta)
              : rep.grade9Eating,
          adjustmentCount: (rep.adjustmentCount || 0) + 1,
          kitchenConfirmed: rep.kitchenConfirmed,
          kitchenConfirmedAtIso: rep.kitchenConfirmedAtIso,
          kitchenConfirmedByName: rep.kitchenConfirmedByName,
          kitchenConfirmedByUid: rep.kitchenConfirmedByUid,
          updatedAt: serverTimestamp(),
        });
      }
    });
  };

  try {
    await withFastFirestoreTimeout(
      () => (isAfterCutoff ? commitLockedTransaction() : commitUnlockedFastBatch()),
      10000
    );
    saveHybridStore(
      (prev) => ({
        ...prev,
        syncQueue: (prev.syncQueue || []).filter(
          (q) => !(q.collectionName === 'registrations' && q.documentId === regId)
        ),
      }),
      { skipTombstoneSweep: true }
    );
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrations',
        documentId: regId,
        payload: regPayload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: logId,
        payload: logPayload,
      });
      return {
        registrationId: regId,
        logId,
        isAfterCutoff,
        syncedToCloud: false,
        pendingReason: isTrueQuotaError(error)
          ? 'Hệ thống Cloud đang tạm chạm hạn mức đọc/ghi miễn phí.'
          : 'Kết nối máy chủ Cloud bị gián đoạn hoặc quá hạn 10 giây.',
      };
    }
    handleFirestoreError(error, OperationType.WRITE, `registrations/${regId}`);
  }

  return { registrationId: regId, logId, isAfterCutoff, syncedToCloud: true };
}

export async function batchRegisterClassMeals(params: {
  students: Student[];
  date: string;
  newStatus: 'eating' | 'not_eating';
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  assignedClassId?: string;
  canMarkAttendanceOverride?: boolean;
  existingRegistrationsMap?: Map<string, MealRegistration>;
  cutoffTime?: string;
  adjustmentReason?: string;
  env?: AppEnvironment;
}): Promise<{ updatedCount: number; syncedToCloud: boolean; pendingReason?: string }> {
  const env = params.env || 'production';
  const cutoff = params.cutoffTime || DEFAULT_CUTOFF_TIME;
  const clockLocked = isDateLockedByClock(params.date, cutoff);

  const effectiveRole: 'teacher' | 'admin' | 'accountant' | 'medical' =
    params.actorRole === 'admin'
      ? 'admin'
      : params.actorRole === 'accountant'
      ? 'accountant'
      : params.actorRole === 'medical'
      ? 'medical'
      : 'teacher';

  const storeSnap = getHybridStore();
  const groupAllowsMark =
    params.canMarkAttendanceOverride !== undefined
      ? params.canMarkAttendanceOverride
      : resolveEffectiveGroup(params.actorRole, storeSnap.permissionGroups).canMarkAttendance;
  if ((params.actorRole === 'accountant' || params.actorRole === 'medical') && !groupAllowsMark) {
    throw new Error('Vai trò hiện tại không có quyền điểm danh suất ăn.');
  }

  const targetMonth = params.date.slice(0, 7);
  const settlementId = getMonthlySettlementDocId(env, targetMonth);
  const settledMonth = (storeSnap.monthlySettlements || []).find(
    (s) => s.id === settlementId && s.isLocked
  );
  if (settledMonth && effectiveRole !== 'admin') {
    throw new Error(
      `Tháng ${targetMonth} đã khóa sổ quyết toán. Chỉ Quản trị viên mới được phép điều chỉnh.`
    );
  }

  const reportId = getDailyReportDocId(env, params.date);
  const localRep = storeSnap.reports.find((r) => r.id === reportId);
  const isAfterCutoff = clockLocked || Boolean(localRep?.isLocked) || Boolean(settledMonth);

  if (isAfterCutoff && effectiveRole !== 'admin') {
    throw new Error(
      `Đã khóa sổ lúc ${cutoff} ngày ${formatVietnameseDate(params.date)}. Không thể đăng ký hàng loạt sau giờ khóa sổ.`
    );
  }

  const cleanReason = sanitizeString(
    params.adjustmentReason || '',
    500,
    ''
  );
  if (isAfterCutoff && effectiveRole === 'admin' && cleanReason.length < 3) {
    throw new Error('Điều chỉnh hàng loạt sau giờ khóa sổ bắt buộc phải nhập lý do.');
  }

  const existingMap = params.existingRegistrationsMap ?? (() => {
    const fallback = new Map<string, MealRegistration>();
    for (const r of storeSnap.registrations) {
      if (r.env === env && r.date === params.date) {
        fallback.set(r.studentId, r);
      }
    }
    return fallback;
  })();

  const studentsToUpdate = params.students.filter((student) => {
    if (!student.active) return false;
    if (
      effectiveRole === 'teacher' &&
      params.assignedClassId &&
      student.classId !== params.assignedClassId
    ) {
      throw new Error(
        `Bạn chỉ được phép điểm danh suất ăn cho lớp mình phụ trách. Không có quyền thao tác lớp ${student.className}.`
      );
    }
    const current = existingMap.get(student.id);
    return !current || current.status !== params.newStatus;
  });

  if (studentsToUpdate.length === 0) {
    return { updatedCount: 0, syncedToCloud: true };
  }

  const vnNow = getVietnamDateParts(new Date());
  const nowTs = Date.now();
  const pendingRegEntries: Array<{
    student: Student;
    regId: string;
    previousStatus: RegistrationStatus;
    regPayload: MealRegistration;
    logPayload: RegistrationLog;
  }> = [];

  for (let idx = 0; idx < studentsToUpdate.length; idx++) {
    const student = studentsToUpdate[idx];
    const regId = getRegistrationDocId(env, params.date, student.id);
    const existing = existingMap.get(student.id);
    const previousStatus: RegistrationStatus = existing ? existing.status : 'unregistered';
    const logId = sanitizeId(`${env}_log_${params.date}_${student.id}_${nowTs}_${idx}`);

    const regPayload: MealRegistration = {
      id: regId,
      date: params.date,
      studentId: student.id,
      studentCode: sanitizeString(student.studentCode, 32, 'HS'),
      studentName: sanitizeString(student.fullName, 120, 'Học sinh'),
      classId: student.classId,
      className: sanitizeString(student.className, 32, ''),
      grade: student.grade,
      status: params.newStatus,
      updatedByUid: params.actorUid,
      updatedByName: sanitizeString(params.actorName, 120, 'Người dùng'),
      updatedByRole: effectiveRole,
      updatedAtIso: vnNow.fullDisplay,
      isPostLockAdjustment: isAfterCutoff,
      adjustmentReason: isAfterCutoff
        ? cleanReason
        : sanitizeString(cleanReason || 'Xác nhận hàng loạt cho cả lớp', 500, ''),
      env,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    };

    const logPayload: RegistrationLog = {
      id: logId,
      registrationId: regId,
      date: params.date,
      studentId: student.id,
      studentName: regPayload.studentName,
      classId: student.classId,
      className: regPayload.className,
      grade: student.grade,
      previousStatus,
      newStatus: params.newStatus,
      actorUid: params.actorUid,
      actorName: regPayload.updatedByName,
      actorRole: effectiveRole,
      timestampIso: vnNow.fullDisplay,
      isAfterCutoff,
      reason: isAfterCutoff
        ? cleanReason
        : `Xác nhận hàng loạt bởi ${effectiveRole === 'teacher' ? 'GVCN' : 'Quản trị viên'} trước ${cutoff}`,
      env,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    };

    pendingRegEntries.push({
      student,
      regId,
      previousStatus,
      regPayload,
      logPayload,
    });
  }

  // Single atomic local state update (O(1) instead of 45 sequential JSON serializations)
  const batchRegIdSet = new Set(pendingRegEntries.map((e) => e.regId));
  saveHybridStore(
    (prev) => {
      const otherRegs = prev.registrations.filter((r) => !batchRegIdSet.has(r.id));
      const newRegs = pendingRegEntries.map((e) => e.regPayload);
      const newLogs = pendingRegEntries.map((e) => e.logPayload);

      let updatedReports = prev.reports;
      const targetRep = prev.reports.find((r) => r.id === reportId);
      if (targetRep && targetRep.isLocked) {
        let eatingDelta = 0;
        let notEatingDelta = 0;
        let unregDelta = 0;
        let g6 = 0;
        let g7 = 0;
        let g8 = 0;
        let g9 = 0;
        for (const e of pendingRegEntries) {
          if (e.previousStatus !== 'eating' && params.newStatus === 'eating') {
            eatingDelta++;
            if (e.student.grade === 6) g6++;
            if (e.student.grade === 7) g7++;
            if (e.student.grade === 8) g8++;
            if (e.student.grade === 9) g9++;
          } else if (e.previousStatus === 'eating' && params.newStatus !== 'eating') {
            eatingDelta--;
            if (e.student.grade === 6) g6--;
            if (e.student.grade === 7) g7--;
            if (e.student.grade === 8) g8--;
            if (e.student.grade === 9) g9--;
          }
          if (e.previousStatus !== 'not_eating' && params.newStatus === 'not_eating') notEatingDelta++;
          else if (e.previousStatus === 'not_eating' && params.newStatus !== 'not_eating') notEatingDelta--;
          if (e.previousStatus !== 'unregistered') unregDelta--;
        }
        const patchedReport: DailyReport = {
          ...targetRep,
          adjustedTotalEating: Math.max(0, targetRep.adjustedTotalEating + eatingDelta),
          totalNotEating: Math.max(0, targetRep.totalNotEating + notEatingDelta),
          totalUnregistered: Math.max(0, targetRep.totalUnregistered + unregDelta),
          grade6Eating: Math.max(0, targetRep.grade6Eating + g6),
          grade7Eating: Math.max(0, targetRep.grade7Eating + g7),
          grade8Eating: Math.max(0, targetRep.grade8Eating + g8),
          grade9Eating: Math.max(0, targetRep.grade9Eating + g9),
          adjustmentCount: targetRep.adjustmentCount + pendingRegEntries.length,
        };
        updatedReports = [...prev.reports.filter((r) => r.id !== reportId), patchedReport];
      }

      return {
        ...prev,
        registrations: [...otherRegs, ...newRegs],
        logs: [...newLogs, ...prev.logs],
        reports: updatedReports,
      };
    },
    { skipTombstoneSweep: true }
  );

  if (env === 'sandbox') {
    return { updatedCount: pendingRegEntries.length, syncedToCloud: true };
  }

  const enqueueBatchItems = () => {
    for (const e of pendingRegEntries) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrations',
        documentId: e.regId,
        payload: e.regPayload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'registrationLogs',
        documentId: e.logPayload.id,
        payload: e.logPayload,
      });
    }
  };

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline) {
    enqueueBatchItems();
    return {
      updatedCount: pendingRegEntries.length,
      syncedToCloud: false,
      pendingReason: 'Thiết bị đang ngoại tuyến (không có mạng).',
    };
  }

  if (getHybridStore().quotaExceeded) {
    markQuotaExceeded(false);
  }
  await setFirestoreNetworkEnabled(true);

  try {
    await withFastFirestoreTimeout(async () => {
      // Check doc existence in parallel (1 single round-trip) so update preserves createdAt per Firestore rules
      const existenceSnaps = await Promise.all(
        pendingRegEntries.map((e) => getDoc(doc(db, 'registrations', e.regId)))
      );

      // Commit in writeBatch chunks of 200 students (400 ops per batch; 1 class = 1 single atomic batch!)
      for (let i = 0; i < pendingRegEntries.length; i += 200) {
        const batch = writeBatch(db);
        const sliceEnd = Math.min(i + 200, pendingRegEntries.length);
        for (let j = i; j < sliceEnd; j++) {
          const e = pendingRegEntries[j];
          const regRef = doc(db, 'registrations', e.regId);
          const logRef = doc(db, 'registrationLogs', e.logPayload.id);
          if (existenceSnaps[j].exists()) {
            batch.update(regRef, {
              status: e.regPayload.status,
              updatedByUid: e.regPayload.updatedByUid,
              updatedByName: e.regPayload.updatedByName,
              updatedByRole: e.regPayload.updatedByRole,
              updatedAtIso: e.regPayload.updatedAtIso,
              isPostLockAdjustment: e.regPayload.isPostLockAdjustment,
              adjustmentReason: e.regPayload.adjustmentReason,
              studentName: e.regPayload.studentName,
              studentCode: e.regPayload.studentCode,
              classId: e.regPayload.classId,
              className: e.regPayload.className,
              grade: e.regPayload.grade,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(regRef, {
              ...e.regPayload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          batch.set(logRef, {
            ...e.logPayload,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      if (isAfterCutoff && effectiveRole === 'admin') {
        const reportRef = doc(db, 'dailyReports', reportId);
        const repSnap = await getDoc(reportRef);
        if (repSnap.exists() && repSnap.data()?.isLocked) {
          const rep = repSnap.data() as DailyReport;
          let eatingDelta = 0;
          let notEatingDelta = 0;
          let unregDelta = 0;
          let g6 = 0;
          let g7 = 0;
          let g8 = 0;
          let g9 = 0;
          for (const e of pendingRegEntries) {
            if (e.previousStatus !== 'eating' && params.newStatus === 'eating') {
              eatingDelta++;
              if (e.student.grade === 6) g6++;
              if (e.student.grade === 7) g7++;
              if (e.student.grade === 8) g8++;
              if (e.student.grade === 9) g9++;
            } else if (e.previousStatus === 'eating' && params.newStatus !== 'eating') {
              eatingDelta--;
              if (e.student.grade === 6) g6--;
              if (e.student.grade === 7) g7--;
              if (e.student.grade === 8) g8--;
              if (e.student.grade === 9) g9--;
            }
            if (e.previousStatus !== 'not_eating' && params.newStatus === 'not_eating') notEatingDelta++;
            else if (e.previousStatus === 'not_eating' && params.newStatus !== 'not_eating') notEatingDelta--;
            if (e.previousStatus !== 'unregistered') unregDelta--;
          }
          await updateDoc(reportRef, {
            adjustedTotalEating: Math.max(0, (rep.adjustedTotalEating || 0) + eatingDelta),
            totalNotEating: Math.max(0, (rep.totalNotEating || 0) + notEatingDelta),
            totalUnregistered: Math.max(0, (rep.totalUnregistered || 0) + unregDelta),
            grade6Eating: Math.max(0, (rep.grade6Eating || 0) + g6),
            grade7Eating: Math.max(0, (rep.grade7Eating || 0) + g7),
            grade8Eating: Math.max(0, (rep.grade8Eating || 0) + g8),
            grade9Eating: Math.max(0, (rep.grade9Eating || 0) + g9),
            adjustmentCount: (rep.adjustmentCount || 0) + pendingRegEntries.length,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }, 15000);

    saveHybridStore(
      (prev) => ({
        ...prev,
        syncQueue: (prev.syncQueue || []).filter(
          (q) => !(q.collectionName === 'registrations' && batchRegIdSet.has(q.documentId))
        ),
      }),
      { skipTombstoneSweep: true }
    );
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      enqueueBatchItems();
      return {
        updatedCount: pendingRegEntries.length,
        syncedToCloud: false,
        pendingReason: isTrueQuotaError(error)
          ? 'Hệ thống Cloud đang chạm hạn mức miễn phí.'
          : 'Kết nối máy chủ Cloud chậm hoặc quá hạn 15 giây.',
      };
    }
    handleFirestoreError(error, OperationType.WRITE, 'registrations');
  }

  return { updatedCount: pendingRegEntries.length, syncedToCloud: true };
}

export async function syncPendingRegistrationsToCloud(): Promise<{
  syncedCount: number;
  remainingCount: number;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Thiết bị đang ngoại tuyến. Vui lòng bật 4G/WiFi và thử lại.');
  }
  markQuotaExceeded(false);
  await setFirestoreNetworkEnabled(true);
  const flushed = await flushSyncQueueToFirestore();
  const remaining = (getHybridStore().syncQueue || []).filter(
    (q) => q.collectionName === 'registrations' || q.collectionName === 'registrationLogs'
  ).length;
  return { syncedCount: flushed, remainingCount: remaining };
}

export function computeSchoolSummaries(
  classes: SchoolClass[],
  students: Student[],
  registrations: MealRegistration[],
  env: AppEnvironment = 'production'
): {
  grades: GradeSummary[];
  allClassRows: ClassSummaryRow[];
  totalStudents: number;
  totalEating: number;
  totalNotEating: number;
  totalUnregistered: number;
  grade6Eating: number;
  grade7Eating: number;
  grade8Eating: number;
  grade9Eating: number;
} {
  const activeClasses = classes
    .filter((c) => c.env === env && c.active)
    .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order));

  const activeStudents = students.filter((s) => s.env === env && s.active);
  const regMap = new Map<string, MealRegistration>();
  for (const r of registrations) {
    if (r.env === env) {
      regMap.set(r.studentId, r);
    }
  }

  const studentsByClass = new Map<string, Student[]>();
  for (const s of activeStudents) {
    const list = studentsByClass.get(s.classId) || [];
    list.push(s);
    studentsByClass.set(s.classId, list);
  }

  const allClassRows: ClassSummaryRow[] = [];
  const gradeMap = new Map<GradeLevel, GradeSummary>();
  for (const g of [6, 7, 8, 9] as GradeLevel[]) {
    gradeMap.set(g, {
      grade: g,
      classCount: 0,
      totalStudents: 0,
      eatingCount: 0,
      notEatingCount: 0,
      unregisteredCount: 0,
      classes: [],
    });
  }

  let totalStudents = 0;
  let totalEating = 0;
  let totalNotEating = 0;
  let totalUnregistered = 0;

  for (const cls of activeClasses) {
    const classStudents = (studentsByClass.get(cls.id) || []).sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'vi')
    );
    let eatingCount = 0;
    let notEatingCount = 0;
    let unregisteredCount = 0;
    const eatingStudents: { student: Student; registration: MealRegistration }[] = [];
    const notEatingStudents: { student: Student; registration: MealRegistration }[] = [];
    const unregisteredStudents: Student[] = [];

    for (const stu of classStudents) {
      const reg = regMap.get(stu.id);
      const status: RegistrationStatus = reg ? reg.status : 'unregistered';
      if (status === 'eating' && reg) {
        eatingCount++;
        eatingStudents.push({ student: stu, registration: reg });
      } else if (status === 'not_eating' && reg) {
        notEatingCount++;
        notEatingStudents.push({ student: stu, registration: reg });
      } else {
        unregisteredCount++;
        unregisteredStudents.push(stu);
      }
    }

    const row: ClassSummaryRow = {
      classObj: cls,
      totalStudents: classStudents.length,
      eatingCount,
      notEatingCount,
      unregisteredCount,
      eatingStudents,
      notEatingStudents,
      unregisteredStudents,
    };

    allClassRows.push(row);
    const gSum = gradeMap.get(cls.grade)!;
    gSum.classCount++;
    gSum.totalStudents += classStudents.length;
    gSum.eatingCount += eatingCount;
    gSum.notEatingCount += notEatingCount;
    gSum.unregisteredCount += unregisteredCount;
    gSum.classes.push(row);

    totalStudents += classStudents.length;
    totalEating += eatingCount;
    totalNotEating += notEatingCount;
    totalUnregistered += unregisteredCount;
  }

  return {
    grades: [gradeMap.get(6)!, gradeMap.get(7)!, gradeMap.get(8)!, gradeMap.get(9)!],
    allClassRows,
    totalStudents,
    totalEating,
    totalNotEating,
    totalUnregistered,
    grade6Eating: gradeMap.get(6)!.eatingCount,
    grade7Eating: gradeMap.get(7)!.eatingCount,
    grade8Eating: gradeMap.get(8)!.eatingCount,
    grade9Eating: gradeMap.get(9)!.eatingCount,
  };
}

export async function lockDailyReportTransaction(params: {
  date: string;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  actorUid: string;
  actorName: string;
  lockType: 'auto_0800' | 'manual_admin';
  env?: AppEnvironment;
}): Promise<DailyReport> {
  const env = params.env || 'production';
  const reportId = getDailyReportDocId(env, params.date);
  const reportRef = doc(db, 'dailyReports', reportId);
  const summary = computeSchoolSummaries(
    params.classes,
    params.students,
    params.registrations,
    env
  );
  const vnNow = getVietnamDateParts(new Date());

  const payload: DailyReport = {
    id: reportId,
    date: params.date,
    isLocked: true,
    lockedAtIso: vnNow.fullDisplay,
    lockedByUid: params.actorUid,
    lockedByName: sanitizeString(params.actorName, 120, 'Hệ thống tự động 08:00'),
    lockType: params.lockType,
    initialTotalEating: summary.totalEating,
    adjustedTotalEating: summary.totalEating,
    totalNotEating: summary.totalNotEating,
    totalUnregistered: summary.totalUnregistered,
    totalStudents: summary.totalStudents,
    grade6Eating: summary.grade6Eating,
    grade7Eating: summary.grade7Eating,
    grade8Eating: summary.grade8Eating,
    grade9Eating: summary.grade9Eating,
    adjustmentCount: 0,
    kitchenConfirmed: false,
    kitchenConfirmedAtIso: '',
    kitchenConfirmedByName: '',
    kitchenConfirmedByUid: '',
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const existing = prev.reports.find((r) => r.id === reportId);
    if (existing && existing.isLocked) {
      return prev;
    }
    return {
      ...prev,
      reports: [...prev.reports.filter((r) => r.id !== reportId), payload],
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'dailyReports',
        documentId: reportId,
        payload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(
      () =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(reportRef);
          if (snap.exists() && snap.data()?.isLocked) {
            return;
          }
          if (snap.exists()) {
            tx.update(reportRef, {
              ...payload,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(reportRef, {
              ...payload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }),
      8000
    );
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'dailyReports',
        documentId: reportId,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `dailyReports/${reportId}`);
  }

  return payload;
}

export async function unlockDailyReport(params: {
  date: string;
  actorUid: string;
  actorName: string;
  env?: AppEnvironment;
}): Promise<void> {
  const env = params.env || 'production';
  const reportId = getDailyReportDocId(env, params.date);
  const reportRef = doc(db, 'dailyReports', reportId);
  const vnNow = getVietnamDateParts(new Date());

  saveHybridStore((prev) => {
    const existing = prev.reports.find((r) => r.id === reportId);
    if (!existing) return prev;
    const updated: DailyReport = {
      ...existing,
      isLocked: false,
      lockedAtIso: `Đã mở lại bởi ${params.actorName} lúc ${vnNow.fullDisplay}`,
    };
    return {
      ...prev,
      reports: [...prev.reports.filter((r) => r.id !== reportId), updated],
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    const rep = getHybridStore().reports.find((r) => r.id === reportId);
    if (env === 'production' && rep) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'dailyReports',
        documentId: reportId,
        payload: rep,
      });
    }
    return;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const snap = await getDoc(reportRef);
      if (snap.exists()) {
        await updateDoc(reportRef, {
          isLocked: false,
          lockedAtIso: `Đã mở lại bởi ${params.actorName} lúc ${vnNow.fullDisplay}`,
          updatedAt: serverTimestamp(),
        });
      }
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `dailyReports/${reportId}`);
  }
}

export async function saveSchoolSettings(params: {
  schoolName: string;
  cutoffTime: string;
  academicYear: string;
  semester: 'HK1' | 'HK2';
  autoLockEnabled: boolean;
  actorUid: string;
}): Promise<void> {
  const settingId = 'general_settings';
  const ref = doc(db, 'settings', settingId);
  const prevSettings = getHybridStore().settings;

  const payload: SchoolSetting = {
    id: settingId,
    schoolName: sanitizeString(params.schoolName, 200, 'TRƯỜNG THCS ĐÔNG THẠNH'),
    cutoffTime: /^\d{2}:\d{2}$/.test(params.cutoffTime) ? params.cutoffTime : DEFAULT_CUTOFF_TIME,
    academicYear: sanitizeString(params.academicYear, 32, '2026 - 2027'),
    semester: params.semester,
    autoLockEnabled: params.autoLockEnabled,
    studentListVersion: prevSettings?.studentListVersion || 1,
    lastBulkResetAtIso: prevSettings?.lastBulkResetAtIso || '',
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: params.actorUid,
  };

  saveHybridStore((prev) => ({
    ...prev,
    settings: payload,
  }));

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'settings',
      documentId: settingId,
      payload,
    });
    return;
  }

  try {
    await withFastFirestoreTimeout(
      async () => {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await updateDoc(ref, {
            schoolName: payload.schoolName,
            cutoffTime: payload.cutoffTime,
            academicYear: payload.academicYear,
            semester: payload.semester,
            autoLockEnabled: payload.autoLockEnabled,
            studentListVersion: payload.studentListVersion,
            lastBulkResetAtIso: payload.lastBulkResetAtIso,
            updatedByUid: payload.updatedByUid,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      },
      8000
    );
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'settings',
        documentId: settingId,
        payload,
      });
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `settings/${settingId}`);
  }
}

/**
 * Account Access & User RBAC Management (Section 6)
 */
export async function saveAccountAccess(params: {
  email: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  assignedClassId: string;
  joinedInviteCode?: string;
  uid?: string;
  lastLoginAtIso?: string;
  actorUid: string;
  existingAccounts: AccountAccess[];
}): Promise<AccountAccess> {
  const cleanEmail = sanitizeString(params.email.toLowerCase(), 256);
  if (!cleanEmail.includes('@')) {
    throw new Error('Địa chỉ email không hợp lệ.');
  }
  const accessId = normalizeEmailKey(cleanEmail);

  // Last-Admin Guard: Do not allow demoting/disabling the last active admin or bootstrapped admin
  const activeAdmins = params.existingAccounts.filter(
    (a) => a.role === 'admin' && a.status === 'active'
  );
  const targetExisting = params.existingAccounts.find((a) => a.id === accessId);

  if (cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL && (params.role !== 'admin' || params.status !== 'active')) {
    throw new Error('Không thể hạ quyền hoặc khóa tài khoản Quản trị viên gốc của hệ thống.');
  }

  if (
    targetExisting &&
    targetExisting.role === 'admin' &&
    targetExisting.status === 'active' &&
    (params.role !== 'admin' || params.status !== 'active') &&
    activeAdmins.length <= 1
  ) {
    throw new Error(
      'Không thể khóa, thu hồi hoặc hạ quyền Quản trị viên cuối cùng khi chưa có Quản trị viên thay thế.'
    );
  }

  const payload: AccountAccess = {
    id: accessId,
    email: cleanEmail,
    displayName: sanitizeString(params.displayName, 120, cleanEmail),
    role: params.role,
    status: params.status,
    assignedClassId: params.role === 'teacher' ? sanitizeString(params.assignedClassId, 64, '') : '',
    joinedInviteCode: sanitizeString(
      params.joinedInviteCode !== undefined
        ? params.joinedInviteCode
        : targetExisting?.joinedInviteCode || '',
      32,
      ''
    ),
    uid: sanitizeString(params.uid || targetExisting?.uid || '', 128, ''),
    lastLoginAtIso: sanitizeString(
      params.lastLoginAtIso || targetExisting?.lastLoginAtIso || 'Chưa đăng nhập',
      48
    ),
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: params.actorUid,
  };

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'accountAccess', [accessId]);
    return {
      ...cleared,
      accountAccess: [...cleared.accountAccess.filter((a) => a.id !== accessId), payload],
    };
  });

  await clearCloudTombstoneIfPresent('accountAccess', accessId, 'production');

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'accountAccess',
      documentId: accessId,
      payload,
    });
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'accountAccess', accessId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          displayName: payload.displayName,
          role: payload.role,
          status: payload.status,
          assignedClassId: payload.assignedClassId,
          joinedInviteCode: payload.joinedInviteCode,
          uid: payload.uid,
          lastLoginAtIso: payload.lastLoginAtIso,
          updatedByUid: payload.updatedByUid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // Synchronize /users/{uid} immediately if UID is known so active sessions update/terminate instantly
      if (payload.uid) {
        const userRef = doc(db, 'users', payload.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await updateDoc(userRef, {
            role: payload.role,
            status: payload.status,
            assignedClassId: payload.assignedClassId,
            joinedInviteCode: payload.joinedInviteCode,
            displayName: payload.displayName,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'accountAccess',
        documentId: accessId,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `accountAccess/${accessId}`);
  }

  return payload;
}

export async function deleteAccountAccess(params: {
  account: AccountAccess;
  existingAccounts: AccountAccess[];
  actorUid?: string;
}): Promise<void> {
  if (params.account.email === BOOTSTRAPPED_ADMIN_EMAIL) {
    throw new Error('Không thể xóa tài khoản Quản trị viên gốc.');
  }
  const activeAdmins = params.existingAccounts.filter(
    (a) => a.role === 'admin' && a.status === 'active'
  );
  if (params.account.role === 'admin' && params.account.status === 'active' && activeAdmins.length <= 1) {
    throw new Error('Không thể xóa Quản trị viên cuối cùng khi chưa có Quản trị viên thay thế.');
  }

  const tombstone = createTombstoneRecord({
    collectionName: 'accountAccess',
    documentId: params.account.id,
    deletedByUid: params.actorUid || auth.currentUser?.uid || 'system',
    reason: `Xóa tài khoản phân quyền ${params.account.email}`,
    env: 'production',
  });

  saveHybridStore((prev) => {
    const withTombstone = applyTombstonesToStore(prev, [tombstone]);
    return {
      ...withTombstone,
      accountAccess: withTombstone.accountAccess.filter((a) => a.id !== params.account.id),
      syncQueue: withTombstone.syncQueue.filter(
        (q) => !(q.collectionName === 'accountAccess' && q.documentId === params.account.id)
      ),
    };
  });

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'deletionTombstones',
      documentId: tombstone.id,
      payload: tombstone,
    });
    queueSyncOperation({
      action: 'delete',
      collectionName: 'accountAccess',
      documentId: params.account.id,
    });
    if (params.account.uid) {
      queueSyncOperation({
        action: 'delete',
        collectionName: 'users',
        documentId: params.account.uid,
      });
    }
    return;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'deletionTombstones', tombstone.id),
        {
          ...tombstone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      batch.delete(doc(db, 'accountAccess', params.account.id));
      if (params.account.uid) {
        batch.delete(doc(db, 'users', params.account.uid));
      }
      await batch.commit();
    }, 8000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'deletionTombstones',
        documentId: tombstone.id,
        payload: tombstone,
      });
      queueSyncOperation({
        action: 'delete',
        collectionName: 'accountAccess',
        documentId: params.account.id,
      });
      if (params.account.uid) {
        queueSyncOperation({
          action: 'delete',
          collectionName: 'users',
          documentId: params.account.uid,
        });
      }
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `accountAccess/${params.account.id}`);
  }
}

/**
 * Permission Group Management (Nhóm phân quyền theo mục quản trị)
 */
export async function savePermissionGroup(params: {
  group: PermissionGroup;
  actorUid: string;
}): Promise<PermissionGroup> {
  const vnNow = getVietnamDateParts(new Date());
  const normalizedModules =
    params.group.id === 'admin'
      ? Array.from(new Set([...params.group.allowedModules, 'users' as const, 'admin' as const]))
      : Array.from(new Set(params.group.allowedModules));

  const payload: PermissionGroup = {
    id: params.group.id,
    label: sanitizeString(params.group.label, 120, params.group.id),
    description: sanitizeString(params.group.description, 300, ''),
    allowedModules: normalizedModules,
    canMarkAttendance: Boolean(params.group.canMarkAttendance),
    canExportReports: Boolean(params.group.canExportReports),
    canManageStudents: Boolean(params.group.canManageStudents),
    canShareClassCode: Boolean(params.group.canShareClassCode),
    canManageMealPricing: Boolean(params.group.canManageMealPricing),
    canCollectPayments: Boolean(params.group.canCollectPayments),
    updatedAtIso: vnNow.fullDisplay,
    updatedByUid: params.actorUid,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const others = (prev.permissionGroups || []).filter((g) => g.id !== payload.id);
    return {
      ...prev,
      permissionGroups: [...others, payload],
    };
  });

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'permissionGroups',
      documentId: payload.id,
      payload,
    });
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'permissionGroups', payload.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          label: payload.label,
          description: payload.description,
          allowedModules: payload.allowedModules,
          canMarkAttendance: payload.canMarkAttendance,
          canExportReports: payload.canExportReports,
          canManageStudents: payload.canManageStudents,
          canShareClassCode: payload.canShareClassCode,
          canManageMealPricing: payload.canManageMealPricing,
          canCollectPayments: payload.canCollectPayments,
          updatedAtIso: payload.updatedAtIso,
          updatedByUid: payload.updatedByUid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 4000);
  } catch (error) {
    if (isTrueQuotaError(error)) {
      markQuotaExceeded(true);
    }
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'permissionGroups',
        documentId: payload.id,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `permissionGroups/${payload.id}`);
  }

  return payload;
}

export async function saveAllPermissionGroups(params: {
  groups: PermissionGroup[];
  actorUid: string;
}): Promise<PermissionGroup[]> {
  const saved: PermissionGroup[] = [];
  for (const g of params.groups) {
    saved.push(await savePermissionGroup({ group: g, actorUid: params.actorUid }));
  }
  return saved;
}

export async function resetDefaultPermissionGroups(actorUid: string): Promise<PermissionGroup[]> {
  return saveAllPermissionGroups({
    groups: getDefaultPermissionGroups(actorUid),
    actorUid,
  });
}

/**
 * Shareable Link & Code Management for Members (GVCN theo lớp, Kế toán, Nhân viên Y tế)
 */
export async function createOrRotateAccessInvite(params: {
  role: 'teacher' | 'accountant' | 'medical';
  schoolClass?: SchoolClass;
  memberLabel?: string;
  actorUid: string;
  actorName: string;
  existingInvites?: ClassInvite[];
}): Promise<ClassInvite> {
  const vnNow = getVietnamDateParts(new Date());
  if (params.role === 'teacher' && !params.schoolClass) {
    throw new Error('Mã chia sẻ cho GVCN phải gắn với một lớp cụ thể.');
  }

  const code = normalizeInviteCode(
    params.role === 'teacher' && params.schoolClass
      ? generateClassInviteCode(params.schoolClass.grade, params.schoolClass.order)
      : generateRoleInviteCode(params.role as 'accountant' | 'medical')
  );

  // If rotating, revoke & tombstone previous invite(s) for this target so old codes never linger
  const prevInvites = params.existingInvites || [];
  for (const oldInv of prevInvites) {
    await deleteClassInvite({ invite: oldInv, actorUid: params.actorUid });
  }

  const targetClassId =
    params.role === 'teacher' && params.schoolClass ? params.schoolClass.id : 'all';
  const targetClassName =
    params.role === 'teacher' && params.schoolClass
      ? sanitizeString(params.schoolClass.name, 32, 'Lớp')
      : 'Toàn trường';
  const targetGrade: GradeLevel =
    params.role === 'teacher' && params.schoolClass ? params.schoolClass.grade : 6;
  const resolvedLabel = sanitizeString(
    params.memberLabel ||
      (params.role === 'teacher'
        ? `GVCN Lớp ${targetClassName}`
        : getRoleLabel(params.role)),
    120,
    getRoleLabel(params.role)
  );

  const payload: ClassInvite = {
    id: code,
    code,
    role: params.role,
    memberLabel: resolvedLabel,
    classId: targetClassId,
    className: targetClassName,
    grade: targetGrade,
    active: true,
    usageCount: 0,
    lastUsedByEmail: '',
    lastUsedAtIso: '',
    createdByUid: params.actorUid,
    createdByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    updatedAtIso: vnNow.fullDisplay,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'classInvites', [code]);
    return {
      ...cleared,
      classInvites: [...(cleared.classInvites || []).filter((i) => i.id !== code), payload],
    };
  });

  await clearCloudTombstoneIfPresent('classInvites', code, 'production');

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'classInvites',
      documentId: code,
      payload,
    });
    return payload;
  }

  if (getHybridStore().quotaExceeded) {
    markQuotaExceeded(false);
  }
  await setFirestoreNetworkEnabled(true);

  try {
    await withFastFirestoreTimeout(async () => {
      await setDoc(doc(db, 'classInvites', code), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }, 8000);
    saveHybridStore((prev) => ({
      ...prev,
      syncQueue: (prev.syncQueue || []).filter(
        (q) => !(q.collectionName === 'classInvites' && q.documentId === code)
      ),
    }));
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'classInvites',
        documentId: code,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `classInvites/${code}`);
  }

  return payload;
}

export async function createOrRotateClassInvite(params: {
  schoolClass: SchoolClass;
  actorUid: string;
  actorName: string;
  existingInvitesForClass?: ClassInvite[];
}): Promise<ClassInvite> {
  return createOrRotateAccessInvite({
    role: 'teacher',
    schoolClass: params.schoolClass,
    memberLabel: `GVCN Lớp ${params.schoolClass.name}`,
    actorUid: params.actorUid,
    actorName: params.actorName,
    existingInvites: params.existingInvitesForClass,
  });
}

export async function generateMissing61ClassInvites(params: {
  classes: SchoolClass[];
  existingInvites: ClassInvite[];
  actorUid: string;
  actorName: string;
}): Promise<number> {
  const vnNow = getVietnamDateParts(new Date());
  const existingClassIds = new Set(params.existingInvites.map((i) => i.classId));
  const missingClasses = params.classes.filter(
    (c) => c.env === 'production' && c.active && !existingClassIds.has(c.id)
  );
  if (missingClasses.length === 0) return 0;

  const usedCodes = new Set(params.existingInvites.map((i) => i.code));
  const newInvites: ClassInvite[] = [];

  for (const cls of missingClasses) {
    let code = generateClassInviteCode(cls.grade, cls.order);
    while (usedCodes.has(code)) {
      code = generateClassInviteCode(cls.grade, cls.order);
    }
    usedCodes.add(code);
    newInvites.push({
      id: code,
      code,
      role: 'teacher',
      memberLabel: `GVCN Lớp ${cls.name}`,
      classId: cls.id,
      className: sanitizeString(cls.name, 32, 'Lớp'),
      grade: cls.grade,
      active: true,
      usageCount: 0,
      lastUsedByEmail: '',
      lastUsedAtIso: '',
      createdByUid: params.actorUid,
      createdByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
      updatedAtIso: vnNow.fullDisplay,
      schoolId: SCHOOL_ID,
      visibility: 'school',
    });
  }

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(
      prev,
      'classInvites',
      newInvites.map((i) => i.id)
    );
    return {
      ...cleared,
      classInvites: [...(cleared.classInvites || []), ...newInvites],
    };
  });

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline) {
    for (const inv of newInvites) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'classInvites',
        documentId: inv.id,
        payload: inv,
      });
    }
    return newInvites.length;
  }

  if (getHybridStore().quotaExceeded) {
    markQuotaExceeded(false);
  }
  await setFirestoreNetworkEnabled(true);

  try {
    for (let i = 0; i < newInvites.length; i += 350) {
      const chunk = newInvites.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const inv of chunk) {
        batch.set(doc(db, 'classInvites', inv.id), {
          ...inv,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await withFastFirestoreTimeout(() => batch.commit(), 10000);
    }
    const createdIdSet = new Set(newInvites.map((inv) => inv.id));
    saveHybridStore((prev) => ({
      ...prev,
      syncQueue: (prev.syncQueue || []).filter(
        (q) => !(q.collectionName === 'classInvites' && createdIdSet.has(q.documentId))
      ),
    }));
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      for (const inv of newInvites) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'classInvites',
          documentId: inv.id,
          payload: inv,
        });
      }
      return newInvites.length;
    }
    handleFirestoreError(error, OperationType.WRITE, 'classInvites');
  }

  return newInvites.length;
}

export async function toggleClassInviteActive(params: {
  invite: ClassInvite;
  active: boolean;
}): Promise<ClassInvite> {
  const vnNow = getVietnamDateParts(new Date());
  const updated: ClassInvite = {
    ...params.invite,
    active: params.active,
    updatedAtIso: vnNow.fullDisplay,
  };

  saveHybridStore((prev) => ({
    ...prev,
    classInvites: [...(prev.classInvites || []).filter((i) => i.id !== updated.id), updated],
  }));

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isBrowserOffline) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'classInvites',
      documentId: updated.id,
      payload: updated,
    });
    return updated;
  }

  if (getHybridStore().quotaExceeded) {
    markQuotaExceeded(false);
  }
  await setFirestoreNetworkEnabled(true);

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'classInvites', updated.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          active: updated.active,
          updatedAtIso: updated.updatedAtIso,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...updated,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 8000);
    saveHybridStore((prev) => ({
      ...prev,
      syncQueue: (prev.syncQueue || []).filter(
        (q) => !(q.collectionName === 'classInvites' && q.documentId === updated.id)
      ),
    }));
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'classInvites',
        documentId: updated.id,
        payload: updated,
      });
      return updated;
    }
    handleFirestoreError(error, OperationType.WRITE, `classInvites/${updated.id}`);
  }

  return updated;
}

export async function deleteClassInvite(params: {
  invite: ClassInvite;
  actorUid: string;
}): Promise<void> {
  const tombstone = createTombstoneRecord({
    collectionName: 'classInvites',
    documentId: params.invite.id,
    deletedByUid: params.actorUid,
    reason: `Thu hồi & xóa mã mời lớp ${params.invite.className} (${params.invite.code})`,
    env: 'production',
  });

  saveHybridStore((prev) => {
    const withTomb = applyTombstonesToStore(prev, [tombstone]);
    return {
      ...withTomb,
      classInvites: (withTomb.classInvites || []).filter((i) => i.id !== params.invite.id),
      syncQueue: (withTomb.syncQueue || []).filter(
        (q) => !(q.collectionName === 'classInvites' && q.documentId === params.invite.id)
      ),
    };
  });

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'deletionTombstones',
      documentId: tombstone.id,
      payload: tombstone,
    });
    queueSyncOperation({
      action: 'delete',
      collectionName: 'classInvites',
      documentId: params.invite.id,
    });
    return;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'deletionTombstones', tombstone.id),
        {
          ...tombstone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      batch.delete(doc(db, 'classInvites', params.invite.id));
      await batch.commit();
    }, 6000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'deletionTombstones',
        documentId: tombstone.id,
        payload: tombstone,
      });
      queueSyncOperation({
        action: 'delete',
        collectionName: 'classInvites',
        documentId: params.invite.id,
      });
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `classInvites/${params.invite.id}`);
  }
}

/**
 * Fast, dedicated Cloud sync for Shareable Invites (Accountant, Medical & 61-class GVCN links).
 * Runs independently of bulk student/registration sync so pending link banners resolve immediately.
 */
export async function syncPendingClassInvitesToCloud(): Promise<{
  syncedCount: number;
  remainingCount: number;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Thiết bị đang ngoại tuyến (không có mạng). Vui lòng kiểm tra WiFi / 4G và thử lại.');
  }
  if (!auth.currentUser) {
    throw new Error('Vui lòng đăng nhập tài khoản Quản trị viên Google để đồng bộ link lên máy chủ Cloud.');
  }

  markQuotaExceeded(false);
  await setFirestoreNetworkEnabled(true);

  const schoolFilter = [
    where('schoolId', '==', SCHOOL_ID),
    where('visibility', '==', 'school'),
  ];

  const [cloudInvSnap, cloudTombSnap] = await withFastFirestoreTimeout(
    () =>
      Promise.all([
        getDocs(query(collection(db, 'classInvites'), ...schoolFilter)),
        getDocs(query(collection(db, 'deletionTombstones'), ...schoolFilter)),
      ]),
    12000
  );

  const cloudInviteMap = new Map<string, ClassInvite>();
  for (const d of cloudInvSnap.docs) {
    cloudInviteMap.set(d.id, d.data() as ClassInvite);
  }

  const cloudTombSet = new Set<string>();
  for (const d of cloudTombSnap.docs) {
    const t = d.data() as DeletionTombstone;
    if (t.collectionName === 'classInvites' && t.documentId) {
      cloudTombSet.add(t.documentId);
    }
  }

  const store = getHybridStore();
  const localTombSet = buildTombstoneSet(store.tombstones || [], 'classInvites');
  const inviteQueueItems = (store.syncQueue || []).filter(
    (q) => q.collectionName === 'classInvites'
  );

  const candidates = new Map<string, ClassInvite>();
  const deletedIds = new Set<string>();
  for (const q of inviteQueueItems) {
    if (q.action === 'delete') {
      await withFastFirestoreTimeout(() => deleteDoc(doc(db, 'classInvites', q.documentId)), 8000).catch(
        () => {}
      );
      deletedIds.add(q.documentId);
      continue;
    }
    if (q.payload && !localTombSet.has(q.documentId) && !cloudTombSet.has(q.documentId)) {
      candidates.set(q.documentId, q.payload as ClassInvite);
    }
  }

  for (const inv of store.classInvites || []) {
    if (localTombSet.has(inv.id) || cloudTombSet.has(inv.id)) continue;
    const cloudExisting = cloudInviteMap.get(inv.id);
    const needsSync =
      !cloudExisting ||
      cloudExisting.active !== inv.active ||
      getInviteTargetRole(cloudExisting) !== getInviteTargetRole(inv) ||
      getInviteDisplayLabel(cloudExisting) !== getInviteDisplayLabel(inv);
    if (needsSync && !candidates.has(inv.id)) {
      candidates.set(inv.id, inv);
    }
  }

  let syncedCount = 0;
  const succeededIds = new Set<string>(deletedIds);

  for (const [docId, inv] of candidates.entries()) {
    const cleanInv = { ...(inv as unknown as Record<string, unknown>) };
    delete cleanInv.createdAt;
    delete cleanInv.updatedAt;
    const normalizedRole = getInviteTargetRole(inv);
    const normalizedLabel = getInviteDisplayLabel(inv);
    const ref = doc(db, 'classInvites', docId);
    const cloudExisting = cloudInviteMap.get(docId);

    try {
      await withFastFirestoreTimeout(async () => {
        if (cloudExisting) {
          await setDoc(
            ref,
            {
              ...cleanInv,
              role: normalizedRole,
              memberLabel: normalizedLabel,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          await setDoc(ref, {
            ...cleanInv,
            role: normalizedRole,
            memberLabel: normalizedLabel,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }, 8000);
    } catch (err) {
      if (isTrueQuotaError(err)) {
        markQuotaExceeded(true);
      }
      throw err;
    }

    succeededIds.add(docId);
    syncedCount++;
  }

  const updatedStore = saveHybridStore((prev) => ({
    ...prev,
    syncQueue: (prev.syncQueue || []).filter(
      (q) =>
        !(
          q.collectionName === 'classInvites' &&
          (succeededIds.has(q.documentId) || cloudTombSet.has(q.documentId) || localTombSet.has(q.documentId))
        )
    ),
  }));

  const remainingCount = (updatedStore.syncQueue || []).filter(
    (q) => q.collectionName === 'classInvites'
  ).length;

  return { syncedCount, remainingCount };
}

/**
 * Passwordless Member Entry by Share Link / Code (Không cần đăng nhập Google)
 */
export async function resolveInviteLinkSession(codeOrUrl: string): Promise<ClassInvite> {
  const code = extractInviteCodeFromText(codeOrUrl);
  if (!code || code.length < 4) {
    throw new Error('Mã hoặc đường dẫn truy cập không hợp lệ. Vui lòng kiểm tra lại.');
  }

  const vnNow = getVietnamDateParts(new Date());
  const localStore = getHybridStore();
  const invTombId = getTombstoneId('classInvites', code);
  const isLocallyTombstoned = (localStore.tombstones || []).some(
    (t) =>
      t.id === invTombId ||
      (t.collectionName === 'classInvites' && t.documentId === code)
  );
  if (isLocallyTombstoned) {
    throw new Error(
      `Liên kết / mã "${code}" đã bị Quản trị viên thu hồi hoặc xóa. Vui lòng xin mã mới.`
    );
  }

  const localInvite = (localStore.classInvites || []).find(
    (i) => i.code === code || i.id === code
  );
  let invite: ClassInvite | null = null;
  let cloudNetworkTimedOut = false;

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (!isBrowserOffline) {
    // Always re-enable Firestore network and clear stale non-quota latches when resolving an entry link
    if (localStore.quotaExceeded) {
      markQuotaExceeded(false);
    } else {
      await setFirestoreNetworkEnabled(true);
    }

    try {
      const [cloudInvSnap, cloudTombSnap] = await Promise.race([
        Promise.all([
          getDoc(doc(db, 'classInvites', code)),
          getDoc(doc(db, 'deletionTombstones', invTombId)),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('FIRESTORE_WRITE_TIMEOUT')), 10000)
        ),
      ]);

      if (cloudTombSnap.exists() && !cloudInvSnap.exists()) {
        throw new Error(
          `Liên kết / mã "${code}" đã bị Quản trị viên thu hồi. Vui lòng liên hệ Quản trị viên.`
        );
      }

      if (cloudInvSnap.exists()) {
        invite = cloudInvSnap.data() as ClassInvite;
      }
    } catch (err) {
      if (isQuotaOrTimeoutError(err)) {
        if (isTrueQuotaError(err)) {
          markQuotaExceeded(true);
        }
        cloudNetworkTimedOut = true;
        invite = localInvite || null;
      } else {
        throw err;
      }
    }
  } else {
    cloudNetworkTimedOut = true;
    invite = localInvite || null;
  }

  if (!invite) {
    if (cloudNetworkTimedOut) {
      throw new Error(
        `Kết nối máy chủ bị gián đoạn khi mở mã "${code}". Vui lòng kiểm tra 4G/WiFi và bấm Thử lại.`
      );
    }
    throw new Error(
      `Không tìm thấy mã hoặc link "${code}". Vui lòng kiểm tra lại hoặc nhờ Quản trị viên đồng bộ & gửi lại link mới.`
    );
  }

  if (!invite.active) {
    const label = getInviteDisplayLabel(invite);
    throw new Error(
      `Đường dẫn / mã "${code}" (${label}) hiện đang bị Quản trị viên tạm khóa.`
    );
  }

  const normalizedInvite: ClassInvite = {
    ...invite,
    role: getInviteTargetRole(invite),
    memberLabel: getInviteDisplayLabel(invite),
    usageCount: (invite.usageCount || 0) + 1,
    lastUsedByEmail: 'Truy cập theo link',
    lastUsedAtIso: vnNow.fullDisplay,
    updatedAtIso: vnNow.fullDisplay,
  };

  saveHybridStore((prev) => ({
    ...prev,
    classInvites: [
      ...(prev.classInvites || []).filter((i) => i.id !== normalizedInvite.id),
      normalizedInvite,
    ],
  }));

  if (canWriteToCloudFirestore()) {
    // Non-blocking best-effort usage counter increment
    void withFastFirestoreTimeout(
      () =>
        updateDoc(doc(db, 'classInvites', normalizedInvite.id), {
          usageCount: normalizedInvite.usageCount,
          lastUsedByEmail: 'Truy cập theo link',
          lastUsedAtIso: vnNow.fullDisplay,
          updatedAtIso: vnNow.fullDisplay,
          updatedAt: serverTimestamp(),
        }),
      5000
    ).catch(() => {
      // ignore non-critical counter errors
    });
  }

  return normalizedInvite;
}

export async function redeemClassInviteCode(params: {
  codeOrUrl: string;
  uid: string;
  email: string;
  displayName: string;
}): Promise<{ invite: ClassInvite; profile: UserProfile; access: AccountAccess }> {
  const code = extractInviteCodeFromText(params.codeOrUrl);
  if (!code || code.length < 4) {
    throw new Error('Mã chia sẻ lớp không hợp lệ. Vui lòng nhập đúng mã do Quản trị viên cung cấp.');
  }

  const cleanEmail = sanitizeString(params.email.toLowerCase(), 256);
  const emailKey = normalizeEmailKey(cleanEmail);
  const vnNow = getVietnamDateParts(new Date());
  const localStore = getHybridStore();

  // Security check: Never allow blocked/locked/suspended/revoked/deleted accounts to self-activate via invite
  const accTombId = getTombstoneId('accountAccess', emailKey);
  const localBlockedTomb = (localStore.tombstones || []).some(
    (t) => t.id === accTombId || (t.collectionName === 'accountAccess' && t.documentId === emailKey)
  );
  const localAcc = (localStore.accountAccess || []).find((a) => a.id === emailKey);
  if (
    localBlockedTomb ||
    (localAcc && (localAcc.status === 'locked' || localAcc.status === 'suspended' || localAcc.status === 'revoked'))
  ) {
    throw new Error(
      'Tài khoản này đang bị khóa, thu hồi hoặc đã bị xóa khỏi hệ thống. Không thể dùng mã lớp để tự mở khóa.'
    );
  }

  let invite: ClassInvite | null = null;
  const localInvite = (localStore.classInvites || []).find((i) => i.code === code || i.id === code);

  if (canWriteToCloudFirestore()) {
    try {
      const [cloudAccSnap, cloudTombSnap, cloudInvSnap] = await withFastFirestoreTimeout(
        () =>
          Promise.all([
            getDoc(doc(db, 'accountAccess', emailKey)),
            getDoc(doc(db, 'deletionTombstones', accTombId)),
            getDoc(doc(db, 'classInvites', code)),
          ]),
        2500
      );

      if (cloudTombSnap.exists() && !cloudAccSnap.exists()) {
        throw new Error('Tài khoản đã bị Quản trị viên xóa. Không thể kích hoạt bằng mã chia sẻ.');
      }
      if (cloudAccSnap.exists()) {
        const cloudAccData = cloudAccSnap.data() as AccountAccess;
        if (
          cloudAccData.status === 'locked' ||
          cloudAccData.status === 'suspended' ||
          cloudAccData.status === 'revoked'
        ) {
          throw new Error(
            'Tài khoản đang bị khóa hoặc thu hồi quyền bởi Quản trị viên. Không thể kích hoạt lại bằng mã lớp.'
          );
        }
      }

      if (cloudInvSnap.exists()) {
        invite = cloudInvSnap.data() as ClassInvite;
      }
    } catch (err) {
      if (isQuotaOrTimeoutError(err)) {
        if (isTrueQuotaError(err)) {
          markQuotaExceeded(true);
        }
        invite = localInvite || null;
      } else {
        throw err;
      }
    }
  } else {
    invite = localInvite || null;
  }

  if (!invite) {
    throw new Error(
      `Không tìm thấy mã chia sẻ lớp "${code}". Vui lòng kiểm tra lại mã hoặc liên hệ Quản trị viên.`
    );
  }

  if (!invite.active) {
    throw new Error(
      `Mã chia sẻ "${code}" (${getInviteDisplayLabel(invite)}) hiện đang bị tạm khóa. Vui lòng liên hệ Quản trị viên.`
    );
  }

  const targetRole = getInviteTargetRole(invite);
  const resolvedAssignedClassId = targetRole === 'teacher' ? invite.classId : '';

  const profilePayload: UserProfile = {
    uid: params.uid,
    email: cleanEmail,
    displayName: sanitizeString(params.displayName, 120, cleanEmail),
    role: targetRole,
    status: 'active',
    assignedClassId: resolvedAssignedClassId,
    linkedStudentId: '',
    joinedInviteCode: invite.code,
    lastLoginAtIso: vnNow.fullDisplay,
    schoolId: SCHOOL_ID,
  };

  const accessPayload: AccountAccess = {
    id: emailKey,
    email: cleanEmail,
    displayName: profilePayload.displayName,
    role: targetRole,
    status: 'active',
    assignedClassId: resolvedAssignedClassId,
    joinedInviteCode: invite.code,
    uid: params.uid,
    lastLoginAtIso: vnNow.fullDisplay,
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: params.uid,
  };

  const updatedInvite: ClassInvite = {
    ...invite,
    role: targetRole,
    memberLabel: getInviteDisplayLabel(invite),
    usageCount: (invite.usageCount || 0) + 1,
    lastUsedByEmail: cleanEmail,
    lastUsedAtIso: vnNow.fullDisplay,
    updatedAtIso: vnNow.fullDisplay,
  };

  saveHybridStore((prev) => ({
    ...prev,
    accountAccess: [...(prev.accountAccess || []).filter((a) => a.id !== emailKey), accessPayload],
    classInvites: [...(prev.classInvites || []).filter((i) => i.id !== updatedInvite.id), updatedInvite],
  }));

  if (!canWriteToCloudFirestore()) {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'users',
      documentId: params.uid,
      payload: profilePayload,
    });
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'accountAccess',
      documentId: emailKey,
      payload: accessPayload,
    });
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'classInvites',
      documentId: updatedInvite.id,
      payload: updatedInvite,
    });
    return { invite: updatedInvite, profile: profilePayload, access: accessPayload };
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const userRef = doc(db, 'users', params.uid);
      const accessRef = doc(db, 'accountAccess', emailKey);
      const inviteRef = doc(db, 'classInvites', updatedInvite.id);
      const [userSnap, accessSnap] = await Promise.all([getDoc(userRef), getDoc(accessRef)]);

      if (userSnap.exists()) {
        await updateDoc(userRef, {
          role: targetRole,
          status: 'active',
          assignedClassId: resolvedAssignedClassId,
          joinedInviteCode: invite!.code,
          displayName: profilePayload.displayName,
          lastLoginAtIso: vnNow.fullDisplay,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(userRef, {
          ...profilePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (accessSnap.exists()) {
        await updateDoc(accessRef, {
          uid: params.uid,
          role: targetRole,
          status: 'active',
          assignedClassId: resolvedAssignedClassId,
          joinedInviteCode: invite!.code,
          lastLoginAtIso: vnNow.fullDisplay,
          updatedByUid: params.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(accessRef, {
          ...accessPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await updateDoc(inviteRef, {
        usageCount: updatedInvite.usageCount,
        lastUsedByEmail: updatedInvite.lastUsedByEmail,
        lastUsedAtIso: updatedInvite.lastUsedAtIso,
        updatedAtIso: updatedInvite.updatedAtIso,
        updatedAt: serverTimestamp(),
      });
    }, 3000);
  } catch (error) {
    if (isQuotaOrTimeoutError(error)) {
      if (isTrueQuotaError(error)) {
        markQuotaExceeded(true);
      }
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'users',
        documentId: params.uid,
        payload: profilePayload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'accountAccess',
        documentId: emailKey,
        payload: accessPayload,
      });
      return { invite: updatedInvite, profile: profilePayload, access: accessPayload };
    }
    handleFirestoreError(error, OperationType.WRITE, `classInvites/${updatedInvite.id}`);
  }

  return { invite: updatedInvite, profile: profilePayload, access: accessPayload };
}

export function exportDailyReportToExcel(params: {
  date: string;
  month?: string;
  report: DailyReport | null;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  allRegistrations?: MealRegistration[];
  logs: RegistrationLog[];
  env?: AppEnvironment;
}): void {
  const env = params.env || 'production';
  const summary = computeSchoolSummaries(
    params.classes,
    params.students,
    params.registrations,
    env
  );
  const wb = XLSX.utils.book_new();

  // Sheet 1: School Overview
  const overviewRows = [
    ['TRƯỜNG THCS ĐÔNG THẠNH'],
    ['BẢNG TỔNG HỢP SUẤT ĂN BÁN TRÚ TOÀN TRƯỜNG'],
    [`Ngày phục vụ: ${formatVietnameseDate(params.date)}`],
    [
      `Trạng thái chốt sổ: ${
        params.report?.isLocked
          ? `ĐÃ CHỐT CHÍNH THỨC (${params.report.lockedAtIso})`
          : 'ĐANG MỞ XÁC NHẬN (CHƯA KHÓA SỔ)'
      }`,
    ],
    [],
    ['CHỈ TIÊU THỐNG KÊ', 'SỐ LƯỢNG', 'GHI CHÚ'],
    ['Tổng số học sinh toàn trường', summary.totalStudents, 'Học sinh đang tham gia'],
    ['Tổng số học sinh đã đăng ký (Có ăn + Không ăn)', summary.totalEating + summary.totalNotEating, ''],
    ['TỔNG SỐ HỌC SINH CÓ ĂN TRONG NGÀY', summary.totalEating, 'Số suất ăn chính thức'],
    ['Tổng số học sinh KHÔNG ĂN', summary.totalNotEating, 'Đã xác nhận không ăn'],
    ['Tổng số học sinh CHƯA XÁC NHẬN', summary.totalUnregistered, 'Chưa có xác nhận của GVCN'],
    [
      'Số lần điều chỉnh sau khóa sổ 08:00',
      params.report?.adjustmentCount || 0,
      'Chỉ Quản trị viên được điều chỉnh có lý do',
    ],
    [],
    ['THỐNG KÊ THEO KHỐI', 'SỐ LỚP', 'SĨ SỐ', 'CÓ ĂN', 'KHÔNG ĂN', 'CHƯA XÁC NHẬN'],
    ...summary.grades.map((g) => [
      `Khối ${g.grade}`,
      g.classCount,
      g.totalStudents,
      g.eatingCount,
      g.notEatingCount,
      g.unregisteredCount,
    ]),
    [
      'TỔNG CỘNG 4 KHỐI',
      summary.allClassRows.length,
      summary.totalStudents,
      summary.totalEating,
      summary.totalNotEating,
      summary.totalUnregistered,
    ],
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Tong_Hop_Ngay');

  // Sheet 2: Class Summary
  const classHeader = [
    ['TRƯỜNG THCS ĐÔNG THẠNH'],
    ['BẢNG THỐNG KÊ SUẤT ĂN THEO TỪNG LỚP'],
    [`Ngày: ${formatVietnameseDate(params.date)}`],
    [],
    ['STT', 'Khối', 'Lớp', 'Sĩ số', 'Có ăn', 'Không ăn', 'Chưa xác nhận', 'Giáo viên chủ nhiệm'],
  ];
  const classBody: (string | number)[][] = [];
  let stt = 1;
  for (const g of summary.grades) {
    for (const c of g.classes) {
      classBody.push([
        stt++,
        c.classObj.grade,
        c.classObj.name,
        c.totalStudents,
        c.eatingCount,
        c.notEatingCount,
        c.unregisteredCount,
        c.classObj.teacherName,
      ]);
    }
  }
  const wsClasses = XLSX.utils.aoa_to_sheet([...classHeader, ...classBody]);
  XLSX.utils.book_append_sheet(wb, wsClasses, 'Thong_Ke_Theo_Lop');

  // Sheet 3: Eating & Not Eating & Unconfirmed Students
  const studentRows: (string | number)[][] = [
    ['DANH SÁCH CHI TIẾT TRẠNG THÁI ĂN CỦA HỌC SINH'],
    [`Ngày: ${formatVietnameseDate(params.date)}`],
    [],
    ['STT', 'Khối', 'Lớp', 'Mã HS', 'Họ và tên', 'Trạng thái', 'Người xác nhận', 'Thời gian'],
  ];
  let stuStt = 1;
  for (const c of summary.allClassRows) {
    for (const item of c.eatingStudents) {
      studentRows.push([
        stuStt++,
        c.classObj.grade,
        c.classObj.name,
        item.student.studentCode,
        item.student.fullName,
        'CÓ ĂN',
        item.registration.updatedByName,
        item.registration.updatedAtIso,
      ]);
    }
    for (const item of c.notEatingStudents) {
      studentRows.push([
        stuStt++,
        c.classObj.grade,
        c.classObj.name,
        item.student.studentCode,
        item.student.fullName,
        'KHÔNG ĂN',
        item.registration.updatedByName,
        item.registration.updatedAtIso,
      ]);
    }
    for (const stu of c.unregisteredStudents) {
      studentRows.push([
        stuStt++,
        c.classObj.grade,
        c.classObj.name,
        stu.studentCode,
        stu.fullName,
        'CHƯA XÁC NHẬN',
        '',
        '',
      ]);
    }
  }
  const wsStudents = XLSX.utils.aoa_to_sheet(studentRows);
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Chi_Tiet_Hoc_Sinh');

  // Sheet 4: Monthly Stats (if allRegistrations provided)
  const targetMonth = params.month || params.date.slice(0, 7);
  const allRegs = params.allRegistrations || params.registrations;
  const monthRegs = allRegs.filter((r) => r.env === env && r.date.startsWith(targetMonth));
  const dateSet = Array.from(new Set(monthRegs.map((r) => r.date))).sort();
  const monthRows: (string | number)[][] = [
    [`THỐNG KÊ SUẤT ĂN THÁNG ${targetMonth}`],
    [],
    ['Ngày', 'Có ăn', 'Không ăn', 'Chưa xác nhận', 'Khối 6 ăn', 'Khối 7 ăn', 'Khối 8 ăn', 'Khối 9 ăn'],
  ];
  let totalMonthEating = 0;
  for (const d of dateSet) {
    const dayRegs = monthRegs.filter((r) => r.date === d);
    const daySum = computeSchoolSummaries(params.classes, params.students, dayRegs, env);
    totalMonthEating += daySum.totalEating;
    monthRows.push([
      formatVietnameseDate(d),
      daySum.totalEating,
      daySum.totalNotEating,
      daySum.totalUnregistered,
      daySum.grade6Eating,
      daySum.grade7Eating,
      daySum.grade8Eating,
      daySum.grade9Eating,
    ]);
  }
  monthRows.push(['TỔNG SUẤT ĂN TRONG THÁNG', totalMonthEating, '', '', '', '', '', '']);
  const wsMonth = XLSX.utils.aoa_to_sheet(monthRows);
  XLSX.utils.book_append_sheet(wb, wsMonth, 'Thong_Ke_Thang');

  // Sheet 5: Audit Logs
  const dayLogs = params.logs.filter((l) => l.env === env && l.date === params.date);
  const logRows: (string | number)[][] = [
    ['NHẬT KÝ LỊCH SỬ THAY ĐỔI DỮ LIỆU'],
    [`Ngày: ${formatVietnameseDate(params.date)}`],
    [],
    ['Thời gian', 'Lớp', 'Học sinh', 'Trước', 'Sau', 'Người thực hiện', 'Vai trò', 'Ghi chú'],
    ...dayLogs.map((l) => [
      l.timestampIso,
      l.className,
      l.studentName,
      l.previousStatus,
      l.newStatus,
      l.actorName,
      l.actorRole,
      l.reason,
    ]),
  ];
  const wsLogs = XLSX.utils.aoa_to_sheet(logRows);
  XLSX.utils.book_append_sheet(wb, wsLogs, 'Lich_Su_Thay_Doi');

  XLSX.writeFile(wb, `BaoCao_BanTru_THCS_DongThanh_${params.date}.xlsx`);
}

export function exportFullBackupJson(data: {
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  reports: DailyReport[];
  logs: RegistrationLog[];
  accountAccess?: AccountAccess[];
  archivedYears?: ArchivedYearSnapshot[];
}): void {
  const payload = {
    school: 'Trường THCS Đông Thạnh',
    exportedAt: getVietnamDateParts().fullDisplay,
    ...data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SaoLuu_BanTru_THCS_DongThanh_${getVietnamDateParts().dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importBackupJsonData(rawJson: string): {
  classesCount: number;
  studentsCount: number;
  registrationsCount: number;
  reportsCount: number;
  logsCount: number;
} {
  const parsed = JSON.parse(rawJson);
  if (!parsed || !Array.isArray(parsed.classes) || !Array.isArray(parsed.students)) {
    throw new Error('File JSON không đúng định dạng sao lưu của hệ thống bán trú THCS Đông Thạnh.');
  }

  let restoredCounts = {
    classesCount: 0,
    studentsCount: 0,
    registrationsCount: 0,
    reportsCount: 0,
    logsCount: 0,
  };

  saveHybridStore((prev) => {
    const incomingTombstones = Array.isArray(parsed.tombstones)
      ? (parsed.tombstones as DeletionTombstone[])
      : [];
    const activeTombstones = mergeTombstones(prev.tombstones || [], incomingTombstones);

    const safeClasses = filterOutTombstoned<SchoolClass>(parsed.classes || [], 'classes', activeTombstones);
    const safeStudents = filterOutTombstoned<Student>(parsed.students || [], 'students', activeTombstones);
    const safeRegs = filterOutTombstoned<MealRegistration>(
      parsed.registrations || [],
      'registrations',
      activeTombstones
    );
    const safeReports = filterOutTombstoned<DailyReport>(
      parsed.reports || [],
      'dailyReports',
      activeTombstones
    );
    const safeAccounts = filterOutTombstoned<AccountAccess>(
      parsed.accountAccess || [],
      'accountAccess',
      activeTombstones
    );
    const safeArchives = filterOutTombstoned<ArchivedYearSnapshot>(
      parsed.archivedYears || [],
      'archivedYears',
      activeTombstones
    );

    restoredCounts = {
      classesCount: safeClasses.length,
      studentsCount: safeStudents.length,
      registrationsCount: safeRegs.length,
      reportsCount: safeReports.length,
      logsCount: Array.isArray(parsed.logs) ? parsed.logs.length : 0,
    };

    const mergeArr = <T extends { id: string }>(base: T[], incoming: T[] = []) => {
      const map = new Map<string, T>();
      for (const x of base) map.set(x.id, x);
      for (const x of incoming) map.set(x.id, x);
      return Array.from(map.values());
    };

    return applyTombstonesToStore(
      {
        ...prev,
        tombstones: activeTombstones,
        classes: mergeArr(prev.classes, safeClasses),
        students: mergeArr(prev.students, safeStudents),
        registrations: mergeArr(prev.registrations, safeRegs),
        reports: mergeArr(prev.reports, safeReports),
        logs: mergeArr(prev.logs, parsed.logs || []),
        accountAccess: mergeArr(prev.accountAccess, safeAccounts),
        archivedYears: mergeArr(prev.archivedYears, safeArchives),
      },
      activeTombstones
    );
  });

  return restoredCounts;
}

/**
 * Full Bidirectional Anti-Resurrection Sync Engine:
 * 1. Pulls /deletionTombstones from Firestore FIRST and purges any matching local cache / stale queued upserts.
 * 2. Flushes pending queue (deletes & tombstones before upserts).
 * 3. Enforces any local tombstones onto Firestore (deleting any lingering docs).
 * 4. Pulls authoritative Cloud state and reconciles localStore so Cloud removals immediately clean local cache.
 */
export async function performFullBidirectionalSync(): Promise<{
  syncedQueueCount: number;
  enforcedTombstonesCount: number;
  activeStudentsCount: number;
  activeAccountsCount: number;
  activeTombstonesCount: number;
}> {
  markQuotaExceeded(false);
  await setFirestoreNetworkEnabled(true);
  const schoolFilter = [
    where('schoolId', '==', SCHOOL_ID),
    where('visibility', '==', 'school'),
  ];

  // 1. Pull cloud tombstones FIRST before pushing or merging any collection
  const cloudTombSnap = await withFastFirestoreTimeout(
    () => getDocs(query(collection(db, 'deletionTombstones'), ...schoolFilter)),
    8000
  );
  const cloudTombstones = cloudTombSnap.docs.map((d) => d.data() as DeletionTombstone);

  // Immediately enforce cloud tombstones onto localStore & purge blocked queued upserts
  saveHybridStore((prev) => applyTombstonesToStore(prev, cloudTombstones));

  // 2. Flush pending syncQueue (tombstones + deletes execute before upserts)
  const syncedQueueCount = await flushSyncQueueToFirestore();

  // 3. Enforce any local production tombstones that haven't reached Firestore yet (Google Admin sessions only)
  const hasGoogleAuth = Boolean(auth.currentUser);
  const currentStore = getHybridStore();
  const cloudTombIdSet = new Set(cloudTombstones.map((t) => t.id));
  const localOnlyProdTombs = (currentStore.tombstones || []).filter(
    (t) => t.env === 'production' && !cloudTombIdSet.has(t.id)
  );

  let enforcedTombstonesCount = 0;
  if (hasGoogleAuth && localOnlyProdTombs.length > 0) {
    for (let i = 0; i < localOnlyProdTombs.length; i += 170) {
      const chunk = localOnlyProdTombs.slice(i, i + 170);
      const batch = writeBatch(db);
      for (const tomb of chunk) {
        batch.set(
          doc(db, 'deletionTombstones', tomb.id),
          {
            ...tomb,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        batch.delete(doc(db, tomb.collectionName, tomb.documentId));
        enforcedTombstonesCount++;
      }
      await withFastFirestoreTimeout(() => batch.commit(), 8000);
    }
  }

  // 4. Fetch authoritative Cloud collections and reconcile cleanly (never resurrecting deleted data)
  const [
    classesSnap,
    studentsSnap,
    regsSnap,
    reportsSnap,
    logsSnap,
    accountsSnap,
    archivesSnap,
    groupsSnap,
    invitesSnap,
    settingsSnap,
    finalTombSnap,
    pricingRulesSnap,
    pricingLogsSnap,
    billingConfigsSnap,
    paymentsSnap,
    paymentLogsSnap,
    settlementsSnap,
  ] = await withFastFirestoreTimeout(
    () =>
      Promise.all([
        getDocs(query(collection(db, 'classes'), ...schoolFilter)),
        getDocs(query(collection(db, 'students'), ...schoolFilter)),
        getDocs(query(collection(db, 'registrations'), ...schoolFilter)),
        getDocs(query(collection(db, 'dailyReports'), ...schoolFilter)),
        getDocs(query(collection(db, 'registrationLogs'), ...schoolFilter)),
        hasGoogleAuth
          ? getDocs(query(collection(db, 'accountAccess'), ...schoolFilter)).catch(() => null)
          : Promise.resolve(null),
        getDocs(query(collection(db, 'archivedYears'), ...schoolFilter)),
        getDocs(query(collection(db, 'permissionGroups'), ...schoolFilter)),
        hasGoogleAuth
          ? getDocs(query(collection(db, 'classInvites'), ...schoolFilter)).catch(() => null)
          : Promise.resolve(null),
        getDocs(query(collection(db, 'settings'), ...schoolFilter)),
        getDocs(query(collection(db, 'deletionTombstones'), ...schoolFilter)),
        getDocs(query(collection(db, 'mealPricingRules'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealPricingLogs'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealBillingConfigs'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealPayments'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealPaymentLogs'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'monthlySettlements'), ...schoolFilter)).catch(() => null),
      ]),
    15000
  );

  const freshCloudTombstones = finalTombSnap.docs.map((d) => d.data() as DeletionTombstone);

  const pushedInviteIds = new Set<string>();
  // If Admin has local classInvites that haven't reached Cloud yet (or have active/role diffs while not tombstoned), push them now!
  if (hasGoogleAuth && invitesSnap) {
    const cloudInviteMap = new Map<string, ClassInvite>();
    for (const d of invitesSnap.docs) {
      cloudInviteMap.set(d.id, d.data() as ClassInvite);
    }
    const freshTombSet = new Set(
      freshCloudTombstones
        .filter((t) => t.collectionName === 'classInvites')
        .map((t) => t.documentId)
    );
    const queuedInviteIdSet = new Set(
      (getHybridStore().syncQueue || [])
        .filter((q) => q.collectionName === 'classInvites' && q.action !== 'delete')
        .map((q) => q.documentId)
    );
    const pendingLocalInvites = (getHybridStore().classInvites || []).filter((inv) => {
      if (freshTombSet.has(inv.id)) return false;
      const cloudExisting = cloudInviteMap.get(inv.id);
      if (!cloudExisting) return true;
      return (
        queuedInviteIdSet.has(inv.id) &&
        (cloudExisting.active !== inv.active ||
          getInviteTargetRole(cloudExisting) !== getInviteTargetRole(inv) ||
          getInviteDisplayLabel(cloudExisting) !== getInviteDisplayLabel(inv))
      );
    });
    if (pendingLocalInvites.length > 0) {
      for (const inv of pendingLocalInvites) {
        try {
          const cleanInv = { ...(inv as unknown as Record<string, unknown>) };
          delete cleanInv.createdAt;
          delete cleanInv.updatedAt;
          const existsOnCloud = cloudInviteMap.has(inv.id);
          await withFastFirestoreTimeout(async () => {
            if (existsOnCloud) {
              await setDoc(
                doc(db, 'classInvites', inv.id),
                {
                  ...cleanInv,
                  role: getInviteTargetRole(inv),
                  memberLabel: getInviteDisplayLabel(inv),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            } else {
              await setDoc(doc(db, 'classInvites', inv.id), {
                ...cleanInv,
                role: getInviteTargetRole(inv),
                memberLabel: getInviteDisplayLabel(inv),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }, 8000);
          pushedInviteIds.add(inv.id);
          if (!existsOnCloud) {
            invitesSnap.docs.push({
              id: inv.id,
              data: () => inv,
            } as unknown as (typeof invitesSnap.docs)[number]);
          }
        } catch {
          // keep queued or local if transient write error
        }
      }
    }
  }

  const reconciled = saveHybridStore((prev) => {
    const allTombs = mergeTombstones(prev.tombstones || [], freshCloudTombstones);
    const cloudClasses = classesSnap.docs.map((d) => d.data() as SchoolClass);
    const cloudStudents = studentsSnap.docs.map((d) => d.data() as Student);
    const cloudRegs = regsSnap.docs.map((d) => d.data() as MealRegistration);
    const cloudReports = reportsSnap.docs.map((d) => d.data() as DailyReport);
    const cloudLogs = logsSnap.docs.map((d) => d.data() as RegistrationLog);
    const cloudAccounts = accountsSnap ? accountsSnap.docs.map((d) => d.data() as AccountAccess) : [];
    const cloudArchives = archivesSnap.docs.map((d) => d.data() as ArchivedYearSnapshot);
    const cloudGroups = groupsSnap.docs.map((d) => d.data() as PermissionGroup);
    const cloudInvites = invitesSnap ? invitesSnap.docs.map((d) => d.data() as ClassInvite) : [];
    const cloudSetting = settingsSnap.docs[0]?.data() as SchoolSetting | undefined;
    const cloudPricingRules = pricingRulesSnap
      ? pricingRulesSnap.docs.map((d) => d.data() as MealPricingRule)
      : [];
    const cloudPricingLogs = pricingLogsSnap
      ? pricingLogsSnap.docs.map((d) => d.data() as MealPricingLog)
      : [];
    const cloudBillingConfigs = billingConfigsSnap
      ? billingConfigsSnap.docs.map((d) => d.data() as MealBillingConfig)
      : [];
    const cloudPayments = paymentsSnap
      ? paymentsSnap.docs.map((d) => d.data() as MealPayment)
      : [];
    const cloudPaymentLogs = paymentLogsSnap
      ? paymentLogsSnap.docs.map((d) => d.data() as MealPaymentLog)
      : [];
    const cloudSettlements = settlementsSnap
      ? settlementsSnap.docs.map((d) => d.data() as MonthlySettlement)
      : [];

    const mergedLogsMap = new Map<string, RegistrationLog>();
    for (const l of prev.logs || []) mergedLogsMap.set(l.id, l);
    for (const l of cloudLogs) mergedLogsMap.set(l.id, l);

    const mergedPricingLogsMap = new Map<string, MealPricingLog>();
    for (const l of prev.mealPricingLogs || []) mergedPricingLogsMap.set(l.id, l);
    for (const l of cloudPricingLogs) mergedPricingLogsMap.set(l.id, l);

    const mergedPaymentLogsMap = new Map<string, MealPaymentLog>();
    for (const l of prev.mealPaymentLogs || []) mergedPaymentLogsMap.set(l.id, l);
    for (const l of cloudPaymentLogs) mergedPaymentLogsMap.set(l.id, l);

    const mergedBillingConfigsMap = new Map<string, MealBillingConfig>();
    for (const c of prev.mealBillingConfigs || []) mergedBillingConfigsMap.set(c.id, c);
    for (const c of cloudBillingConfigs) mergedBillingConfigsMap.set(c.id, c);

    const baseGroups = prev.permissionGroups || getDefaultPermissionGroups();
    const mergedGroups =
      cloudGroups.length > 0
        ? baseGroups.map((def) => cloudGroups.find((g) => g.id === def.id) || def)
        : baseGroups;

    return applyTombstonesToStore(
      {
        ...prev,
        tombstones: allTombs,
        classes:
          cloudClasses.length > 0
            ? reconcileCollectionWithCloud({
                collectionName: 'classes',
                cloudItems: cloudClasses,
                cloudReady: true,
                localItems: prev.classes,
                tombstones: allTombs,
                syncQueue: prev.syncQueue,
                preserveSandbox: true,
              })
            : prev.classes,
        students: reconcileCollectionWithCloud({
          collectionName: 'students',
          cloudItems: cloudStudents,
          cloudReady: true,
          localItems: prev.students,
          tombstones: allTombs,
          syncQueue: prev.syncQueue,
          preserveSandbox: true,
        }),
        registrations: reconcileCollectionWithCloud({
          collectionName: 'registrations',
          cloudItems: cloudRegs,
          cloudReady: true,
          localItems: prev.registrations,
          tombstones: allTombs,
          syncQueue: prev.syncQueue,
          preserveSandbox: true,
        }),
        reports: reconcileCollectionWithCloud({
          collectionName: 'dailyReports',
          cloudItems: cloudReports,
          cloudReady: true,
          localItems: prev.reports,
          tombstones: allTombs,
          syncQueue: prev.syncQueue,
          preserveSandbox: true,
        }),
        accountAccess: accountsSnap
          ? reconcileCollectionWithCloud({
              collectionName: 'accountAccess',
              cloudItems: cloudAccounts,
              cloudReady: true,
              localItems: prev.accountAccess,
              tombstones: allTombs,
              syncQueue: prev.syncQueue,
            })
          : prev.accountAccess,
        archivedYears: reconcileCollectionWithCloud({
          collectionName: 'archivedYears',
          cloudItems: cloudArchives,
          cloudReady: true,
          localItems: prev.archivedYears,
          tombstones: allTombs,
          syncQueue: prev.syncQueue,
          preserveSandbox: true,
        }),
        classInvites: invitesSnap
          ? reconcileCollectionWithCloud({
              collectionName: 'classInvites',
              cloudItems: cloudInvites,
              cloudReady: true,
              localItems: prev.classInvites || [],
              tombstones: allTombs,
              syncQueue: prev.syncQueue,
            })
          : prev.classInvites || [],
        mealPricingRules: pricingRulesSnap
          ? reconcileCollectionWithCloud({
              collectionName: 'mealPricingRules',
              cloudItems: cloudPricingRules,
              cloudReady: true,
              localItems: prev.mealPricingRules || [],
              tombstones: allTombs,
              syncQueue: prev.syncQueue,
              preserveSandbox: true,
            })
          : prev.mealPricingRules || [],
        mealPricingLogs: Array.from(mergedPricingLogsMap.values()),
        mealBillingConfigs: Array.from(mergedBillingConfigsMap.values()),
        mealPayments: paymentsSnap
          ? reconcileCollectionWithCloud({
              collectionName: 'mealPayments',
              cloudItems: cloudPayments,
              cloudReady: true,
              localItems: prev.mealPayments || [],
              tombstones: allTombs,
              syncQueue: prev.syncQueue,
              preserveSandbox: true,
            })
          : prev.mealPayments || [],
        mealPaymentLogs: Array.from(mergedPaymentLogsMap.values()),
        monthlySettlements: settlementsSnap
          ? reconcileCollectionWithCloud({
              collectionName: 'monthlySettlements',
              cloudItems: cloudSettlements,
              cloudReady: true,
              localItems: prev.monthlySettlements || [],
              tombstones: allTombs,
              syncQueue: prev.syncQueue,
              preserveSandbox: true,
            })
          : prev.monthlySettlements || [],
        permissionGroups: mergedGroups,
        logs: Array.from(mergedLogsMap.values()),
        settings: cloudSetting || prev.settings,
        syncQueue:
          pushedInviteIds.size > 0
            ? (prev.syncQueue || []).filter(
                (q) => !(q.collectionName === 'classInvites' && pushedInviteIds.has(q.documentId))
              )
            : prev.syncQueue,
      },
      allTombs
    );
  });

  return {
    syncedQueueCount,
    enforcedTombstonesCount,
    activeStudentsCount: reconciled.students.filter((s) => s.env === 'production').length,
    activeAccountsCount: reconciled.accountAccess.length,
    activeTombstonesCount: reconciled.tombstones.length,
  };
}

export async function syncCurrentDataToCloudDatabase(): Promise<{ syncedCount: number }> {
  const uid = auth.currentUser?.uid || 'system';
  markQuotaExceeded(false);

  const schoolFilter = [
    where('schoolId', '==', SCHOOL_ID),
    where('visibility', '==', 'school'),
  ];
  const cloudTombSnap = await withFastFirestoreTimeout(
    () => getDocs(query(collection(db, 'deletionTombstones'), ...schoolFilter)),
    5000
  );
  const cloudTombstones = cloudTombSnap.docs.map((d) => d.data() as DeletionTombstone);
  saveHybridStore((prev) => applyTombstonesToStore(prev, cloudTombstones));

  const flushedCount = await flushSyncQueueToFirestore();
  const store = getHybridStore();
  let syncedCount = flushedCount;

  // Prefetch existing IDs on Cloud so updates preserve existing `createdAt` and never trigger rule rejection
  const [
    exClasses,
    exStudents,
    exRegs,
    exReports,
    exAccounts,
    exGroups,
    exInvites,
    exRules,
    exConfigs,
    exPayments,
    exSettlements,
  ] = await withFastFirestoreTimeout(
    () =>
      Promise.all([
        getDocs(query(collection(db, 'classes'), ...schoolFilter)),
        getDocs(query(collection(db, 'students'), ...schoolFilter)),
        getDocs(query(collection(db, 'registrations'), ...schoolFilter)),
        getDocs(query(collection(db, 'dailyReports'), ...schoolFilter)),
        getDocs(query(collection(db, 'accountAccess'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'permissionGroups'), ...schoolFilter)),
        getDocs(query(collection(db, 'classInvites'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealPricingRules'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealBillingConfigs'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'mealPayments'), ...schoolFilter)).catch(() => null),
        getDocs(query(collection(db, 'monthlySettlements'), ...schoolFilter)).catch(() => null),
      ]),
    8000
  );

  const existingIds = {
    classes: new Set(exClasses.docs.map((d) => d.id)),
    students: new Set(exStudents.docs.map((d) => d.id)),
    registrations: new Set(exRegs.docs.map((d) => d.id)),
    dailyReports: new Set(exReports.docs.map((d) => d.id)),
    accountAccess: new Set((exAccounts?.docs || []).map((d) => d.id)),
    permissionGroups: new Set(exGroups.docs.map((d) => d.id)),
    classInvites: new Set((exInvites?.docs || []).map((d) => d.id)),
    mealPricingRules: new Set((exRules?.docs || []).map((d) => d.id)),
    mealBillingConfigs: new Set((exConfigs?.docs || []).map((d) => d.id)),
    mealPayments: new Set((exPayments?.docs || []).map((d) => d.id)),
    monthlySettlements: new Set((exSettlements?.docs || []).map((d) => d.id)),
  };

  let batch = writeBatch(db);
  let ops = 0;

  const commitIfNeeded = async (force = false) => {
    if (ops >= 350 || (force && ops > 0)) {
      await withFastFirestoreTimeout(() => batch.commit(), 5000);
      batch = writeBatch(db);
      ops = 0;
    }
  };

  const enqueueUpsertPreservingCreatedAt = async (
    colName: keyof typeof existingIds,
    docId: string,
    payload: Record<string, unknown>
  ) => {
    const clean = { ...payload };
    delete clean.createdAt;
    delete clean.updatedAt;
    const ref = doc(db, colName, docId);
    if (existingIds[colName].has(docId)) {
      batch.set(ref, { ...clean, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      batch.set(ref, { ...clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    ops++;
    syncedCount++;
    await commitIfNeeded();
  };

  // Push local production tombstones & delete matching cloud docs
  const cloudTombSet = new Set(cloudTombstones.map((t) => t.id));
  for (const tomb of (store.tombstones || []).filter((t) => t.env === 'production')) {
    if (!cloudTombSet.has(tomb.id)) {
      batch.set(doc(db, 'deletionTombstones', tomb.id), {
        ...tomb,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops++;
    }
    batch.delete(doc(db, tomb.collectionName, tomb.documentId));
    ops++;
    syncedCount++;
    await commitIfNeeded();
  }

  for (const cls of filterOutTombstoned(
    store.classes.filter((c) => c.env === 'production'),
    'classes',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('classes', cls.id, { ...cls, updatedByUid: uid });
  }

  for (const stu of filterOutTombstoned(
    store.students.filter((s) => s.env === 'production'),
    'students',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('students', stu.id, { ...stu, updatedByUid: uid });
  }

  for (const reg of filterOutTombstoned(
    store.registrations.filter((r) => r.env === 'production'),
    'registrations',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('registrations', reg.id, { ...reg, updatedByUid: uid });
  }

  for (const rep of filterOutTombstoned(
    store.reports.filter((r) => r.env === 'production'),
    'dailyReports',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('dailyReports', rep.id, { ...rep });
  }

  for (const acc of filterOutTombstoned(
    store.accountAccess,
    'accountAccess',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('accountAccess', acc.id, {
      ...acc,
      joinedInviteCode: acc.joinedInviteCode || '',
    });
  }

  for (const grp of store.permissionGroups || getDefaultPermissionGroups(uid)) {
    await enqueueUpsertPreservingCreatedAt('permissionGroups', grp.id, {
      ...grp,
      updatedByUid: uid,
    });
  }

  for (const inv of filterOutTombstoned(
    store.classInvites || [],
    'classInvites',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('classInvites', inv.id, { ...inv });
  }

  for (const rule of filterOutTombstoned(
    (store.mealPricingRules || []).filter((r) => r.env === 'production'),
    'mealPricingRules',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('mealPricingRules', rule.id, { ...rule });
  }

  for (const cfg of (store.mealBillingConfigs || []).filter((c) => c.env === 'production')) {
    await enqueueUpsertPreservingCreatedAt('mealBillingConfigs', cfg.id, { ...cfg });
  }

  for (const pay of filterOutTombstoned(
    (store.mealPayments || []).filter((p) => p.env === 'production'),
    'mealPayments',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('mealPayments', pay.id, { ...pay });
  }

  for (const stl of filterOutTombstoned(
    (store.monthlySettlements || []).filter((s) => s.env === 'production'),
    'monthlySettlements',
    store.tombstones || []
  )) {
    await enqueueUpsertPreservingCreatedAt('monthlySettlements', stl.id, { ...stl });
  }

  await commitIfNeeded(true);
  return { syncedCount };
}

export async function clearSandboxData(): Promise<void> {
  saveHybridStore((prev) => ({
    ...prev,
    classes: prev.classes.filter((c) => c.env !== 'sandbox'),
    students: prev.students.filter((s) => s.env !== 'sandbox'),
    registrations: prev.registrations.filter((r) => r.env !== 'sandbox'),
    reports: prev.reports.filter((r) => r.env !== 'sandbox'),
    logs: prev.logs.filter((l) => l.env !== 'sandbox'),
    archivedYears: prev.archivedYears.filter((a) => a.env !== 'sandbox'),
    mealPricingRules: (prev.mealPricingRules || []).filter((r) => r.env !== 'sandbox'),
    mealPricingLogs: (prev.mealPricingLogs || []).filter((l) => l.env !== 'sandbox'),
    mealBillingConfigs: (prev.mealBillingConfigs || []).filter((c) => c.env !== 'sandbox'),
    mealPayments: (prev.mealPayments || []).filter((p) => p.env !== 'sandbox'),
    mealPaymentLogs: (prev.mealPaymentLogs || []).filter((l) => l.env !== 'sandbox'),
    monthlySettlements: (prev.monthlySettlements || []).filter((s) => s.env !== 'sandbox'),
    tombstones: (prev.tombstones || []).filter((t) => t.env !== 'sandbox'),
    deletedStudentIds: (prev.deletedStudentIds || []).filter((id) => !id.startsWith('sandbox')),
    syncQueue: (prev.syncQueue || []).filter((q) => !q.documentId.startsWith('sandbox')),
  }));

  if (!canWriteToCloudFirestore()) return;

  const collectionsToClean = [
    'classes',
    'students',
    'registrations',
    'dailyReports',
    'registrationLogs',
    'archivedYears',
    'deletionTombstones',
    'mealPricingRules',
    'mealPricingLogs',
    'mealBillingConfigs',
    'mealPayments',
    'mealPaymentLogs',
    'monthlySettlements',
  ];

  for (const colName of collectionsToClean) {
    try {
      const snap = await withFastFirestoreTimeout(
        () => getDocs(query(collection(db, colName), where('env', '==', 'sandbox'))),
        2000
      );
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await withFastFirestoreTimeout(() => batch.commit(), 2500);
      }
    } catch {
      // ignore if sandbox cleanup hits quota
    }
  }
}

/**
 * Monthly Meal Billing: Unit Pricing, Holidays/Symbols Config, Payments & Settlements
 */
function assertCanManageMealPricing(actorRole: UserRole, canManagePricingFlag?: boolean): void {
  const allowed =
    actorRole === 'admin' ||
    Boolean(
      canManagePricingFlag !== undefined
        ? canManagePricingFlag
        : resolveEffectiveGroup(actorRole, getHybridStore().permissionGroups || []).canManageMealPricing
    );
  if (!allowed) {
    throw new Error(
      'Chỉ Quản trị viên (hoặc tài khoản được cấp quyền Cài đặt giá suất ăn) mới được thực hiện thao tác này.'
    );
  }
}

function assertCanCollectMealPayment(actorRole: UserRole, canCollectFlag?: boolean): void {
  const allowed =
    actorRole === 'admin' ||
    Boolean(
      canCollectFlag !== undefined
        ? canCollectFlag
        : resolveEffectiveGroup(actorRole, getHybridStore().permissionGroups || []).canCollectPayments
    );
  if (!allowed) {
    throw new Error(
      'Tài khoản này chưa được cấp quyền Thu tiền ăn học sinh. Không thể ghi nhận hoặc chỉnh sửa khoản thu.'
    );
  }
}

function describePricingTargetLabel(rule: {
  targetScope: MealPricingRule['targetScope'];
  targetGrade: 0 | GradeLevel;
  targetClassId: string;
  groupTag: string;
  studentIds: string[];
}): string {
  const store = getHybridStore();
  if (rule.targetScope === 'school') return 'Toàn trường';
  if (rule.targetScope === 'grade') return `Khối ${rule.targetGrade}`;
  if (rule.targetScope === 'class') {
    const cls = store.classes.find((c) => c.id === rule.targetClassId);
    return cls ? `Lớp ${cls.name}` : `Lớp ${rule.targetClassId}`;
  }
  const tag = rule.groupTag?.trim() || 'Nhóm học sinh';
  return `${tag} (${rule.studentIds.length} HS)`;
}

export async function saveMealPricingRule(params: {
  rule: Omit<
    MealPricingRule,
    'id' | 'createdAtIso' | 'updatedAtIso' | 'updatedByUid' | 'updatedByName' | 'env' | 'schoolId' | 'visibility' | 'createdAt' | 'updatedAt'
  > & { id?: string };
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canManageMealPricing?: boolean;
  existingSettlements?: MonthlySettlement[];
  env?: AppEnvironment;
}): Promise<MealPricingRule> {
  assertCanManageMealPricing(params.actorRole, params.canManageMealPricing);
  const env = params.env || 'production';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.rule.effectiveFrom)) {
    throw new Error('Ngày áp dụng đơn giá phải đúng định dạng YYYY-MM-DD.');
  }
  const cleanPrice = Math.round(Number(params.rule.pricePerMeal));
  if (!Number.isFinite(cleanPrice) || cleanPrice < 0 || cleanPrice > 5000000) {
    throw new Error('Đơn giá suất ăn không hợp lệ (0 – 5.000.000 VNĐ).');
  }

  const effectiveMonth = params.rule.effectiveFrom.slice(0, 7);
  const store = getHybridStore();
  const settlements = params.existingSettlements || store.monthlySettlements || [];
  const lockedSettlement = settlements.find(
    (s) => s.env === env && s.month === effectiveMonth && s.isLocked
  );
  if (lockedSettlement) {
    throw new Error(
      `Tháng ${effectiveMonth} đã khóa sổ quyết toán. Vui lòng mở khóa sổ tháng trước khi thay đổi đơn giá trong tháng này.`
    );
  }

  const vnNow = getVietnamDateParts(new Date());
  const existing = params.rule.id
    ? (store.mealPricingRules || []).find((r) => r.id === params.rule.id)
    : undefined;

  const id = existing
    ? existing.id
    : sanitizeId(`${env}_price_${params.rule.effectiveFrom}_${Date.now()}_${Math.floor(Math.random() * 1000)}`);

  const studentIdsClean = Array.from(
    new Set((params.rule.studentIds || []).map((s) => sanitizeId(s)).filter(Boolean))
  ).slice(0, 1500);

  const payload: MealPricingRule = {
    id,
    effectiveFrom: params.rule.effectiveFrom,
    pricePerMeal: cleanPrice,
    targetScope: params.rule.targetScope,
    targetGrade: params.rule.targetScope === 'grade' ? params.rule.targetGrade : 0,
    targetClassId:
      params.rule.targetScope === 'class' ? sanitizeId(params.rule.targetClassId || '') : '',
    groupTag: sanitizeString(params.rule.groupTag || '', 64, ''),
    studentIds: params.rule.targetScope === 'student_group' ? studentIdsClean : [],
    note: sanitizeString(params.rule.note || '', 300, ''),
    active: params.rule.active !== false,
    createdAtIso: existing?.createdAtIso || vnNow.fullDisplay,
    updatedAtIso: vnNow.fullDisplay,
    updatedByUid: params.actorUid,
    updatedByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const logPayload: MealPricingLog = {
    id: sanitizeId(`${env}_pricelog_${id}_${Date.now()}`),
    ruleId: id,
    action: existing ? 'update' : 'create',
    effectiveFrom: payload.effectiveFrom,
    previousPrice: existing ? existing.pricePerMeal : 0,
    newPrice: payload.pricePerMeal,
    targetScope: payload.targetScope,
    targetLabel: describePricingTargetLabel(payload),
    note: payload.note || (existing ? 'Cập nhật đơn giá suất ăn' : 'Tạo cấu hình đơn giá mới'),
    actorUid: params.actorUid,
    actorName: payload.updatedByName,
    timestampIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const cleared = clearTombstonesInStore(prev, 'mealPricingRules', [id]);
    return {
      ...cleared,
      mealPricingRules: [
        ...(cleared.mealPricingRules || []).filter((r) => r.id !== id),
        payload,
      ],
      mealPricingLogs: [logPayload, ...(cleared.mealPricingLogs || [])],
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingRules',
        documentId: id,
        payload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'mealPricingRules', id);
      const snap = await getDoc(ref);
      const batch = writeBatch(db);
      if (snap.exists()) {
        batch.update(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(doc(db, 'mealPricingLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingRules',
        documentId: id,
        payload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `mealPricingRules/${id}`);
  }

  return payload;
}

export async function deleteMealPricingRule(params: {
  rule: MealPricingRule;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canManageMealPricing?: boolean;
  existingSettlements?: MonthlySettlement[];
  env?: AppEnvironment;
}): Promise<void> {
  assertCanManageMealPricing(params.actorRole, params.canManageMealPricing);
  const env = params.env || params.rule.env || 'production';
  const effectiveMonth = params.rule.effectiveFrom.slice(0, 7);
  const settlements = params.existingSettlements || getHybridStore().monthlySettlements || [];
  if (settlements.some((s) => s.env === env && s.month === effectiveMonth && s.isLocked)) {
    throw new Error(
      `Tháng ${effectiveMonth} đã khóa sổ quyết toán. Vui lòng mở khóa trước khi xóa đơn giá.`
    );
  }

  const vnNow = getVietnamDateParts(new Date());
  const tombstone = createTombstoneRecord({
    collectionName: 'mealPricingRules',
    documentId: params.rule.id,
    deletedByUid: params.actorUid,
    reason: `Xóa đơn giá ${params.rule.pricePerMeal.toLocaleString('vi-VN')}đ áp dụng từ ${params.rule.effectiveFrom}`,
    env,
  });

  const logPayload: MealPricingLog = {
    id: sanitizeId(`${env}_pricelog_del_${params.rule.id}_${Date.now()}`),
    ruleId: params.rule.id,
    action: 'delete',
    effectiveFrom: params.rule.effectiveFrom,
    previousPrice: params.rule.pricePerMeal,
    newPrice: 0,
    targetScope: params.rule.targetScope,
    targetLabel: describePricingTargetLabel(params.rule),
    note: 'Xóa cấu hình đơn giá',
    actorUid: params.actorUid,
    actorName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    timestampIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => {
    const withTomb = applyTombstonesToStore(prev, [tombstone]);
    return {
      ...withTomb,
      mealPricingRules: (withTomb.mealPricingRules || []).filter((r) => r.id !== params.rule.id),
      mealPricingLogs: [logPayload, ...(withTomb.mealPricingLogs || [])],
      syncQueue: (withTomb.syncQueue || []).filter(
        (q) => !(q.collectionName === 'mealPricingRules' && q.documentId === params.rule.id)
      ),
    };
  });

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'deletionTombstones',
        documentId: tombstone.id,
        payload: tombstone,
      });
      queueSyncOperation({
        action: 'delete',
        collectionName: 'mealPricingRules',
        documentId: params.rule.id,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'deletionTombstones', tombstone.id),
        { ...tombstone, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      );
      batch.delete(doc(db, 'mealPricingRules', params.rule.id));
      batch.set(doc(db, 'mealPricingLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'deletionTombstones',
        documentId: tombstone.id,
        payload: tombstone,
      });
      queueSyncOperation({
        action: 'delete',
        collectionName: 'mealPricingRules',
        documentId: params.rule.id,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPricingLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `mealPricingRules/${params.rule.id}`);
  }
}

export async function saveMealBillingConfig(params: {
  holidays: string[];
  symbolXLabel: string;
  symbolVLabel: string;
  symbolRLabel: string;
  symbolEmptyLabel: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canManageMealPricing?: boolean;
  env?: AppEnvironment;
}): Promise<MealBillingConfig> {
  assertCanManageMealPricing(params.actorRole, params.canManageMealPricing);
  const env = params.env || 'production';
  const vnNow = getVietnamDateParts(new Date());
  const base = getDefaultMealBillingConfig(env);
  const cleanHolidays = Array.from(
    new Set(
      (params.holidays || [])
        .map((h) => h.trim())
        .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h))
    )
  )
    .sort()
    .slice(0, 200);

  const payload: MealBillingConfig = {
    id: getBillingConfigDocId(env),
    holidays: cleanHolidays,
    symbolXLabel: sanitizeString(params.symbolXLabel, 120, base.symbolXLabel),
    symbolVLabel: sanitizeString(params.symbolVLabel, 120, base.symbolVLabel),
    symbolRLabel: sanitizeString(params.symbolRLabel, 120, base.symbolRLabel),
    symbolEmptyLabel: sanitizeString(params.symbolEmptyLabel, 120, base.symbolEmptyLabel),
    updatedAtIso: vnNow.fullDisplay,
    updatedByUid: params.actorUid,
    updatedByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => ({
    ...prev,
    mealBillingConfigs: [
      ...(prev.mealBillingConfigs || []).filter((c) => c.id !== payload.id),
      payload,
    ],
  }));

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealBillingConfigs',
        documentId: payload.id,
        payload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'mealBillingConfigs', payload.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealBillingConfigs',
        documentId: payload.id,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `mealBillingConfigs/${payload.id}`);
  }

  return payload;
}

export async function recordMealPayment(params: {
  month: string;
  student: Student;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  note?: string;
  idempotencyKey?: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canCollectPayments?: boolean;
  existingSettlements?: MonthlySettlement[];
  env?: AppEnvironment;
}): Promise<MealPayment> {
  assertCanCollectMealPayment(params.actorRole, params.canCollectPayments);
  const env = params.env || params.student.env || 'production';

  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    throw new Error('Tháng quyết toán phải có định dạng YYYY-MM.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.paymentDate)) {
    throw new Error('Ngày thu tiền không hợp lệ.');
  }
  const cleanAmount = Math.round(Number(params.amountPaid));
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 100000000) {
    throw new Error('Số tiền thu phải lớn hơn 0 VNĐ.');
  }

  const store = getHybridStore();
  const settlements = params.existingSettlements || store.monthlySettlements || [];
  if (
    params.actorRole !== 'admin' &&
    settlements.some((s) => s.env === env && s.month === params.month && s.isLocked)
  ) {
    throw new Error(
      `Tháng ${params.month} đã khóa sổ quyết toán. Chỉ Quản trị viên mới được ghi nhận bổ sung khoản thu.`
    );
  }

  const idemKey = sanitizeString(
    params.idempotencyKey || `${params.month}_${params.student.id}_${Date.now()}`,
    96
  );

  // Duplicate submission / double-click guard (exact idempotencyKey or identical amount/date within 15s)
  const existingPayments = (store.mealPayments || []).filter(
    (p) => p.env === env && !p.isVoided && p.month === params.month && p.studentId === params.student.id
  );
  const byKey = existingPayments.find((p) => p.idempotencyKey === idemKey);
  if (byKey) return byKey;

  const recentDup = existingPayments.find((p) => {
    if (p.amountPaid !== cleanAmount || p.paymentDate !== params.paymentDate || p.paymentMethod !== params.paymentMethod) {
      return false;
    }
    const tsMatch = p.id.match(/_(\d{13})_/);
    const createdMs = tsMatch ? Number(tsMatch[1]) : 0;
    return createdMs > 0 && Date.now() - createdMs < 15000;
  });
  if (recentDup) {
    throw new Error(
      `Khoản thu ${cleanAmount.toLocaleString('vi-VN')}đ cho ${params.student.fullName} vừa được ghi nhận cách đây vài giây (Phiếu ${recentDup.receiptNumber}). Đã chặn ghi trùng lặp.`
    );
  }

  const vnNow = getVietnamDateParts(new Date());
  const nowMs = Date.now();
  const randSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const paymentId = sanitizeId(`${env}_pay_${params.month}_${params.student.id}_${nowMs}_${randSuffix}`);
  const receiptNumber = `PT-${params.month.replace('-', '')}-${String(nowMs).slice(-4)}${randSuffix.slice(0, 2)}`;

  const payload: MealPayment = {
    id: paymentId,
    month: params.month,
    studentId: params.student.id,
    studentCode: sanitizeString(params.student.studentCode, 32, 'HS'),
    studentName: sanitizeString(params.student.fullName, 120, 'Học sinh'),
    classId: params.student.classId,
    className: sanitizeString(params.student.className, 32, ''),
    grade: params.student.grade,
    amountPaid: cleanAmount,
    paymentDate: params.paymentDate,
    paymentMethod: params.paymentMethod,
    receiptNumber,
    idempotencyKey: idemKey,
    note: sanitizeString(params.note || '', 300, ''),
    collectorUid: params.actorUid,
    collectorName: sanitizeString(params.actorName, 120, 'Kế toán'),
    collectorRole: params.actorRole,
    version: 1,
    isVoided: false,
    updatedAtIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  const logPayload: MealPaymentLog = {
    id: sanitizeId(`${env}_paylog_${paymentId}_${nowMs}`),
    paymentId,
    month: params.month,
    studentId: params.student.id,
    studentName: payload.studentName,
    className: payload.className,
    action: 'create',
    previousAmount: 0,
    newAmount: cleanAmount,
    previousMethod: '',
    newMethod: params.paymentMethod,
    reason: payload.note || `Thu tiền ăn tháng ${params.month} (${receiptNumber})`,
    actorUid: params.actorUid,
    actorName: payload.collectorName,
    actorRole: params.actorRole,
    timestampIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => ({
    ...prev,
    mealPayments: [...(prev.mealPayments || []), payload],
    mealPaymentLogs: [logPayload, ...(prev.mealPaymentLogs || [])],
  }));

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPayments',
        documentId: paymentId,
        payload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPaymentLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'mealPayments', paymentId), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'mealPaymentLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPayments',
        documentId: paymentId,
        payload,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPaymentLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `mealPayments/${paymentId}`);
  }

  return payload;
}

export async function updateMealPayment(params: {
  payment: MealPayment;
  expectedVersion: number;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  note: string;
  reason: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canCollectPayments?: boolean;
  existingSettlements?: MonthlySettlement[];
  env?: AppEnvironment;
}): Promise<MealPayment> {
  assertCanCollectMealPayment(params.actorRole, params.canCollectPayments);
  const env = params.env || params.payment.env || 'production';
  const cleanAmount = Math.round(Number(params.amountPaid));
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 100000000) {
    throw new Error('Số tiền thu mới phải lớn hơn 0 VNĐ.');
  }
  const cleanReason = sanitizeString(params.reason || '', 300, '');
  if (cleanReason.length < 3) {
    throw new Error('Khi chỉnh sửa phiếu thu bắt buộc phải ghi rõ lý do điều chỉnh để lưu lịch sử.');
  }

  const store = getHybridStore();
  const settlements = params.existingSettlements || store.monthlySettlements || [];
  if (
    params.actorRole !== 'admin' &&
    settlements.some((s) => s.env === env && s.month === params.payment.month && s.isLocked)
  ) {
    throw new Error(
      `Tháng ${params.payment.month} đã khóa sổ quyết toán. Chỉ Quản trị viên mới được chỉnh sửa phiếu thu.`
    );
  }

  const latestLocal = (store.mealPayments || []).find((p) => p.id === params.payment.id);
  if (latestLocal && latestLocal.version !== params.expectedVersion) {
    throw new Error(
      `Phiếu thu ${params.payment.receiptNumber} vừa được người khác cập nhật (phiên bản ${latestLocal.version}). Vui lòng mở lại dữ liệu mới nhất trước khi lưu.`
    );
  }

  const vnNow = getVietnamDateParts(new Date());
  const nextVersion = params.expectedVersion + 1;
  const updated: MealPayment = {
    ...params.payment,
    amountPaid: cleanAmount,
    paymentDate: params.paymentDate,
    paymentMethod: params.paymentMethod,
    note: sanitizeString(params.note || '', 300, ''),
    collectorUid: params.actorUid,
    collectorName: sanitizeString(params.actorName, 120, 'Kế toán'),
    collectorRole: params.actorRole,
    version: nextVersion,
    updatedAtIso: vnNow.fullDisplay,
  };

  const logPayload: MealPaymentLog = {
    id: sanitizeId(`${env}_paylog_upd_${params.payment.id}_${Date.now()}`),
    paymentId: params.payment.id,
    month: params.payment.month,
    studentId: params.payment.studentId,
    studentName: params.payment.studentName,
    className: params.payment.className,
    action: 'update',
    previousAmount: params.payment.amountPaid,
    newAmount: cleanAmount,
    previousMethod: params.payment.paymentMethod,
    newMethod: params.paymentMethod,
    reason: cleanReason,
    actorUid: params.actorUid,
    actorName: updated.collectorName,
    actorRole: params.actorRole,
    timestampIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  if (env === 'production' && canWriteToCloudFirestore()) {
    try {
      await withFastFirestoreTimeout(
        () =>
          runTransaction(db, async (tx) => {
            const pRef = doc(db, 'mealPayments', updated.id);
            const snap = await tx.get(pRef);
            if (snap.exists()) {
              const cloudData = snap.data() as MealPayment;
              if (cloudData.version !== params.expectedVersion) {
                throw new Error(
                  `CONCURRENT_MODIFICATION: Phiếu thu ${params.payment.receiptNumber} đã được chỉnh sửa từ thiết bị khác.`
                );
              }
              tx.update(pRef, {
                amountPaid: updated.amountPaid,
                paymentDate: updated.paymentDate,
                paymentMethod: updated.paymentMethod,
                note: updated.note,
                collectorUid: updated.collectorUid,
                collectorName: updated.collectorName,
                collectorRole: updated.collectorRole,
                version: nextVersion,
                updatedAtIso: updated.updatedAtIso,
                updatedAt: serverTimestamp(),
              });
            } else {
              tx.set(pRef, {
                ...updated,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            tx.set(doc(db, 'mealPaymentLogs', logPayload.id), {
              ...logPayload,
              createdAt: serverTimestamp(),
            });
          }),
        5000
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('CONCURRENT_MODIFICATION')) {
        throw new Error(error.message.replace('CONCURRENT_MODIFICATION: ', ''));
      }
      if (isTrueQuotaError(error)) markQuotaExceeded(true);
      if (isQuotaOrTimeoutError(error)) {
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'mealPayments',
          documentId: updated.id,
          payload: updated,
        });
        queueSyncOperation({
          action: 'upsert',
          collectionName: 'mealPaymentLogs',
          documentId: logPayload.id,
          payload: logPayload,
        });
      } else {
        handleFirestoreError(error, OperationType.WRITE, `mealPayments/${updated.id}`);
      }
    }
  } else if (env === 'production') {
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'mealPayments',
      documentId: updated.id,
      payload: updated,
    });
    queueSyncOperation({
      action: 'upsert',
      collectionName: 'mealPaymentLogs',
      documentId: logPayload.id,
      payload: logPayload,
    });
  }

  saveHybridStore((prev) => ({
    ...prev,
    mealPayments: [
      ...(prev.mealPayments || []).filter((p) => p.id !== updated.id),
      updated,
    ],
    mealPaymentLogs: [logPayload, ...(prev.mealPaymentLogs || [])],
  }));

  return updated;
}

export async function voidMealPayment(params: {
  payment: MealPayment;
  expectedVersion: number;
  reason: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canCollectPayments?: boolean;
  existingSettlements?: MonthlySettlement[];
  env?: AppEnvironment;
}): Promise<MealPayment> {
  assertCanCollectMealPayment(params.actorRole, params.canCollectPayments);
  const env = params.env || params.payment.env || 'production';
  const cleanReason = sanitizeString(params.reason || '', 300, '');
  if (cleanReason.length < 3) {
    throw new Error('Hủy phiếu thu bắt buộc phải nhập lý do.');
  }

  const settlements = params.existingSettlements || getHybridStore().monthlySettlements || [];
  if (
    params.actorRole !== 'admin' &&
    settlements.some((s) => s.env === env && s.month === params.payment.month && s.isLocked)
  ) {
    throw new Error(`Tháng ${params.payment.month} đã khóa sổ quyết toán.`);
  }

  const vnNow = getVietnamDateParts(new Date());
  const voided: MealPayment = {
    ...params.payment,
    isVoided: true,
    note: `[ĐÃ HỦY: ${cleanReason}] ${params.payment.note}`.slice(0, 300),
    collectorUid: params.actorUid,
    collectorName: sanitizeString(params.actorName, 120, 'Kế toán'),
    collectorRole: params.actorRole,
    version: params.expectedVersion + 1,
    updatedAtIso: vnNow.fullDisplay,
  };

  const logPayload: MealPaymentLog = {
    id: sanitizeId(`${env}_paylog_void_${params.payment.id}_${Date.now()}`),
    paymentId: params.payment.id,
    month: params.payment.month,
    studentId: params.payment.studentId,
    studentName: params.payment.studentName,
    className: params.payment.className,
    action: 'void',
    previousAmount: params.payment.amountPaid,
    newAmount: 0,
    previousMethod: params.payment.paymentMethod,
    newMethod: params.payment.paymentMethod,
    reason: cleanReason,
    actorUid: params.actorUid,
    actorName: voided.collectorName,
    actorRole: params.actorRole,
    timestampIso: vnNow.fullDisplay,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => ({
    ...prev,
    mealPayments: [
      ...(prev.mealPayments || []).filter((p) => p.id !== voided.id),
      voided,
    ],
    mealPaymentLogs: [logPayload, ...(prev.mealPaymentLogs || [])],
  }));

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPayments',
        documentId: voided.id,
        payload: voided,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPaymentLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
    }
    return voided;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'mealPayments', voided.id),
        {
          isVoided: true,
          note: voided.note,
          collectorUid: voided.collectorUid,
          collectorName: voided.collectorName,
          collectorRole: voided.collectorRole,
          version: voided.version,
          updatedAtIso: voided.updatedAtIso,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(doc(db, 'mealPaymentLogs', logPayload.id), {
        ...logPayload,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPayments',
        documentId: voided.id,
        payload: voided,
      });
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'mealPaymentLogs',
        documentId: logPayload.id,
        payload: logPayload,
      });
      return voided;
    }
    handleFirestoreError(error, OperationType.WRITE, `mealPayments/${voided.id}`);
  }

  return voided;
}

export async function lockMonthlySettlement(params: {
  month: string;
  classes: SchoolClass[];
  students: Student[];
  registrations: MealRegistration[];
  pricingRules: MealPricingRule[];
  billingConfig: MealBillingConfig | null;
  payments: MealPayment[];
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canManageMealPricing?: boolean;
  note?: string;
  env?: AppEnvironment;
}): Promise<MonthlySettlement> {
  assertCanManageMealPricing(params.actorRole, params.canManageMealPricing);
  const env = params.env || 'production';
  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    throw new Error('Tháng quyết toán phải đúng định dạng YYYY-MM.');
  }

  const summary = computeMonthlyBillingReport({
    month: params.month,
    classes: params.classes,
    students: params.students,
    registrations: params.registrations,
    pricingRules: params.pricingRules,
    payments: params.payments,
    holidays: params.billingConfig?.holidays || [],
    settlement: null,
    env,
  });

  const vnNow = getVietnamDateParts(new Date());
  const id = getMonthlySettlementDocId(env, params.month);
  const payload: MonthlySettlement = {
    id,
    month: params.month,
    isLocked: true,
    lockedAtIso: vnNow.fullDisplay,
    lockedByUid: params.actorUid,
    lockedByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    unlockedAtIso: '',
    unlockedByName: '',
    note: sanitizeString(params.note || 'Khóa sổ quyết toán tháng chính thức', 300),
    totalStudentsSnapshot: summary.totalStudents,
    totalMealsSnapshot: summary.totalX,
    totalAbsencesSnapshot: summary.totalV,
    totalAmountDueSnapshot: summary.totalAmountDue,
    totalAmountPaidSnapshot: summary.totalPaid,
    env,
    schoolId: SCHOOL_ID,
    visibility: 'school',
  };

  saveHybridStore((prev) => ({
    ...prev,
    monthlySettlements: [
      ...(prev.monthlySettlements || []).filter((s) => s.id !== id),
      payload,
    ],
  }));

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'monthlySettlements',
        documentId: id,
        payload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'monthlySettlements', id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'monthlySettlements',
        documentId: id,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `monthlySettlements/${id}`);
  }

  return payload;
}

export async function unlockMonthlySettlement(params: {
  month: string;
  reason: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  canManageMealPricing?: boolean;
  env?: AppEnvironment;
}): Promise<MonthlySettlement> {
  assertCanManageMealPricing(params.actorRole, params.canManageMealPricing);
  const env = params.env || 'production';
  const cleanReason = sanitizeString(params.reason || '', 300, '');
  if (cleanReason.length < 3) {
    throw new Error('Mở khóa sổ quyết toán tháng bắt buộc phải nhập lý do.');
  }

  const vnNow = getVietnamDateParts(new Date());
  const id = getMonthlySettlementDocId(env, params.month);
  const existing = (getHybridStore().monthlySettlements || []).find((s) => s.id === id);

  const payload: MonthlySettlement = {
    ...(existing || {
      id,
      month: params.month,
      lockedAtIso: '',
      lockedByUid: params.actorUid,
      lockedByName: '',
      totalStudentsSnapshot: 0,
      totalMealsSnapshot: 0,
      totalAbsencesSnapshot: 0,
      totalAmountDueSnapshot: 0,
      totalAmountPaidSnapshot: 0,
      env,
      schoolId: SCHOOL_ID,
      visibility: 'school' as const,
    }),
    isLocked: false,
    unlockedAtIso: vnNow.fullDisplay,
    unlockedByName: sanitizeString(params.actorName, 120, 'Quản trị viên'),
    note: `Mở khóa: ${cleanReason}`.slice(0, 300),
  };

  saveHybridStore((prev) => ({
    ...prev,
    monthlySettlements: [
      ...(prev.monthlySettlements || []).filter((s) => s.id !== id),
      payload,
    ],
  }));

  if (env === 'sandbox' || !canWriteToCloudFirestore()) {
    if (env === 'production') {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'monthlySettlements',
        documentId: id,
        payload,
      });
    }
    return payload;
  }

  try {
    await withFastFirestoreTimeout(async () => {
      const ref = doc(db, 'monthlySettlements', id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          isLocked: false,
          unlockedAtIso: payload.unlockedAtIso,
          unlockedByName: payload.unlockedByName,
          note: payload.note,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }, 5000);
  } catch (error) {
    if (isTrueQuotaError(error)) markQuotaExceeded(true);
    if (isQuotaOrTimeoutError(error)) {
      queueSyncOperation({
        action: 'upsert',
        collectionName: 'monthlySettlements',
        documentId: id,
        payload,
      });
      return payload;
    }
    handleFirestoreError(error, OperationType.WRITE, `monthlySettlements/${id}`);
  }

  return payload;
}

