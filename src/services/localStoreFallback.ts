import {
  activeFirebaseConfig,
  db,
  setFirestoreNetworkEnabled,
} from '../firebase';
import {
  AccountAccess,
  AppEnvironment,
  ArchivedYearSnapshot,
  ClassInvite,
  DailyReport,
  DEFAULT_CUTOFF_TIME,
  DeletionTombstone,
  getDefaultPermissionGroups,
  getVietnamDateParts,
  GRADE_CLASS_COUNTS,
  GradeLevel,
  MealBillingConfig,
  MealPayment,
  MealPaymentLog,
  MealPricingLog,
  MealPricingRule,
  MealRegistration,
  MonthlySettlement,
  PermissionGroup,
  RegistrationLog,
  sanitizeId,
  SCHOOL_ID,
  SchoolClass,
  SchoolSetting,
  Student,
  TombstoneCollection,
} from '../types';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

const STORAGE_KEY = 'THCS_DONG_THANH_HYBRID_STORE_V2';
const STORE_SCHEMA_VERSION = 4;
export const LOCAL_STORE_EVENT = 'thcs-dong-thanh-store-updated';

const TOMBSTONE_COLLECTIONS = new Set<string>([
  'students',
  'classes',
  'registrations',
  'accountAccess',
  'dailyReports',
  'archivedYears',
  'classInvites',
  'mealPricingRules',
  'mealPayments',
  'monthlySettlements',
]);

export interface SyncQueueItem {
  id: string;
  action?: 'upsert' | 'delete';
  collectionName:
    | 'registrations'
    | 'dailyReports'
    | 'registrationLogs'
    | 'students'
    | 'classes'
    | 'settings'
    | 'accountAccess'
    | 'archivedYears'
    | 'deletionTombstones'
    | 'permissionGroups'
    | 'classInvites'
    | 'mealPricingRules'
    | 'mealPricingLogs'
    | 'mealBillingConfigs'
    | 'mealPayments'
    | 'mealPaymentLogs'
    | 'monthlySettlements'
    | 'users';
  documentId: string;
  payload?: any;
  timestampIso: string;
}

export interface HybridLocalStore {
  schemaVersion?: number;
  quotaExceeded: boolean;
  quotaExceededAtMs?: number;
  classes: SchoolClass[];
  students: Student[];
  deletedStudentIds: string[];
  tombstones: DeletionTombstone[];
  registrations: MealRegistration[];
  reports: DailyReport[];
  logs: RegistrationLog[];
  accountAccess: AccountAccess[];
  archivedYears: ArchivedYearSnapshot[];
  permissionGroups: PermissionGroup[];
  classInvites: ClassInvite[];
  mealPricingRules: MealPricingRule[];
  mealPricingLogs: MealPricingLog[];
  mealBillingConfigs: MealBillingConfig[];
  mealPayments: MealPayment[];
  mealPaymentLogs: MealPaymentLog[];
  monthlySettlements: MonthlySettlement[];
  settings: SchoolSetting;
  syncQueue: SyncQueueItem[];
}

export function getTombstoneId(collectionName: TombstoneCollection, documentId: string): string {
  return sanitizeId(`${collectionName}_${documentId}`);
}

export function buildTombstoneSet(
  tombstones: DeletionTombstone[],
  collectionName: TombstoneCollection
): Set<string> {
  const set = new Set<string>();
  for (const t of tombstones || []) {
    if (t.collectionName === collectionName && t.documentId) {
      set.add(t.documentId);
    }
  }
  return set;
}

export function filterOutTombstoned<T extends { id: string }>(
  items: T[],
  collectionName: TombstoneCollection,
  tombstones: DeletionTombstone[]
): T[] {
  const blocked = buildTombstoneSet(tombstones, collectionName);
  if (blocked.size === 0) return items;
  return items.filter((item) => !blocked.has(item.id));
}

export function mergeTombstones(
  baseList: DeletionTombstone[],
  incomingList: DeletionTombstone[]
): DeletionTombstone[] {
  const map = new Map<string, DeletionTombstone>();
  for (const t of baseList || []) {
    if (t && t.id) map.set(t.id, t);
  }
  for (const t of incomingList || []) {
    if (!t || !t.id) continue;
    const prev = map.get(t.id);
    if (!prev || (t.deletedAtMs || 0) >= (prev.deletedAtMs || 0)) {
      map.set(t.id, t);
    }
  }
  return Array.from(map.values());
}

export function applyTombstonesToStore(
  store: HybridLocalStore,
  incomingTombstones: DeletionTombstone[] = []
): HybridLocalStore {
  const mergedTombstones = mergeTombstones(store.tombstones || [], incomingTombstones);

  const stuBlocked = buildTombstoneSet(mergedTombstones, 'students');
  const clsBlocked = buildTombstoneSet(mergedTombstones, 'classes');
  const regBlocked = buildTombstoneSet(mergedTombstones, 'registrations');
  const accBlocked = buildTombstoneSet(mergedTombstones, 'accountAccess');
  const repBlocked = buildTombstoneSet(mergedTombstones, 'dailyReports');
  const arcBlocked = buildTombstoneSet(mergedTombstones, 'archivedYears');
  const invBlocked = buildTombstoneSet(mergedTombstones, 'classInvites');
  const priceBlocked = buildTombstoneSet(mergedTombstones, 'mealPricingRules');
  const payBlocked = buildTombstoneSet(mergedTombstones, 'mealPayments');
  const settleBlocked = buildTombstoneSet(mergedTombstones, 'monthlySettlements');

  const isQueueItemBlocked = (q: SyncQueueItem): boolean => {
    if (q.action === 'delete') return false;
    if (q.collectionName === 'students') return stuBlocked.has(q.documentId);
    if (q.collectionName === 'classes') return clsBlocked.has(q.documentId);
    if (q.collectionName === 'registrations') return regBlocked.has(q.documentId);
    if (q.collectionName === 'accountAccess') return accBlocked.has(q.documentId);
    if (q.collectionName === 'dailyReports') return repBlocked.has(q.documentId);
    if (q.collectionName === 'archivedYears') return arcBlocked.has(q.documentId);
    if (q.collectionName === 'classInvites') return invBlocked.has(q.documentId);
    if (q.collectionName === 'mealPricingRules') return priceBlocked.has(q.documentId);
    if (q.collectionName === 'mealPayments') return payBlocked.has(q.documentId);
    if (q.collectionName === 'monthlySettlements') return settleBlocked.has(q.documentId);
    return false;
  };

  const keepOrFilter = <T extends { id: string }>(arr: T[] | undefined, blocked: Set<string>): T[] => {
    const list = arr || [];
    if (blocked.size === 0 || !list.some((item) => blocked.has(item.id))) return list;
    return list.filter((item) => !blocked.has(item.id));
  };

  const rawQueue = store.syncQueue || [];
  const nextQueue = rawQueue.some(isQueueItemBlocked)
    ? rawQueue.filter((q) => !isQueueItemBlocked(q))
    : rawQueue;

  return {
    ...store,
    tombstones: mergedTombstones,
    deletedStudentIds: Array.from(stuBlocked),
    students: keepOrFilter(store.students, stuBlocked),
    classes: keepOrFilter(store.classes, clsBlocked),
    registrations: keepOrFilter(store.registrations, regBlocked),
    accountAccess: keepOrFilter(store.accountAccess, accBlocked),
    reports: keepOrFilter(store.reports, repBlocked),
    archivedYears: keepOrFilter(store.archivedYears, arcBlocked),
    classInvites: keepOrFilter(store.classInvites, invBlocked),
    mealPricingRules: keepOrFilter(store.mealPricingRules, priceBlocked),
    mealPayments: keepOrFilter(store.mealPayments, payBlocked),
    monthlySettlements: keepOrFilter(store.monthlySettlements, settleBlocked),
    syncQueue: nextQueue,
  };
}

export function clearTombstonesInStore(
  store: HybridLocalStore,
  collectionName: TombstoneCollection,
  documentIds: string[]
): HybridLocalStore {
  if (documentIds.length === 0) return store;
  const idSet = new Set(documentIds);
  const nextTombstones = (store.tombstones || []).filter(
    (t) => !(t.collectionName === collectionName && idSet.has(t.documentId))
  );
  const nextDeletedStudentIds =
    collectionName === 'students'
      ? (store.deletedStudentIds || []).filter((id) => !idSet.has(id))
      : store.deletedStudentIds || [];

  return {
    ...store,
    tombstones: nextTombstones,
    deletedStudentIds: nextDeletedStudentIds,
  };
}

/**
 * Authoritative tombstone-aware Cloud <-> Local reconciler.
 * - Never resurrects records deleted from Cloud Firestore.
 * - Blocks tombstoned records even if lingering in stale local cache or old backups.
 * - Preserves genuinely unsynced offline upserts that have NOT been deleted/tombstoned.
 */
export function reconcileCollectionWithCloud<T extends { id: string; env?: AppEnvironment }>(params: {
  collectionName: TombstoneCollection;
  cloudItems: T[];
  cloudReady: boolean;
  localItems: T[];
  tombstones: DeletionTombstone[];
  syncQueue: SyncQueueItem[];
  preserveSandbox?: boolean;
}): T[] {
  const tombSet = buildTombstoneSet(params.tombstones, params.collectionName);
  const pendingDeletes = new Set<string>();
  const pendingUpserts: T[] = [];

  for (const q of params.syncQueue || []) {
    if (q.collectionName !== params.collectionName) continue;
    if (q.action === 'delete') {
      pendingDeletes.add(q.documentId);
    } else if (q.payload && !tombSet.has(q.documentId)) {
      pendingUpserts.push(q.payload as T);
    }
  }

  if (!params.cloudReady) {
    const map = new Map<string, T>();
    for (const item of params.localItems || []) {
      if (!tombSet.has(item.id) && !pendingDeletes.has(item.id)) {
        map.set(item.id, item);
      }
    }
    for (const item of pendingUpserts) {
      if (!tombSet.has(item.id) && !pendingDeletes.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  // Cloud is authoritative: NEVER pull production items from local cache if Cloud removed them.
  const map = new Map<string, T>();
  for (const item of params.cloudItems || []) {
    if (!tombSet.has(item.id) && !pendingDeletes.has(item.id)) {
      map.set(item.id, item);
    }
  }
  for (const item of pendingUpserts) {
    if (!tombSet.has(item.id) && !pendingDeletes.has(item.id)) {
      map.set(item.id, item);
    }
  }
  if (params.preserveSandbox) {
    for (const item of params.localItems || []) {
      if (item.env === 'sandbox' && !tombSet.has(item.id) && !pendingDeletes.has(item.id)) {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values());
}

export function serializeForDiff<T extends { id: string }>(items: T[]): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(
    sorted.map((item) => {
      const clone: Record<string, unknown> = { ...(item as Record<string, unknown>) };
      delete clone.createdAt;
      delete clone.updatedAt;
      return clone;
    })
  );
}

export function generateDefault61Classes(
  env: AppEnvironment = 'production',
  uid = 'system'
): SchoolClass[] {
  const result: SchoolClass[] = [];
  const grades: GradeLevel[] = [6, 7, 8, 9];
  for (const grade of grades) {
    const count = GRADE_CLASS_COUNTS[grade];
    for (let i = 1; i <= count; i++) {
      const className = `${grade}/${i}`;
      const id = sanitizeId(`${env}_class_${grade}_${i}`);
      result.push({
        id,
        name: className,
        grade,
        order: i,
        teacherName: `GVCN Lớp ${className}`,
        teacherEmail: `gvcn.${grade}.${i}@thcsdongthanh.edu.vn`,
        studentCount: 0,
        active: true,
        env,
        schoolId: SCHOOL_ID,
        visibility: 'school',
        updatedByUid: uid,
      });
    }
  }
  return result;
}

let memoryStoreCache: HybridLocalStore | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      memoryStoreCache = null;
    }
  });
}

function buildCompactLocalStorageSnapshot(
  store: HybridLocalStore,
  aggressivePrune = false
): HybridLocalStore {
  const maxLogs = aggressivePrune ? 50 : 150;
  const maxPricingLogs = aggressivePrune ? 40 : 100;
  const maxPaymentLogs = aggressivePrune ? 40 : 120;

  let trimmedRegs = store.registrations || [];
  if (aggressivePrune && trimmedRegs.length > 0) {
    // Preserve last 30 days + any registrations currently waiting in syncQueue
    const pendingRegIds = new Set(
      (store.syncQueue || [])
        .filter((q) => q.collectionName === 'registrations')
        .map((q) => q.documentId)
    );
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    trimmedRegs = trimmedRegs.filter(
      (r) => pendingRegIds.has(r.id) || (r.date && r.date >= cutoffDate)
    );
  }

  return {
    ...store,
    logs: (store.logs || []).slice(0, maxLogs),
    mealPricingLogs: (store.mealPricingLogs || []).slice(0, maxPricingLogs),
    mealPaymentLogs: (store.mealPaymentLogs || []).slice(0, maxPaymentLogs),
    registrations: trimmedRegs,
    archivedYears: aggressivePrune ? [] : (store.archivedYears || []).slice(0, 3),
  };
}

export function getHybridStore(): HybridLocalStore {
  if (memoryStoreCache) {
    const quotaAt = memoryStoreCache.quotaExceededAtMs || 0;
    if (memoryStoreCache.quotaExceeded && (!quotaAt || Date.now() - quotaAt > 90_000)) {
      memoryStoreCache = {
        ...memoryStoreCache,
        quotaExceeded: false,
        quotaExceededAtMs: 0,
      };
    }
    return memoryStoreCache;
  }

  const defaultClasses = generateDefault61Classes('production');
  const defaultSettings: SchoolSetting = {
    id: 'general_settings',
    schoolName: 'TRƯỜNG THCS ĐÔNG THẠNH',
    cutoffTime: DEFAULT_CUTOFF_TIME,
    academicYear: '2026 - 2027',
    semester: 'HK1',
    autoLockEnabled: true,
    studentListVersion: 1,
    lastBulkResetAtIso: '',
    schoolId: SCHOOL_ID,
    visibility: 'school',
    updatedByUid: 'system',
  };

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HybridLocalStore>;
      const legacySchema = !parsed.schemaVersion || parsed.schemaVersion < STORE_SCHEMA_VERSION;
      const legacyDeletedStudents = Array.isArray(parsed.deletedStudentIds)
        ? parsed.deletedStudentIds
        : [];
      const existingTombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];

      // Upgrade any legacy deletedStudentIds entries into full DeletionTombstone records
      const legacyTombstones: DeletionTombstone[] = legacyDeletedStudents
        .filter(
          (docId) =>
            !existingTombstones.some(
              (t) => t.collectionName === 'students' && t.documentId === docId
            )
        )
        .map((docId) => ({
          id: getTombstoneId('students', docId),
          collectionName: 'students',
          documentId: docId,
          deletedAtMs: 1,
          deletedAtIso: '',
          deletedByUid: 'legacy_migration',
          reason: 'Chuyển đổi đánh dấu xóa học sinh',
          env: docId.startsWith('sandbox') ? 'sandbox' : 'production',
          schoolId: SCHOOL_ID,
          visibility: 'school',
        }));

      const defaultGroups = getDefaultPermissionGroups();
      const parsedGroups = Array.isArray(parsed.permissionGroups) ? parsed.permissionGroups : [];
      const mergedGroups = defaultGroups.map((def) => {
        const match = parsedGroups.find((g) => g.id === def.id);
        return match ? { ...def, ...match } : def;
      });

      const quotaAt = typeof parsed.quotaExceededAtMs === 'number' ? parsed.quotaExceededAtMs : 0;
      const quotaLatchExpired = !quotaAt || Date.now() - quotaAt > 90_000;

      const initialStore: HybridLocalStore = {
        schemaVersion: STORE_SCHEMA_VERSION,
        // Auto-expire transient offline/quota latches across reloads or after 90s so mobile users recover cleanly
        quotaExceeded: legacySchema || quotaLatchExpired ? false : Boolean(parsed.quotaExceeded),
        quotaExceededAtMs: legacySchema || quotaLatchExpired ? 0 : quotaAt,
        classes: parsed.classes && parsed.classes.length > 0 ? parsed.classes : defaultClasses,
        students: Array.isArray(parsed.students) ? parsed.students : [],
        deletedStudentIds: legacyDeletedStudents,
        tombstones: [...existingTombstones, ...legacyTombstones],
        registrations: Array.isArray(parsed.registrations) ? parsed.registrations : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        accountAccess: Array.isArray(parsed.accountAccess) ? parsed.accountAccess : [],
        archivedYears: Array.isArray(parsed.archivedYears) ? parsed.archivedYears : [],
        permissionGroups: mergedGroups,
        classInvites: Array.isArray(parsed.classInvites) ? parsed.classInvites : [],
        mealPricingRules: Array.isArray(parsed.mealPricingRules) ? parsed.mealPricingRules : [],
        mealPricingLogs: Array.isArray(parsed.mealPricingLogs) ? parsed.mealPricingLogs : [],
        mealBillingConfigs: Array.isArray(parsed.mealBillingConfigs)
          ? parsed.mealBillingConfigs
          : [],
        mealPayments: Array.isArray(parsed.mealPayments) ? parsed.mealPayments : [],
        mealPaymentLogs: Array.isArray(parsed.mealPaymentLogs) ? parsed.mealPaymentLogs : [],
        monthlySettlements: Array.isArray(parsed.monthlySettlements)
          ? parsed.monthlySettlements
          : [],
        settings: {
          ...defaultSettings,
          ...(parsed.settings || {}),
        },
        syncQueue: Array.isArray(parsed.syncQueue) ? parsed.syncQueue : [],
      };

      memoryStoreCache = applyTombstonesToStore(initialStore);
      return memoryStoreCache;
    }
  } catch {
    // ignore storage read error
  }

  memoryStoreCache = {
    schemaVersion: STORE_SCHEMA_VERSION,
    quotaExceeded: false,
    quotaExceededAtMs: 0,
    classes: defaultClasses,
    students: [],
    deletedStudentIds: [],
    tombstones: [],
    registrations: [],
    reports: [],
    logs: [],
    accountAccess: [],
    archivedYears: [],
    permissionGroups: getDefaultPermissionGroups(),
    classInvites: [],
    mealPricingRules: [],
    mealPricingLogs: [],
    mealBillingConfigs: [],
    mealPayments: [],
    mealPaymentLogs: [],
    monthlySettlements: [],
    settings: defaultSettings,
    syncQueue: [],
  };
  return memoryStoreCache;
}

export function queueSyncOperation(item: Omit<SyncQueueItem, 'id' | 'timestampIso'>) {
  const vn = getVietnamDateParts(new Date());
  const action = item.action || 'upsert';
  const queueItem: SyncQueueItem = {
    action,
    ...item,
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestampIso: vn.fullDisplay,
  };

  saveHybridStore((prev) => {
    // Block queuing stale upserts for tombstoned documents
    if (action !== 'delete' && TOMBSTONE_COLLECTIONS.has(item.collectionName)) {
      const tombSet = buildTombstoneSet(
        prev.tombstones || [],
        item.collectionName as TombstoneCollection
      );
      if (tombSet.has(item.documentId)) {
        return prev;
      }
    }

    // Deduplicate prior operations on the same (collectionName, documentId)
    const filteredQueue = (prev.syncQueue || []).filter(
      (q) => !(q.collectionName === item.collectionName && q.documentId === item.documentId)
    );

    return {
      ...prev,
      syncQueue: [...filteredQueue, queueItem],
    };
  });
}

// Align Firestore network state on module initialization
if (typeof window !== 'undefined' && getHybridStore().quotaExceeded) {
  void setFirestoreNetworkEnabled(false);
}

export function canWriteToCloudFirestore(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  return !getHybridStore().quotaExceeded;
}

export function saveHybridStore(
  updater: (prev: HybridLocalStore) => HybridLocalStore,
  options?: { skipTombstoneSweep?: boolean }
): HybridLocalStore {
  const current = getHybridStore();
  const nextRaw: HybridLocalStore = {
    ...updater(current),
    schemaVersion: STORE_SCHEMA_VERSION,
  };
  const updated = options?.skipTombstoneSweep ? nextRaw : applyTombstonesToStore(nextRaw);
  memoryStoreCache = updated;

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_STORE_EVENT, { detail: updated }));
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const compact = buildCompactLocalStorageSnapshot(updated, false);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Retry with aggressive pruning of historical caches so 5MB browser quota never blocks Cloud saves
      try {
        const aggressive = buildCompactLocalStorageSnapshot(updated, true);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(aggressive));
      } catch {
        // Persist at minimum the syncQueue, tombstones, invites, and settings if storage is tightly constrained
        try {
          const minimal: HybridLocalStore = {
            ...buildCompactLocalStorageSnapshot(updated, true),
            students: [],
            registrations: [],
            logs: [],
            archivedYears: [],
            mealPaymentLogs: [],
            mealPricingLogs: [],
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
        } catch {
          // Keep operating purely in memory so Cloud Firestore writes are never blocked
        }
      }
    }
  }
  return updated;
}

export function markQuotaExceeded(flag: boolean): void {
  void setFirestoreNetworkEnabled(!flag);
  saveHybridStore((prev) => ({
    ...prev,
    quotaExceeded: flag,
    quotaExceededAtMs: flag ? Date.now() : 0,
  }));
}

export function isTrueQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('resource-exhausted') ||
    msg.includes('Quota exceeded') ||
    msg.includes('quota exceeded')
  );
}

export function isQuotaOrTimeoutError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('resource-exhausted') ||
    msg.includes('Quota') ||
    msg.includes('quota') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('Failed to get document because the client is offline') ||
    msg.includes('FIRESTORE_WRITE_TIMEOUT')
  );
}

export async function withFastFirestoreTimeout<T>(
  taskOrPromise: Promise<T> | (() => Promise<T>),
  ms = 5000
): Promise<T> {
  if (!canWriteToCloudFirestore()) {
    throw new Error('FIRESTORE_WRITE_TIMEOUT: Offline or quota exceeded');
  }
  const promise = typeof taskOrPromise === 'function' ? taskOrPromise() : taskOrPromise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('FIRESTORE_WRITE_TIMEOUT')), ms)
    ),
  ]);
}

function getQueuePriority(item: SyncQueueItem): number {
  if (item.collectionName === 'deletionTombstones' && item.action !== 'delete') return 0;
  if (item.collectionName === 'deletionTombstones' && item.action === 'delete') return 2;
  if (item.action === 'delete') return 1;
  if (item.collectionName === 'classInvites') return 3;
  return 4;
}

const APPEND_ONLY_COLLECTIONS = new Set<string>([
  'registrationLogs',
  'archivedYears',
  'mealPricingLogs',
  'mealPaymentLogs',
]);

export async function flushSyncQueueToFirestore(): Promise<number> {
  const store = getHybridStore();
  const rawQueue = store.syncQueue || [];
  if (rawQueue.length === 0 || !canWriteToCloudFirestore()) return 0;

  // Enforce tombstones and process deletes/tombstones BEFORE upserts
  const orderedQueue = [...rawQueue]
    .filter((item) => {
      if (item.action !== 'delete' && TOMBSTONE_COLLECTIONS.has(item.collectionName)) {
        const blocked = buildTombstoneSet(
          store.tombstones || [],
          item.collectionName as TombstoneCollection
        );
        return !blocked.has(item.documentId);
      }
      return true;
    })
    .sort((a, b) => getQueuePriority(a) - getQueuePriority(b));

  let synced = 0;
  const remaining: SyncQueueItem[] = [];
  let abortedAtIndex = -1;

  const processSingleItem = async (
    item: SyncQueueItem
  ): Promise<'synced' | 'retry_later' | 'drop' | 'quota_abort'> => {
    try {
      const ref = doc(db, item.collectionName, item.documentId);
      if (item.action === 'delete') {
        await withFastFirestoreTimeout(() => deleteDoc(ref), 8000);
      } else {
        const cleanPayload = { ...(item.payload || {}) };
        delete cleanPayload.createdAt;
        delete cleanPayload.updatedAt;

        const existingSnap = await withFastFirestoreTimeout(() => getDoc(ref), 8000);
        if (existingSnap.exists()) {
          if (APPEND_ONLY_COLLECTIONS.has(item.collectionName)) {
            return 'synced';
          }
          // Preserve existing createdAt so Firestore update rules (incoming().createdAt == existing().createdAt) succeed
          await withFastFirestoreTimeout(
            () =>
              setDoc(
                ref,
                {
                  ...cleanPayload,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ),
            8000
          );
        } else {
          await withFastFirestoreTimeout(
            () =>
              setDoc(ref, {
                ...cleanPayload,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }),
            8000
          );
        }
      }
      return 'synced';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: string })?.code || '';
      if (item.action === 'delete' && (errCode === 'not-found' || errMsg.includes('not-found'))) {
        return 'synced';
      }
      if (isTrueQuotaError(err)) {
        markQuotaExceeded(true);
        return 'quota_abort';
      }
      if (isQuotaOrTimeoutError(err)) {
        return 'retry_later';
      }
      const isPermOrInvalid =
        errCode === 'permission-denied' ||
        errCode === 'invalid-argument' ||
        errMsg.includes('permission-denied') ||
        errMsg.includes('Missing or insufficient permissions') ||
        errMsg.includes('invalid-argument');
      return isPermOrInvalid ? 'drop' : 'retry_later';
    }
  };

  // Process in concurrent chunks grouped by priority tier so tombstones/deletes still finish before upserts
  const CHUNK_SIZE = 10;
  let i = 0;
  while (i < orderedQueue.length) {
    const currentPriority = getQueuePriority(orderedQueue[i]);
    const chunk: SyncQueueItem[] = [];
    while (
      i < orderedQueue.length &&
      chunk.length < CHUNK_SIZE &&
      getQueuePriority(orderedQueue[i]) === currentPriority
    ) {
      chunk.push(orderedQueue[i]);
      i++;
    }

    const outcomes = await Promise.all(chunk.map((item) => processSingleItem(item)));
    let shouldBreak = false;
    for (let j = 0; j < chunk.length; j++) {
      const outcome = outcomes[j];
      if (outcome === 'synced') {
        synced++;
      } else if (outcome === 'drop') {
        // drop permanent invalid/permission item to prevent queue deadlock
      } else if (outcome === 'quota_abort') {
        remaining.push(chunk[j]);
        for (let k = j + 1; k < chunk.length; k++) remaining.push(chunk[k]);
        abortedAtIndex = i;
        shouldBreak = true;
        break;
      } else {
        remaining.push(chunk[j]);
      }
    }
    if (shouldBreak) break;
  }

  if (abortedAtIndex >= 0 && abortedAtIndex < orderedQueue.length) {
    remaining.push(...orderedQueue.slice(abortedAtIndex));
  }

  saveHybridStore(
    (prev) => ({
      ...prev,
      syncQueue: remaining,
    }),
    { skipTombstoneSweep: true }
  );

  return synced;
}

export function getActiveStorageProjectId(): string {
  return activeFirebaseConfig.projectId;
}
