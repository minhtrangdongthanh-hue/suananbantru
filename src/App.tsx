/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  CheckSquare,
  Clock,
  Database,
  ExternalLink,
  FileSpreadsheet,
  GraduationCap,
  KeyRound,
  LogIn,
  LogOut,
  QrCode,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { activeFirebaseConfig, auth, db, googleProvider } from './firebase';
import {
  AccountAccess,
  AccountStatus,
  AppModuleId,
  ArchivedYearSnapshot,
  BOOTSTRAPPED_ADMIN_EMAIL,
  ClassInvite,
  DailyReport,
  DEFAULT_CUTOFF_TIME,
  DeletionTombstone,
  extractInviteCodeFromText,
  formatVietnameseDate,
  getAccountStatusLabel,
  getDefaultPermissionGroups,
  getInviteDisplayLabel,
  getInviteTargetRole,
  getRoleLabel,
  getVietnamDateParts,
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
  PermissionGroup,
  RegistrationLog,
  resolveEffectiveGroup,
  sanitizeString,
  SCHOOL_ID,
  SchoolClass,
  SchoolSetting,
  Student,
  UserProfile,
  UserRole,
} from './types';
import {
  batchRegisterClassMeals,
  exportDailyReportToExcel,
  exportFullBackupJson,
  initializeStandard61Classes,
  lockDailyReportTransaction,
  performFullBidirectionalSync,
  redeemClassInviteCode,
  registerStudentMeal,
  resolveInviteLinkSession,
  saveSchoolClass,
  saveSchoolSettings,
  saveStudent,
  syncPendingRegistrationsToCloud,
  unlockDailyReport,
} from './services/mealService';
import {
  applyTombstonesToStore,
  buildTombstoneSet,
  filterOutTombstoned,
  getHybridStore,
  getTombstoneId,
  HybridLocalStore,
  isTrueQuotaError,
  LOCAL_STORE_EVENT,
  markQuotaExceeded,
  mergeTombstones,
  reconcileCollectionWithCloud,
  saveHybridStore,
  serializeForDiff,
  withFastFirestoreTimeout,
} from './services/localStoreFallback';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { RegistrationWorkspaceView } from './components/RegistrationWorkspaceView';
import { AccountantMedicalReportView } from './components/AccountantMedicalReportView';
import { StudentManagementModule } from './components/StudentManagementModule';
import { UserManagementView } from './components/UserManagementView';
import { AdminManagementView } from './components/AdminManagementView';
import { VerificationCenterView } from './components/VerificationCenterView';
import { StorageAccountModal } from './components/StorageAccountModal';
import { MonthlyMealBillingView } from './components/MonthlyMealBillingView';

type ActiveTab = AppModuleId;

const PENDING_INVITE_STORAGE_KEY = 'thcs_dong_thanh_pending_invite';
const LINK_SESSION_STORAGE_KEY = 'THCS_DONG_THANH_LINK_SESSION_V1';

interface LinkSession {
  code: string;
  invite: ClassInvite;
  enteredAtIso: string;
}

function readUrlInviteCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const search = new URLSearchParams(window.location.search);
    let raw = search.get('invite') || search.get('access') || search.get('link') || '';
    if (!raw && window.location.hash && window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.slice(window.location.hash.indexOf('?'));
      const hashParams = new URLSearchParams(hashQuery);
      raw = hashParams.get('invite') || hashParams.get('access') || hashParams.get('link') || '';
    }
    return raw ? normalizeInviteCode(raw) : '';
  } catch {
    return '';
  }
}

function readInitialInviteCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = readUrlInviteCode();
    if (fromUrl) {
      sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return normalizeInviteCode(sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function clearPendingInviteStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of ['invite', 'access', 'link']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        dirty = true;
      }
    }
    if (dirty) {
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // ignore storage/history errors
  }
}

function readSavedLinkSession(): LinkSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LINK_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LinkSession;
    if (!parsed || !parsed.code || !parsed.invite || !parsed.invite.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLinkSession(session: LinkSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      localStorage.removeItem(LINK_SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(LINK_SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore localStorage errors
  }
}

async function decodeQrCodeFromFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được file ảnh mã QR.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('File ảnh không hợp lệ.'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ đọc ảnh QR.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  if (!result || !result.data) {
    throw new Error('Không tìm thấy mã QR hợp lệ trong ảnh vừa chọn.');
  }
  return result.data;
}

function mergeById<T extends { id: string }>(baseList: T[], cloudList: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of baseList) map.set(item.id, item);
  for (const item of cloudList) map.set(item.id, item);
  return Array.from(map.values());
}

function getDefaultTabForGroup(
  role: UserRole,
  group: PermissionGroup,
  isLinkUser = false
): ActiveTab {
  const preferredOrder: ActiveTab[] = isLinkUser
    ? role === 'teacher'
      ? ['teacher', 'monthly_billing', 'reports', 'students', 'verify']
      : ['reports', 'monthly_billing', 'teacher', 'students', 'verify']
    : role === 'teacher'
    ? ['teacher', 'monthly_billing', 'reports', 'students', 'users', 'admin', 'verify']
    : ['reports', 'monthly_billing', 'teacher', 'students', 'users', 'admin', 'verify'];
  for (const tab of preferredOrder) {
    if (group.allowedModules.includes(tab)) return tab;
  }
  if (isLinkUser) {
    return role === 'teacher' ? 'teacher' : 'reports';
  }
  return group.canShareClassCode ? 'users' : 'reports';
}

function isModuleAllowedForGroup(
  tab: ActiveTab,
  role: UserRole,
  group: PermissionGroup,
  isLinkUser = false
): boolean {
  if (isLinkUser && (tab === 'users' || tab === 'admin')) return false;
  if (!isLinkUser && role === 'admin' && (tab === 'users' || tab === 'admin')) return true;
  if (!isLinkUser && tab === 'users' && group.canShareClassCode) return true;
  return group.allowedModules.includes(tab);
}

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [previewRoleOverride, setPreviewRoleOverride] = useState<UserRole | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [vnClock, setVnClock] = useState(() => getVietnamDateParts(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => getVietnamDateParts(new Date()).dateStr);
  const [activeTab, setActiveTab] = useState<ActiveTab>('reports');

  // Local Store State
  const [localStore, setLocalStore] = useState<HybridLocalStore>(() => getHybridStore());

  // Cloud Firestore State
  const [cloudClasses, setCloudClasses] = useState<SchoolClass[]>([]);
  const [cloudClassesReady, setCloudClassesReady] = useState(false);

  const [cloudStudents, setCloudStudents] = useState<Student[]>([]);
  const [cloudStudentsReady, setCloudStudentsReady] = useState(false);

  const [cloudRegistrations, setCloudRegistrations] = useState<MealRegistration[]>([]);
  const [cloudRegsReady, setCloudRegsReady] = useState(false);

  const [cloudReports, setCloudReports] = useState<DailyReport[]>([]);
  const [cloudReportsReady, setCloudReportsReady] = useState(false);

  const [cloudLogs, setCloudLogs] = useState<RegistrationLog[]>([]);
  const [cloudLogsReady, setCloudLogsReady] = useState(false);

  const [cloudAccounts, setCloudAccounts] = useState<AccountAccess[]>([]);
  const [cloudAccountsReady, setCloudAccountsReady] = useState(false);

  const [cloudArchives, setCloudArchives] = useState<ArchivedYearSnapshot[]>([]);
  const [cloudArchivesReady, setCloudArchivesReady] = useState(false);

  const [cloudTombstones, setCloudTombstones] = useState<DeletionTombstone[]>([]);
  const [cloudTombstonesReady, setCloudTombstonesReady] = useState(false);

  const [cloudPermissionGroups, setCloudPermissionGroups] = useState<PermissionGroup[]>([]);
  const [cloudGroupsReady, setCloudGroupsReady] = useState(false);

  const [cloudClassInvites, setCloudClassInvites] = useState<ClassInvite[]>([]);
  const [cloudInvitesReady, setCloudInvitesReady] = useState(false);

  const [cloudPricingRules, setCloudPricingRules] = useState<MealPricingRule[]>([]);
  const [cloudPricingRulesReady, setCloudPricingRulesReady] = useState(false);

  const [cloudPricingLogs, setCloudPricingLogs] = useState<MealPricingLog[]>([]);
  const [cloudPricingLogsReady, setCloudPricingLogsReady] = useState(false);

  const [cloudBillingConfigs, setCloudBillingConfigs] = useState<MealBillingConfig[]>([]);
  const [cloudBillingConfigsReady, setCloudBillingConfigsReady] = useState(false);

  const [cloudPayments, setCloudPayments] = useState<MealPayment[]>([]);
  const [cloudPaymentsReady, setCloudPaymentsReady] = useState(false);

  const [cloudPaymentLogs, setCloudPaymentLogs] = useState<MealPaymentLog[]>([]);
  const [cloudPaymentLogsReady, setCloudPaymentLogsReady] = useState(false);

  const [cloudSettlements, setCloudSettlements] = useState<MonthlySettlement[]>([]);
  const [cloudSettlementsReady, setCloudSettlementsReady] = useState(false);

  const [cloudSettings, setCloudSettings] = useState<SchoolSetting | null>(null);

  const [linkSession, setLinkSession] = useState<LinkSession | null>(() => readSavedLinkSession());
  const [linkResolving, setLinkResolving] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(readUrlInviteCode() || readSavedLinkSession());
  });
  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() => readInitialInviteCode());
  const [landingInviteInput, setLandingInviteInput] = useState<string>(() => readInitialInviteCode());
  const [pendingScreenInviteInput, setPendingScreenInviteInput] = useState<string>(() =>
    readInitialInviteCode()
  );
  const [inviteRedeemBusy, setInviteRedeemBusy] = useState(false);
  const [inviteRedeemNotice, setInviteRedeemNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [selectedClassId, setSelectedClassId] = useState<string>(() => {
    const saved = readSavedLinkSession();
    return saved && getInviteTargetRole(saved.invite) === 'teacher'
      ? saved.invite.classId
      : 'production_class_6_1';
  });
  const [showStorageModal, setShowStorageModal] = useState<boolean>(false);
  const [syncBusy, setSyncBusy] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const autoLockedDatesRef = useRef<Set<string>>(new Set());
  const startupLinkResolvedRef = useRef<string | null>(null);

  // Listen to Local Store updates
  useEffect(() => {
    const handleStoreUpdate = (e: Event) => {
      const custom = e as CustomEvent<HybridLocalStore>;
      if (custom.detail) {
        setLocalStore(custom.detail);
      } else {
        setLocalStore(getHybridStore());
      }
    };
    window.addEventListener(LOCAL_STORE_EVENT, handleStoreUpdate);
    return () => window.removeEventListener(LOCAL_STORE_EVENT, handleStoreUpdate);
  }, []);

  // Tick Vietnam Clock every 15 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setVnClock(getVietnamDateParts(new Date()));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Auth Bootstrap & AccountAccess Enforcement
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const isInviteAuth = Boolean(user?.uid.startsWith('invite_'));
      setFbUser(isInviteAuth ? null : user);
      setPreviewRoleOverride(null);
      if (isInviteAuth) {
        setUserProfile(null);
        setAuthReady(true);
        return;
      }
      if (!user) {
        setUserProfile(null);
        setCloudClasses([]);
        setCloudClassesReady(false);
        setCloudStudents([]);
        setCloudStudentsReady(false);
        setCloudRegistrations([]);
        setCloudRegsReady(false);
        setCloudReports([]);
        setCloudReportsReady(false);
        setCloudLogs([]);
        setCloudLogsReady(false);
        setCloudAccounts([]);
        setCloudAccountsReady(false);
        setCloudArchives([]);
        setCloudArchivesReady(false);
        setCloudTombstones([]);
        setCloudTombstonesReady(false);
        setCloudPermissionGroups([]);
        setCloudGroupsReady(false);
        setCloudClassInvites([]);
        setCloudInvitesReady(false);
        setCloudPricingRules([]);
        setCloudPricingRulesReady(false);
        setCloudPricingLogs([]);
        setCloudPricingLogsReady(false);
        setCloudBillingConfigs([]);
        setCloudBillingConfigsReady(false);
        setCloudPayments([]);
        setCloudPaymentsReady(false);
        setCloudPaymentLogs([]);
        setCloudPaymentLogsReady(false);
        setCloudSettlements([]);
        setCloudSettlementsReady(false);
        setCloudSettings(null);
        autoLockedDatesRef.current.clear();
        setAuthReady(true);
        return;
      }

      const cleanEmail = sanitizeString((user.email || '').toLowerCase(), 256, 'user@thcsdongthanh.edu.vn');
      const emailKey = normalizeEmailKey(cleanEmail);
      const isBootAdmin = cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL;
      const vnNow = getVietnamDateParts(new Date());

      const storeAtLogin = getHybridStore();
      const accountTombstoneId = getTombstoneId('accountAccess', emailKey);
      const isLocallyTombstoned = (storeAtLogin.tombstones || []).some(
        (t) =>
          t.id === accountTombstoneId ||
          (t.collectionName === 'accountAccess' && t.documentId === emailKey)
      );

      // Check local accountAccess first in case quotaExceeded or offline
      const localAccess = isLocallyTombstoned
        ? undefined
        : storeAtLogin.accountAccess.find((a) => a.id === emailKey);

      const initialRole: UserRole = isBootAdmin ? 'admin' : localAccess?.role || 'teacher';
      const initialProfile: UserProfile = {
        uid: user.uid,
        email: cleanEmail,
        displayName: sanitizeString(
          localAccess?.displayName || user.displayName || cleanEmail,
          120
        ),
        role: initialRole,
        status: isBootAdmin
          ? 'active'
          : isLocallyTombstoned
          ? 'revoked'
          : localAccess?.status || 'pending',
        assignedClassId: isBootAdmin ? '' : localAccess?.assignedClassId || '',
        linkedStudentId: '',
        joinedInviteCode: localAccess?.joinedInviteCode || '',
        lastLoginAtIso: vnNow.fullDisplay,
        schoolId: SCHOOL_ID,
      };

      setUserProfile(initialProfile);
      const localGroup = resolveEffectiveGroup(
        initialRole,
        storeAtLogin.permissionGroups || getDefaultPermissionGroups()
      );
      setActiveTab(getDefaultTabForGroup(initialRole, localGroup));
      if (initialProfile.assignedClassId) {
        setSelectedClassId(initialProfile.assignedClassId);
      }
      setAuthReady(true);

      const savedInvite = readInitialInviteCode();
      const canTryLocalRedeem =
        !isBootAdmin &&
        !isLocallyTombstoned &&
        Boolean(savedInvite) &&
        (initialProfile.status === 'pending' ||
          (initialProfile.role === 'teacher' &&
            initialProfile.status === 'active' &&
            !initialProfile.assignedClassId));

      if (isBootAdmin) {
        saveLinkSession(null);
        setLinkSession(null);
        clearPendingInviteStorage();
        setPendingInviteCode('');
      }

      if (storeAtLogin.quotaExceeded) {
        if (canTryLocalRedeem && savedInvite) {
          try {
            const redeemed = await redeemClassInviteCode({
              codeOrUrl: savedInvite,
              uid: user.uid,
              email: cleanEmail,
              displayName: initialProfile.displayName,
            });
            setUserProfile(redeemed.profile);
            if (getInviteTargetRole(redeemed.invite) === 'teacher') {
              setSelectedClassId(redeemed.invite.classId);
            }
            const g = resolveEffectiveGroup(
              redeemed.profile.role,
              getHybridStore().permissionGroups || getDefaultPermissionGroups()
            );
            setActiveTab(getDefaultTabForGroup(redeemed.profile.role, g, false));
            clearPendingInviteStorage();
            setPendingInviteCode('');
            setInviteRedeemNotice({
              type: 'success',
              text: `Đã kích hoạt quyền (${getInviteDisplayLabel(redeemed.invite)}) bằng mã ${redeemed.invite.code}.`,
            });
          } catch (err) {
            clearPendingInviteStorage();
            setPendingInviteCode('');
            setInviteRedeemNotice({
              type: 'error',
              text: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }

      try {
        const accessRef = doc(db, 'accountAccess', emailKey);
        const userRef = doc(db, 'users', user.uid);
        const tombRef = doc(db, 'deletionTombstones', accountTombstoneId);
        const [accessSnap, userSnap, tombSnap] = await withFastFirestoreTimeout(
          () => Promise.all([getDoc(accessRef), getDoc(userRef), getDoc(tombRef)]),
          5000
        );

        const isTombstonedAccount =
          !isBootAdmin && (tombSnap.exists() || isLocallyTombstoned) && !accessSnap.exists();

        let resolvedRole: UserRole = initialProfile.role;
        let resolvedStatus: AccountStatus = initialProfile.status;
        let resolvedClassId: string = initialProfile.assignedClassId;
        let resolvedName: string = initialProfile.displayName;
        let resolvedJoinedInviteCode: string = initialProfile.joinedInviteCode;

        if (isBootAdmin) {
          resolvedRole = 'admin';
          resolvedStatus = 'active';
          resolvedClassId = '';
        } else if (isTombstonedAccount) {
          resolvedRole = 'teacher';
          resolvedStatus = 'revoked';
          resolvedClassId = '';
          resolvedJoinedInviteCode = '';
        } else if (accessSnap.exists()) {
          const accData = accessSnap.data() as AccountAccess;
          resolvedRole = accData.role;
          resolvedStatus = accData.status;
          resolvedClassId = accData.assignedClassId || '';
          resolvedName = accData.displayName || resolvedName;
          resolvedJoinedInviteCode = accData.joinedInviteCode || '';
        } else if (userSnap.exists()) {
          const uData = userSnap.data() as UserProfile;
          resolvedRole = uData.role || 'teacher';
          resolvedStatus = uData.status || 'pending';
          resolvedClassId = uData.assignedClassId || '';
          resolvedName = uData.displayName || resolvedName;
          resolvedJoinedInviteCode = uData.joinedInviteCode || '';
        } else {
          resolvedRole = 'teacher';
          resolvedStatus = 'pending';
          resolvedClassId = '';
          resolvedJoinedInviteCode = '';
        }

        const syncedProfile: UserProfile = {
          uid: user.uid,
          email: cleanEmail,
          displayName: resolvedName,
          role: resolvedRole,
          status: resolvedStatus,
          assignedClassId: resolvedClassId,
          linkedStudentId: '',
          joinedInviteCode: resolvedJoinedInviteCode,
          lastLoginAtIso: vnNow.fullDisplay,
          schoolId: SCHOOL_ID,
        };

        // If account was explicitly deleted (tombstoned), do NOT recreate /accountAccess or /users on Firestore!
        if (isTombstonedAccount) {
          setUserProfile(syncedProfile);
          saveHybridStore((prev) =>
            applyTombstonesToStore(prev, [
              {
                id: accountTombstoneId,
                collectionName: 'accountAccess',
                documentId: emailKey,
                deletedAtMs: Date.now(),
                deletedAtIso: vnNow.fullDisplay,
                deletedByUid: 'system',
                reason: 'Tài khoản đã bị xóa khỏi danh sách phân quyền',
                env: 'production',
                schoolId: SCHOOL_ID,
                visibility: 'school',
              },
            ])
          );
          return;
        }

        // Persist user profile & accountAccess record on cloud FIRST
        const accessPayload: AccountAccess = {
          id: emailKey,
          email: cleanEmail,
          displayName: resolvedName,
          role: resolvedRole,
          status: resolvedStatus,
          assignedClassId: resolvedRole === 'teacher' ? resolvedClassId : '',
          joinedInviteCode: resolvedJoinedInviteCode,
          uid: user.uid,
          lastLoginAtIso: vnNow.fullDisplay,
          schoolId: SCHOOL_ID,
          visibility: 'school',
          updatedByUid: user.uid,
        };

        await withFastFirestoreTimeout(async () => {
          if (userSnap.exists()) {
            await updateDoc(userRef, {
              role: resolvedRole,
              status: resolvedStatus,
              assignedClassId: syncedProfile.assignedClassId,
              joinedInviteCode: resolvedJoinedInviteCode,
              displayName: resolvedName,
              lastLoginAtIso: vnNow.fullDisplay,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(userRef, {
              ...syncedProfile,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          if (accessSnap.exists()) {
            await updateDoc(accessRef, {
              uid: user.uid,
              lastLoginAtIso: vnNow.fullDisplay,
              role: resolvedRole,
              status: resolvedStatus,
              assignedClassId: accessPayload.assignedClassId,
              joinedInviteCode: resolvedJoinedInviteCode,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(accessRef, {
              ...accessPayload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }, 5000);

        if (resolvedStatus === 'active' && resolvedRole === 'admin') {
          saveLinkSession(null);
          setLinkSession(null);
          clearPendingInviteStorage();
          setPendingInviteCode('');
        }

        // Auto-redeem saved invite code if Google user is pending (or unassigned teacher)
        const eligibleForInviteAutoRedeem =
          !isBootAdmin &&
          Boolean(savedInvite) &&
          (resolvedStatus === 'pending' ||
            (resolvedRole === 'teacher' && resolvedStatus === 'active' && !resolvedClassId));

        if (eligibleForInviteAutoRedeem && savedInvite) {
          try {
            const redeemed = await redeemClassInviteCode({
              codeOrUrl: savedInvite,
              uid: user.uid,
              email: cleanEmail,
              displayName: resolvedName,
            });
            setUserProfile(redeemed.profile);
            if (getInviteTargetRole(redeemed.invite) === 'teacher') {
              setSelectedClassId(redeemed.invite.classId);
            }
            const g = resolveEffectiveGroup(
              redeemed.profile.role,
              getHybridStore().permissionGroups || getDefaultPermissionGroups()
            );
            setActiveTab(getDefaultTabForGroup(redeemed.profile.role, g, false));
            clearPendingInviteStorage();
            setPendingInviteCode('');
            setInviteRedeemNotice({
              type: 'success',
              text: `Đã kích hoạt quyền (${getInviteDisplayLabel(redeemed.invite)}) bằng mã ${redeemed.invite.code}.`,
            });
            void performFullBidirectionalSync().catch(() => {});
            return;
          } catch (redeemErr) {
            clearPendingInviteStorage();
            setPendingInviteCode('');
            setInviteRedeemNotice({
              type: 'error',
              text: redeemErr instanceof Error ? redeemErr.message : String(redeemErr),
            });
          }
        }

        setUserProfile(syncedProfile);
        const latestGroups =
          getHybridStore().permissionGroups || getDefaultPermissionGroups();
        setActiveTab(
          getDefaultTabForGroup(resolvedRole, resolveEffectiveGroup(resolvedRole, latestGroups), false)
        );
        if (resolvedClassId) {
          setSelectedClassId(resolvedClassId);
        }

        saveHybridStore((prev) => ({
          ...prev,
          accountAccess: [...prev.accountAccess.filter((a) => a.id !== emailKey), accessPayload],
        }));

        if (resolvedStatus === 'active') {
          void performFullBidirectionalSync().catch(() => {
            // handled gracefully by fallback listeners
          });
        }
      } catch (err) {
        if (isTrueQuotaError(err)) {
          markQuotaExceeded(true);
        }
      }
    });
    return () => unsub();
  }, []);

  // Passwordless Invite-Link Startup Resolution (for Members opening ?invite=... or returning in saved LinkSession)
  useEffect(() => {
    if (!authReady) return;
    const urlCode = readUrlInviteCode();

    if (fbUser) {
      const isGoogleAdmin =
        fbUser.email?.toLowerCase().trim() === BOOTSTRAPPED_ADMIN_EMAIL ||
        userProfile?.role === 'admin';
      // If a non-admin Google user (e.g. pending personal Gmail on phone) opens an explicit ?invite= link,
      // sign out the stray Google session so they enter directly with the link's passwordless permissions.
      if (!isGoogleAdmin && urlCode && userProfile && userProfile.joinedInviteCode !== urlCode) {
        void signOut(auth).catch(() => {
          setLinkResolving(false);
        });
        return;
      }
      setLinkResolving(false);
      return;
    }

    const saved = readSavedLinkSession();
    const targetCode = urlCode || saved?.code || '';

    if (!targetCode) {
      setLinkResolving(false);
      return;
    }

    if (startupLinkResolvedRef.current === targetCode) {
      setLinkResolving(false);
      return;
    }
    startupLinkResolvedRef.current = targetCode;

    let cancelled = false;
    setLinkResolving(true);

    void resolveInviteLinkSession(targetCode)
      .then((invite) => {
        if (cancelled) return;
        const vnNow = getVietnamDateParts(new Date());
        const nextSession: LinkSession = {
          code: invite.code,
          invite,
          enteredAtIso: vnNow.fullDisplay,
        };
        saveLinkSession(nextSession);
        setLinkSession(nextSession);
        clearPendingInviteStorage();
        setPendingInviteCode('');

        const targetRole = getInviteTargetRole(invite);
        if (targetRole === 'teacher' && invite.classId) {
          setSelectedClassId(invite.classId);
        }
        const groups = getHybridStore().permissionGroups || getDefaultPermissionGroups();
        setActiveTab(getDefaultTabForGroup(targetRole, resolveEffectiveGroup(targetRole, groups), true));
        void performFullBidirectionalSync().catch(() => {
          // fallback cleanly
        });
      })
      .catch((err) => {
        if (cancelled) return;
        saveLinkSession(null);
        setLinkSession(null);
        startupLinkResolvedRef.current = null;
        // Keep ?invite= in URL and input fields so mobile users can retry immediately when 4G/WiFi reconnects
        setPendingInviteCode(targetCode);
        setLandingInviteInput(targetCode);
        setPendingScreenInviteInput(targetCode);
        setInviteRedeemNotice({
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLinkResolving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, fbUser, userProfile]);

  // Real-time Status & Role Enforcement on current user's /accountAccess/{emailKey} (Google users)
  useEffect(() => {
    if (!authReady || !fbUser || localStore.quotaExceeded) return;
    const cleanEmail = (fbUser.email || '').toLowerCase().trim();
    const isBootAdmin = cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL;
    const emailKey = normalizeEmailKey(cleanEmail);

    const unsubAccess = onSnapshot(
      doc(db, 'accountAccess', emailKey),
      (snap) => {
        if (!snap.exists()) {
          if (!isBootAdmin && !snap.metadata.fromCache) {
            setUserProfile((prev) => {
              if (!prev || prev.status !== 'active') return prev;
              return { ...prev, status: 'revoked' };
            });
          }
          return;
        }
        const acc = snap.data() as AccountAccess;
        setUserProfile((prev) => {
          if (!prev) return prev;
          const nextRole = isBootAdmin ? 'admin' : acc.role;
          const nextStatus = isBootAdmin ? 'active' : acc.status;
          const nextClass = isBootAdmin ? '' : acc.assignedClassId || '';
          if (
            prev.role === nextRole &&
            prev.status === nextStatus &&
            prev.assignedClassId === nextClass
          ) {
            return prev;
          }
          return {
            ...prev,
            role: nextRole,
            status: nextStatus,
            assignedClassId: nextClass,
            displayName: acc.displayName || prev.displayName,
          };
        });
      },
      () => {
        // ignore listener error
      }
    );

    return () => {
      unsubAccess();
    };
  }, [authReady, fbUser, localStore.quotaExceeded]);

  // Real-time Revocation & Label Watcher for Passwordless Link Session (/classInvites/{code})
  useEffect(() => {
    if (!authReady || fbUser || !linkSession || localStore.quotaExceeded) return;

    const unsubInviteDoc = onSnapshot(
      doc(db, 'classInvites', linkSession.code),
      (snap) => {
        if (!snap.exists()) {
          if (!snap.metadata.fromCache) {
            saveLinkSession(null);
            setLinkSession(null);
            startupLinkResolvedRef.current = null;
            setInviteRedeemNotice({
              type: 'error',
              text: 'Liên kết truy cập này đã bị Quản trị viên thu hồi hoặc xóa.',
            });
          }
          return;
        }
        const data = snap.data() as ClassInvite;
        if (!data.active) {
          saveLinkSession(null);
          setLinkSession(null);
          startupLinkResolvedRef.current = null;
          setInviteRedeemNotice({
            type: 'error',
            text: 'Liên kết truy cập này hiện đã bị Quản trị viên tạm khóa.',
          });
          return;
        }
        setLinkSession((prev) => {
          if (!prev) return prev;
          if (
            prev.invite.memberLabel === data.memberLabel &&
            prev.invite.role === data.role &&
            prev.invite.classId === data.classId &&
            prev.invite.active === data.active
          ) {
            return prev;
          }
          const updated: LinkSession = { ...prev, invite: data };
          saveLinkSession(updated);
          return updated;
        });
      },
      () => {
        // ignore listener error when offline
      }
    );

    return () => unsubInviteDoc();
  }, [authReady, fbUser, linkSession?.code, localStore.quotaExceeded]);

  // Attach Real-Time Firestore Collection Listeners (Active Google session OR Verified Link session)
  useEffect(() => {
    const hasActiveGoogleUser = Boolean(fbUser) && (!userProfile || userProfile.status === 'active');
    const hasActiveLinkUser = !fbUser && Boolean(linkSession);
    if (!authReady || (!hasActiveGoogleUser && !hasActiveLinkUser) || localStore.quotaExceeded) return;

    const schoolFilter = [
      where('schoolId', '==', SCHOOL_ID),
      where('visibility', '==', 'school'),
    ];

    const onSnapshotError = (err: unknown) => {
      if (isTrueQuotaError(err)) {
        markQuotaExceeded(true);
      }
    };

    const unsubClasses = onSnapshot(
      query(collection(db, 'classes'), ...schoolFilter),
      (snap) => {
        setCloudClasses(snap.docs.map((d) => d.data() as SchoolClass));
        setCloudClassesReady(true);
      },
      onSnapshotError
    );

    const unsubStudents = onSnapshot(
      query(collection(db, 'students'), ...schoolFilter),
      (snap) => {
        // Always update unconditionally even when empty so bulk delete syncs cleanly!
        setCloudStudents(snap.docs.map((d) => d.data() as Student));
        setCloudStudentsReady(true);
      },
      onSnapshotError
    );

    const unsubTombstones = onSnapshot(
      query(collection(db, 'deletionTombstones'), ...schoolFilter),
      (snap) => {
        setCloudTombstones(snap.docs.map((d) => d.data() as DeletionTombstone));
        setCloudTombstonesReady(true);
      },
      onSnapshotError
    );

    const unsubRegs = onSnapshot(
      query(collection(db, 'registrations'), ...schoolFilter),
      (snap) => {
        setCloudRegistrations(snap.docs.map((d) => d.data() as MealRegistration));
        setCloudRegsReady(true);
      },
      onSnapshotError
    );

    const unsubReports = onSnapshot(
      query(collection(db, 'dailyReports'), ...schoolFilter),
      (snap) => {
        setCloudReports(snap.docs.map((d) => d.data() as DailyReport));
        setCloudReportsReady(true);
      },
      onSnapshotError
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'registrationLogs'), ...schoolFilter),
      (snap) => {
        setCloudLogs(snap.docs.map((d) => d.data() as RegistrationLog));
        setCloudLogsReady(true);
      },
      onSnapshotError
    );

    const unsubAccounts = hasActiveGoogleUser
      ? onSnapshot(
          query(collection(db, 'accountAccess'), ...schoolFilter),
          (snap) => {
            setCloudAccounts(snap.docs.map((d) => d.data() as AccountAccess));
            setCloudAccountsReady(true);
          },
          onSnapshotError
        )
      : () => {
          setCloudAccounts([]);
          setCloudAccountsReady(false);
        };

    const unsubSettings = onSnapshot(
      query(collection(db, 'settings'), ...schoolFilter),
      (snap) => {
        const doc0 = snap.docs[0]?.data() as SchoolSetting | undefined;
        if (doc0) setCloudSettings(doc0);
      },
      onSnapshotError
    );

    const unsubGroups = onSnapshot(
      query(collection(db, 'permissionGroups'), ...schoolFilter),
      (snap) => {
        setCloudPermissionGroups(snap.docs.map((d) => d.data() as PermissionGroup));
        setCloudGroupsReady(true);
      },
      onSnapshotError
    );

    const unsubSettlements = onSnapshot(
      query(collection(db, 'monthlySettlements'), ...schoolFilter),
      (snap) => {
        setCloudSettlements(snap.docs.map((d) => d.data() as MonthlySettlement));
        setCloudSettlementsReady(true);
      },
      onSnapshotError
    );

    return () => {
      unsubClasses();
      unsubStudents();
      unsubTombstones();
      unsubRegs();
      unsubReports();
      unsubLogs();
      unsubAccounts();
      unsubSettings();
      unsubGroups();
      unsubSettlements();
    };
  }, [authReady, fbUser, linkSession?.code, localStore.quotaExceeded, userProfile?.status]);

  // Derived Actor & Permission Group State
  const isLinkUser = !fbUser && Boolean(linkSession);
  const isTrueAdmin =
    Boolean(fbUser) &&
    (fbUser?.email?.toLowerCase().trim() === BOOTSTRAPPED_ADMIN_EMAIL ||
      userProfile?.role === 'admin');
  const linkRole: UserRole = linkSession ? getInviteTargetRole(linkSession.invite) : 'teacher';
  const effectiveRole: UserRole =
    isTrueAdmin && previewRoleOverride
      ? previewRoleOverride
      : fbUser
      ? userProfile?.role || 'teacher'
      : linkRole;

  const permissionGroups = useMemo(() => {
    const base = localStore.permissionGroups || getDefaultPermissionGroups();
    if (cloudGroupsReady && cloudPermissionGroups.length > 0 && !localStore.quotaExceeded) {
      const roles: UserRole[] = ['teacher', 'accountant', 'medical', 'admin'];
      return roles.map((r) => {
        const cloudMatch = cloudPermissionGroups.find((g) => g.id === r);
        const localMatch = base.find((g) => g.id === r);
        return cloudMatch || localMatch || resolveEffectiveGroup(r, []);
      });
    }
    return base;
  }, [
    localStore.permissionGroups,
    cloudPermissionGroups,
    cloudGroupsReady,
    localStore.quotaExceeded,
  ]);

  const effectiveGroup = useMemo(
    () => resolveEffectiveGroup(effectiveRole, permissionGroups),
    [effectiveRole, permissionGroups]
  );

  const needsBillingListeners =
    isTrueAdmin ||
    effectiveGroup.allowedModules.includes('monthly_billing') ||
    effectiveGroup.allowedModules.includes('reports');

  const needsArchiveListener =
    isTrueAdmin ||
    (!isLinkUser &&
      (effectiveGroup.allowedModules.includes('students') ||
        effectiveGroup.allowedModules.includes('admin')));

  // Attach billing & archive listeners only for roles that actually use those modules (cuts teacher mobile load)
  useEffect(() => {
    const hasActiveGoogleUser = Boolean(fbUser) && (!userProfile || userProfile.status === 'active');
    const hasActiveLinkUser = !fbUser && Boolean(linkSession);
    if (!authReady || (!hasActiveGoogleUser && !hasActiveLinkUser) || localStore.quotaExceeded) {
      return;
    }

    const schoolFilter = [
      where('schoolId', '==', SCHOOL_ID),
      where('visibility', '==', 'school'),
    ];
    const onSnapshotError = (err: unknown) => {
      if (isTrueQuotaError(err)) {
        markQuotaExceeded(true);
      }
    };

    const unsubs: Array<() => void> = [];

    if (needsArchiveListener) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'archivedYears'), ...schoolFilter),
          (snap) => {
            setCloudArchives(snap.docs.map((d) => d.data() as ArchivedYearSnapshot));
            setCloudArchivesReady(true);
          },
          onSnapshotError
        )
      );
    }

    if (needsBillingListeners) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'mealPricingRules'), ...schoolFilter),
          (snap) => {
            setCloudPricingRules(snap.docs.map((d) => d.data() as MealPricingRule));
            setCloudPricingRulesReady(true);
          },
          onSnapshotError
        ),
        onSnapshot(
          query(collection(db, 'mealPricingLogs'), ...schoolFilter),
          (snap) => {
            setCloudPricingLogs(snap.docs.map((d) => d.data() as MealPricingLog));
            setCloudPricingLogsReady(true);
          },
          onSnapshotError
        ),
        onSnapshot(
          query(collection(db, 'mealBillingConfigs'), ...schoolFilter),
          (snap) => {
            setCloudBillingConfigs(snap.docs.map((d) => d.data() as MealBillingConfig));
            setCloudBillingConfigsReady(true);
          },
          onSnapshotError
        ),
        onSnapshot(
          query(collection(db, 'mealPayments'), ...schoolFilter),
          (snap) => {
            setCloudPayments(snap.docs.map((d) => d.data() as MealPayment));
            setCloudPaymentsReady(true);
          },
          onSnapshotError
        ),
        onSnapshot(
          query(collection(db, 'mealPaymentLogs'), ...schoolFilter),
          (snap) => {
            setCloudPaymentLogs(snap.docs.map((d) => d.data() as MealPaymentLog));
            setCloudPaymentLogsReady(true);
          },
          onSnapshotError
        )
      );
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [
    authReady,
    fbUser,
    linkSession?.code,
    localStore.quotaExceeded,
    userProfile?.status,
    needsBillingListeners,
    needsArchiveListener,
  ]);

  const canListenClassInvites =
    Boolean(fbUser) &&
    (isTrueAdmin || effectiveGroup.canShareClassCode || effectiveGroup.allowedModules.includes('users'));

  useEffect(() => {
    if (
      !authReady ||
      !fbUser ||
      localStore.quotaExceeded ||
      (userProfile && userProfile.status !== 'active') ||
      !canListenClassInvites
    ) {
      return;
    }

    const schoolFilter = [
      where('schoolId', '==', SCHOOL_ID),
      where('visibility', '==', 'school'),
    ];

    const unsubInvites = onSnapshot(
      query(collection(db, 'classInvites'), ...schoolFilter),
      (snap) => {
        setCloudClassInvites(snap.docs.map((d) => d.data() as ClassInvite));
        setCloudInvitesReady(true);
      },
      (err) => {
        if (isTrueQuotaError(err)) {
          markQuotaExceeded(true);
        }
      }
    );

    return () => unsubInvites();
  }, [authReady, fbUser, localStore.quotaExceeded, userProfile?.status, canListenClassInvites]);

  const pendingAttendanceSyncCount = useMemo(
    () =>
      (localStore.syncQueue || []).filter(
        (q) => q.collectionName === 'registrations' || q.collectionName === 'registrationLogs'
      ).length,
    [localStore.syncQueue]
  );

  // Automatic bidirectional sync when device regains internet connectivity
  useEffect(() => {
    const handleOnline = () => {
      const hasSession =
        (Boolean(fbUser) && (!userProfile || userProfile.status === 'active')) || Boolean(linkSession);
      if (!authReady || !hasSession) return;
      void performFullBidirectionalSync().catch(() => {
        // fallback cleanly
      });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [authReady, fbUser, userProfile?.status, linkSession]);

  // Automatic background flush when there are unsynced attendance items and device comes online/foreground
  useEffect(() => {
    if (pendingAttendanceSyncCount === 0) return;
    const hasSession =
      (Boolean(fbUser) && (!userProfile || userProfile.status === 'active')) || Boolean(linkSession);
    if (!authReady || !hasSession) return;

    const tryFlush = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void syncPendingRegistrationsToCloud().catch(() => {
        // user still sees sticky pending banner with manual retry button
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tryFlush();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(tryFlush, 20000);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [pendingAttendanceSyncCount, authReady, fbUser, userProfile?.status, linkSession]);

  const activeTombstones = useMemo(
    () => mergeTombstones(localStore.tombstones || [], cloudTombstones),
    [localStore.tombstones, cloudTombstones]
  );

  // Debounced Authoritative Cloud + Tombstone sync-back into localStore (never runs blocking JSON diffs on every single UI tap)
  useEffect(() => {
    const hasActiveSession =
      (Boolean(fbUser) && (!userProfile || userProfile.status === 'active')) || Boolean(linkSession);
    if (!authReady || !hasActiveSession || localStore.quotaExceeded) return;
    if (
      !cloudTombstonesReady &&
      !cloudStudentsReady &&
      !cloudRegsReady &&
      !cloudReportsReady &&
      !cloudAccountsReady &&
      !cloudArchivesReady &&
      !cloudClassesReady &&
      !cloudGroupsReady &&
      !cloudInvitesReady &&
      !cloudPricingRulesReady &&
      !cloudPricingLogsReady &&
      !cloudBillingConfigsReady &&
      !cloudPaymentsReady &&
      !cloudPaymentLogsReady &&
      !cloudSettlementsReady
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const currentStore = getHybridStore();
      if (currentStore.quotaExceeded) return;

      const nextTombstones = mergeTombstones(currentStore.tombstones || [], cloudTombstones);

      const nextClasses =
        cloudClassesReady && cloudClasses.length > 0
          ? reconcileCollectionWithCloud({
              collectionName: 'classes',
              cloudItems: cloudClasses,
              cloudReady: true,
              localItems: currentStore.classes,
              tombstones: nextTombstones,
              syncQueue: currentStore.syncQueue,
              preserveSandbox: true,
            })
          : filterOutTombstoned(currentStore.classes, 'classes', nextTombstones);

      const nextStudents = cloudStudentsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'students',
            cloudItems: cloudStudents,
            cloudReady: true,
            localItems: currentStore.students,
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(currentStore.students, 'students', nextTombstones);

      const nextRegs = cloudRegsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'registrations',
            cloudItems: cloudRegistrations,
            cloudReady: true,
            localItems: currentStore.registrations,
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(currentStore.registrations, 'registrations', nextTombstones);

      const nextReports = cloudReportsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'dailyReports',
            cloudItems: cloudReports,
            cloudReady: true,
            localItems: currentStore.reports,
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(currentStore.reports, 'dailyReports', nextTombstones);

      const nextAccounts = cloudAccountsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'accountAccess',
            cloudItems: cloudAccounts,
            cloudReady: true,
            localItems: currentStore.accountAccess,
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
          })
        : filterOutTombstoned(currentStore.accountAccess, 'accountAccess', nextTombstones);

      const nextArchives = cloudArchivesReady
        ? reconcileCollectionWithCloud({
            collectionName: 'archivedYears',
            cloudItems: cloudArchives,
            cloudReady: true,
            localItems: currentStore.archivedYears,
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(currentStore.archivedYears, 'archivedYears', nextTombstones);

      const nextInvites = cloudInvitesReady
        ? reconcileCollectionWithCloud({
            collectionName: 'classInvites',
            cloudItems: cloudClassInvites,
            cloudReady: true,
            localItems: currentStore.classInvites || [],
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
          })
        : filterOutTombstoned(currentStore.classInvites || [], 'classInvites', nextTombstones);

      const nextPricingRules = cloudPricingRulesReady
        ? reconcileCollectionWithCloud({
            collectionName: 'mealPricingRules',
            cloudItems: cloudPricingRules,
            cloudReady: true,
            localItems: currentStore.mealPricingRules || [],
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(
            currentStore.mealPricingRules || [],
            'mealPricingRules',
            nextTombstones
          );

      const nextPricingLogs = cloudPricingLogsReady
        ? mergeById(currentStore.mealPricingLogs || [], cloudPricingLogs)
        : currentStore.mealPricingLogs || [];

      const nextBillingConfigs = cloudBillingConfigsReady
        ? mergeById(currentStore.mealBillingConfigs || [], cloudBillingConfigs)
        : currentStore.mealBillingConfigs || [];

      const nextPayments = cloudPaymentsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'mealPayments',
            cloudItems: cloudPayments,
            cloudReady: true,
            localItems: currentStore.mealPayments || [],
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(currentStore.mealPayments || [], 'mealPayments', nextTombstones);

      const nextPaymentLogs = cloudPaymentLogsReady
        ? mergeById(currentStore.mealPaymentLogs || [], cloudPaymentLogs)
        : currentStore.mealPaymentLogs || [];

      const nextSettlements = cloudSettlementsReady
        ? reconcileCollectionWithCloud({
            collectionName: 'monthlySettlements',
            cloudItems: cloudSettlements,
            cloudReady: true,
            localItems: currentStore.monthlySettlements || [],
            tombstones: nextTombstones,
            syncQueue: currentStore.syncQueue,
            preserveSandbox: true,
          })
        : filterOutTombstoned(
            currentStore.monthlySettlements || [],
            'monthlySettlements',
            nextTombstones
          );

      const baseGroups = currentStore.permissionGroups || getDefaultPermissionGroups();
      const nextGroups =
        cloudGroupsReady && cloudPermissionGroups.length > 0
          ? (['teacher', 'accountant', 'medical', 'admin'] as UserRole[]).map(
              (r) =>
                cloudPermissionGroups.find((g) => g.id === r) ||
                baseGroups.find((g) => g.id === r) ||
                resolveEffectiveGroup(r, [])
            )
          : baseGroups;

      const nextLogs = cloudLogsReady ? mergeById(currentStore.logs, cloudLogs) : currentStore.logs;

      const changed =
        serializeForDiff(nextTombstones) !== serializeForDiff(currentStore.tombstones || []) ||
        serializeForDiff(nextClasses) !== serializeForDiff(currentStore.classes) ||
        serializeForDiff(nextStudents) !== serializeForDiff(currentStore.students) ||
        serializeForDiff(nextRegs) !== serializeForDiff(currentStore.registrations) ||
        serializeForDiff(nextReports) !== serializeForDiff(currentStore.reports) ||
        serializeForDiff(nextAccounts) !== serializeForDiff(currentStore.accountAccess) ||
        serializeForDiff(nextArchives) !== serializeForDiff(currentStore.archivedYears) ||
        serializeForDiff(nextInvites) !== serializeForDiff(currentStore.classInvites || []) ||
        serializeForDiff(nextPricingRules) !==
          serializeForDiff(currentStore.mealPricingRules || []) ||
        (cloudPricingLogsReady &&
          serializeForDiff(nextPricingLogs) !==
            serializeForDiff(currentStore.mealPricingLogs || [])) ||
        (cloudBillingConfigsReady &&
          serializeForDiff(nextBillingConfigs) !==
            serializeForDiff(currentStore.mealBillingConfigs || [])) ||
        serializeForDiff(nextPayments) !== serializeForDiff(currentStore.mealPayments || []) ||
        (cloudPaymentLogsReady &&
          serializeForDiff(nextPaymentLogs) !==
            serializeForDiff(currentStore.mealPaymentLogs || [])) ||
        serializeForDiff(nextSettlements) !==
          serializeForDiff(currentStore.monthlySettlements || []) ||
        serializeForDiff(nextGroups) !== serializeForDiff(currentStore.permissionGroups || []) ||
        (cloudLogsReady && serializeForDiff(nextLogs) !== serializeForDiff(currentStore.logs));

      if (!changed) return;

      saveHybridStore((prev) =>
        applyTombstonesToStore(
          {
            ...prev,
            tombstones: nextTombstones,
            deletedStudentIds: Array.from(buildTombstoneSet(nextTombstones, 'students')),
            classes: nextClasses,
            students: nextStudents,
            registrations: nextRegs,
            reports: nextReports,
            accountAccess: nextAccounts,
            archivedYears: nextArchives,
            classInvites: nextInvites,
            mealPricingRules: nextPricingRules,
            mealPricingLogs: nextPricingLogs,
            mealBillingConfigs: nextBillingConfigs,
            mealPayments: nextPayments,
            mealPaymentLogs: nextPaymentLogs,
            monthlySettlements: nextSettlements,
            permissionGroups: nextGroups,
            logs: nextLogs,
          },
          nextTombstones
        )
      );
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    authReady,
    fbUser,
    userProfile?.status,
    linkSession,
    localStore.quotaExceeded,
    cloudTombstones,
    cloudTombstonesReady,
    cloudClasses,
    cloudClassesReady,
    cloudStudents,
    cloudStudentsReady,
    cloudRegistrations,
    cloudRegsReady,
    cloudReports,
    cloudReportsReady,
    cloudAccounts,
    cloudAccountsReady,
    cloudArchives,
    cloudArchivesReady,
    cloudPermissionGroups,
    cloudGroupsReady,
    cloudClassInvites,
    cloudInvitesReady,
    cloudPricingRules,
    cloudPricingRulesReady,
    cloudPricingLogs,
    cloudPricingLogsReady,
    cloudBillingConfigs,
    cloudBillingConfigsReady,
    cloudPayments,
    cloudPaymentsReady,
    cloudPaymentLogs,
    cloudPaymentLogsReady,
    cloudSettlements,
    cloudSettlementsReady,
    cloudLogs,
    cloudLogsReady,
  ]);

  // Unified Data Views (Tombstone-filtered & Cloud-authoritative)
  const classes = useMemo(() => {
    if (cloudClassesReady && cloudClasses.length > 0 && !localStore.quotaExceeded) {
      return reconcileCollectionWithCloud({
        collectionName: 'classes',
        cloudItems: cloudClasses,
        cloudReady: true,
        localItems: localStore.classes,
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      });
    }
    return filterOutTombstoned(localStore.classes, 'classes', activeTombstones);
  }, [localStore.classes, cloudClasses, cloudClassesReady, localStore.quotaExceeded, activeTombstones, localStore.syncQueue]);

  const students = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'students',
        cloudItems: cloudStudents,
        cloudReady: cloudStudentsReady && !localStore.quotaExceeded,
        localItems: localStore.students,
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [cloudStudents, cloudStudentsReady, localStore.quotaExceeded, localStore.students, activeTombstones, localStore.syncQueue]
  );

  const registrations = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'registrations',
        cloudItems: cloudRegistrations,
        cloudReady: cloudRegsReady && !localStore.quotaExceeded,
        localItems: localStore.registrations,
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [cloudRegistrations, cloudRegsReady, localStore.quotaExceeded, localStore.registrations, activeTombstones, localStore.syncQueue]
  );

  const reports = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'dailyReports',
        cloudItems: cloudReports,
        cloudReady: cloudReportsReady && !localStore.quotaExceeded,
        localItems: localStore.reports,
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [cloudReports, cloudReportsReady, localStore.quotaExceeded, localStore.reports, activeTombstones, localStore.syncQueue]
  );

  const logs = useMemo(() => {
    const merged = mergeById(cloudLogs, localStore.logs);
    return merged.sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
  }, [cloudLogs, localStore.logs]);

  const accounts = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'accountAccess',
        cloudItems: cloudAccounts,
        cloudReady: cloudAccountsReady && !localStore.quotaExceeded,
        localItems: localStore.accountAccess,
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
      }),
    [cloudAccounts, cloudAccountsReady, localStore.quotaExceeded, localStore.accountAccess, activeTombstones, localStore.syncQueue]
  );

  const archivedYears = useMemo(() => {
    const merged = reconcileCollectionWithCloud({
      collectionName: 'archivedYears',
      cloudItems: cloudArchives,
      cloudReady: cloudArchivesReady && !localStore.quotaExceeded,
      localItems: localStore.archivedYears,
      tombstones: activeTombstones,
      syncQueue: localStore.syncQueue,
      preserveSandbox: true,
    });
    return merged.sort((a, b) => b.archivedAtIso.localeCompare(a.archivedAtIso));
  }, [cloudArchives, cloudArchivesReady, localStore.quotaExceeded, localStore.archivedYears, activeTombstones, localStore.syncQueue]);

  const classInvites = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'classInvites',
        cloudItems: cloudClassInvites,
        cloudReady: cloudInvitesReady && !localStore.quotaExceeded,
        localItems: localStore.classInvites || [],
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
      }),
    [
      cloudClassInvites,
      cloudInvitesReady,
      localStore.quotaExceeded,
      localStore.classInvites,
      activeTombstones,
      localStore.syncQueue,
    ]
  );

  const settings = useMemo(
    () => cloudSettings || localStore.settings,
    [cloudSettings, localStore.settings]
  );

  const pricingRules = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'mealPricingRules',
        cloudItems: cloudPricingRules,
        cloudReady: cloudPricingRulesReady && !localStore.quotaExceeded,
        localItems: localStore.mealPricingRules || [],
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [
      cloudPricingRules,
      cloudPricingRulesReady,
      localStore.quotaExceeded,
      localStore.mealPricingRules,
      activeTombstones,
      localStore.syncQueue,
    ]
  );

  const pricingLogs = useMemo(() => {
    const merged = mergeById(cloudPricingLogs, localStore.mealPricingLogs || []);
    return merged.sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
  }, [cloudPricingLogs, localStore.mealPricingLogs]);

  const billingConfig = useMemo(() => {
    const merged = mergeById(
      localStore.mealBillingConfigs || [],
      cloudBillingConfigs
    );
    return merged.find((c) => c.env === 'production') || null;
  }, [cloudBillingConfigs, localStore.mealBillingConfigs]);

  const payments = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'mealPayments',
        cloudItems: cloudPayments,
        cloudReady: cloudPaymentsReady && !localStore.quotaExceeded,
        localItems: localStore.mealPayments || [],
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [
      cloudPayments,
      cloudPaymentsReady,
      localStore.quotaExceeded,
      localStore.mealPayments,
      activeTombstones,
      localStore.syncQueue,
    ]
  );

  const paymentLogs = useMemo(() => {
    const merged = mergeById(cloudPaymentLogs, localStore.mealPaymentLogs || []);
    return merged.sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
  }, [cloudPaymentLogs, localStore.mealPaymentLogs]);

  const settlements = useMemo(
    () =>
      reconcileCollectionWithCloud({
        collectionName: 'monthlySettlements',
        cloudItems: cloudSettlements,
        cloudReady: cloudSettlementsReady && !localStore.quotaExceeded,
        localItems: localStore.monthlySettlements || [],
        tombstones: activeTombstones,
        syncQueue: localStore.syncQueue,
        preserveSandbox: true,
      }),
    [
      cloudSettlements,
      cloudSettlementsReady,
      localStore.quotaExceeded,
      localStore.monthlySettlements,
      activeTombstones,
      localStore.syncQueue,
    ]
  );

  const cutoffTime = settings?.cutoffTime || DEFAULT_CUTOFF_TIME;

  const currentDayRegistrations = useMemo(
    () => registrations.filter((r) => r.env === 'production' && r.date === selectedDate),
    [registrations, selectedDate]
  );

  const currentDayReport = useMemo(
    () => reports.find((r) => r.env === 'production' && r.date === selectedDate) || null,
    [reports, selectedDate]
  );

  const isSelectedDateLocked = useMemo(() => {
    if (currentDayReport) return Boolean(currentDayReport.isLocked);
    if (!settings?.autoLockEnabled) return false;
    return isDateLockedByClock(selectedDate, cutoffTime);
  }, [currentDayReport, selectedDate, cutoffTime, settings?.autoLockEnabled, vnClock.timeStr]);

  // Auto-create persisted lock record at 08:00 (GMT+7) once cloud data is ready (Admin only)
  useEffect(() => {
    if (!authReady || !fbUser || userProfile?.status !== 'active' || !isTrueAdmin) return;
    if (!settings?.autoLockEnabled) return;
    if (!isDateLockedByClock(selectedDate, cutoffTime, new Date())) return;
    if (currentDayReport) return;

    const allDataReady =
      Boolean(localStore.quotaExceeded) ||
      (cloudReportsReady && cloudClassesReady && cloudStudentsReady && cloudRegsReady && cloudTombstonesReady);
    if (!allDataReady) return;

    const reportId = `production_${selectedDate}`;
    if (buildTombstoneSet(activeTombstones, 'dailyReports').has(reportId)) return;

    const attemptKey = `${selectedDate}_${cutoffTime}`;
    if (autoLockedDatesRef.current.has(attemptKey)) return;
    autoLockedDatesRef.current.add(attemptKey);

    void lockDailyReportTransaction({
      date: selectedDate,
      classes,
      students,
      registrations: currentDayRegistrations,
      actorUid: fbUser.uid,
      actorName: `Hệ thống tự động khóa sổ (${cutoffTime})`,
      lockType: 'auto_0800',
      env: 'production',
    }).catch(() => {
      // ignore transient auto-lock error; UI still enforces clock cutoff via isSelectedDateLocked
    });
  }, [
    authReady,
    fbUser,
    userProfile?.status,
    isTrueAdmin,
    settings?.autoLockEnabled,
    selectedDate,
    cutoffTime,
    vnClock.timeStr,
    currentDayReport,
    localStore.quotaExceeded,
    cloudReportsReady,
    cloudClassesReady,
    cloudStudentsReady,
    cloudRegsReady,
    cloudTombstonesReady,
    activeTombstones,
    classes,
    students,
    currentDayRegistrations,
  ]);

  // Ensure activeTab always matches authorized modules for current group
  useEffect(() => {
    if (!isModuleAllowedForGroup(activeTab, effectiveRole, effectiveGroup, isLinkUser)) {
      const nextTab = getDefaultTabForGroup(effectiveRole, effectiveGroup, isLinkUser);
      if (nextTab !== activeTab) {
        setActiveTab(nextTab);
      }
    }
  }, [activeTab, effectiveRole, effectiveGroup, isLinkUser]);

  const handleGoogleLogin = async (inviteOverride?: string) => {
    setAuthError(null);
    const extracted = extractInviteCodeFromText(
      inviteOverride !== undefined ? inviteOverride : landingInviteInput
    );
    if (extracted) {
      setPendingInviteCode(extracted);
      try {
        sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, extracted);
      } catch {
        // ignore storage errors
      }
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEnterByLink = async (rawCodeOrUrl: string) => {
    setInviteRedeemNotice(null);
    setAuthError(null);
    setInviteRedeemBusy(true);
    try {
      if (fbUser || auth.currentUser) {
        await signOut(auth);
      }
      const invite = await resolveInviteLinkSession(rawCodeOrUrl);
      const vnNow = getVietnamDateParts(new Date());
      const nextSession: LinkSession = {
        code: invite.code,
        invite,
        enteredAtIso: vnNow.fullDisplay,
      };
      startupLinkResolvedRef.current = invite.code;
      saveLinkSession(nextSession);
      setLinkSession(nextSession);
      clearPendingInviteStorage();
      setPendingInviteCode('');
      setLandingInviteInput('');
      setPendingScreenInviteInput('');

      const targetRole = getInviteTargetRole(invite);
      if (targetRole === 'teacher' && invite.classId) {
        setSelectedClassId(invite.classId);
      }
      setActiveTab(
        getDefaultTabForGroup(targetRole, resolveEffectiveGroup(targetRole, permissionGroups), true)
      );
      setInviteRedeemNotice({
        type: 'success',
        text: `Đã vào hệ thống với quyền ${getRoleLabel(targetRole)} (${getInviteDisplayLabel(invite)}).`,
      });
      void performFullBidirectionalSync().catch(() => {});
    } catch (err) {
      setInviteRedeemNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInviteRedeemBusy(false);
    }
  };

  const handleLandingQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setInviteRedeemNotice(null);
    setInviteRedeemBusy(true);
    try {
      const decoded = await decodeQrCodeFromFile(file);
      const code = extractInviteCodeFromText(decoded);
      if (!code) {
        throw new Error('Ảnh QR không chứa link hoặc mã truy cập hợp lệ.');
      }
      setLandingInviteInput(code);
      setPendingScreenInviteInput(code);
      await handleEnterByLink(code);
    } catch (err) {
      setInviteRedeemNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      setInviteRedeemBusy(false);
    }
  };

  const handleExitWorkspace = async () => {
    saveLinkSession(null);
    setLinkSession(null);
    startupLinkResolvedRef.current = null;
    clearPendingInviteStorage();
    setPendingInviteCode('');
    setLandingInviteInput('');
    setPendingScreenInviteInput('');
    setInviteRedeemNotice(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
  };

  const handleExportExcel = (monthFilter?: string) => {
    exportDailyReportToExcel({
      date: selectedDate,
      month: monthFilter || selectedDate.slice(0, 7),
      report: currentDayReport,
      classes,
      students,
      registrations: currentDayRegistrations,
      allRegistrations: registrations,
      logs,
      env: 'production',
    });
  };

  const handleReconnectCloud = async () => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const res = await performFullBidirectionalSync();
      setSyncNotice(
        `Đã đồng bộ hai chiều (${res.activeStudentsCount} HS · ${res.activeTombstonesCount} dấu xóa).`
      );
    } catch (err) {
      if (isTrueQuotaError(err)) {
        markQuotaExceeded(true);
      }
      setSyncNotice('Không thể kết nối Cloud, tiếp tục dùng dữ liệu cục bộ.');
    } finally {
      setSyncBusy(false);
    }
  };

  if (!authReady || linkResolving) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-slate-900 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-600">
            {linkResolving
              ? 'Đang mở liên kết truy cập & tải phân quyền từ Quản trị viên...'
              : 'Đang kết nối hệ thống Quản lý Suất ăn Bán trú – THCS Đông Thạnh...'}
          </p>
        </div>
      </div>
    );
  }

  // Unauthenticated Landing Screen (Admin Google Login + Passwordless Member Link/QR Entry)
  if (!fbUser && !linkSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
        <OfflineIndicator />
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white">
          <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            THCS ĐÔNG THẠNH · BÁN TRÚ
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => handleGoogleLogin()}
              className="min-h-[40px] flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Đăng nhập Quản trị</span>
            </button>
          </div>
        </header>

        <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Primary Block: Member Access via Shared Link / Code / QR (No Google Login Required) */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2">
              <div className="text-xs font-bold text-sky-700">
                HỆ THỐNG QUẢN LÝ SUẤT ĂN BÁN TRÚ NỘI BỘ · 61 LỚP
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Trường Trung học Cơ sở Đông Thạnh
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                <strong>Chỉ Quản trị viên cần đăng nhập Google.</strong> Giáo viên chủ nhiệm, Kế toán và Nhân viên Y tế mở trực tiếp bằng đường dẫn hoặc mã QR được Quản trị viên chia sẻ để làm việc đúng quyền được cấp.
              </p>
            </div>

            {inviteRedeemNotice && (
              <div
                className={`rounded-2xl border p-3.5 text-xs font-bold space-y-2.5 ${
                  inviteRedeemNotice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-rose-200 bg-rose-50 text-rose-900'
                }`}
              >
                <div className="flex items-start gap-2">
                  {inviteRedeemNotice.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{inviteRedeemNotice.text}</span>
                </div>
                {inviteRedeemNotice.type === 'error' && pendingInviteCode && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={inviteRedeemBusy}
                      onClick={() => handleEnterByLink(pendingInviteCode)}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-rose-700 px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-rose-800 disabled:opacity-50 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>
                        {inviteRedeemBusy
                          ? 'Đang thử kết nối lại...'
                          : `Thử mở lại liên kết (${pendingInviteCode})`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearPendingInviteStorage();
                        setPendingInviteCode('');
                        setLandingInviteInput('');
                        setPendingScreenInviteInput('');
                        setInviteRedeemNotice(null);
                      }}
                      className="min-h-[38px] inline-flex items-center rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100 cursor-pointer"
                    >
                      Đổi mã khác
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border-2 border-sky-200 bg-white p-5 space-y-4 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Vào hệ thống bằng Link hoặc Mã được cấp
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Dành cho GVCN (61 lớp), Kế toán &amp; Nhân viên Y tế — <strong>Không cần đăng nhập Google</strong>.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <input
                  type="text"
                  value={landingInviteInput}
                  onChange={(e) => setLandingInviteInput(e.target.value)}
                  placeholder="Nhập mã (vd: DT601ABCD, DTKT...) hoặc dán đường dẫn..."
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 focus:border-sky-500 focus:bg-white outline-hidden"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={inviteRedeemBusy || !landingInviteInput.trim()}
                    onClick={() => handleEnterByLink(landingInviteInput)}
                    className="min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-sky-700 disabled:opacity-40 cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{inviteRedeemBusy ? 'Đang mở phiên...' : 'Vào hệ thống ngay'}</span>
                  </button>
                  <label className="min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer">
                    <QrCode className="w-4 h-4 text-sky-600" />
                    <span>Đọc ảnh mã QR</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLandingQrUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                  Mẹo trên điện thoại: Nếu mở link từ Zalo/Tin nhắn bị trắng màn hình hoặc chậm, hãy bấm dấu <strong>⋮</strong> (góc trên bên phải) → chọn <strong>Mở bằng trình duyệt (Chrome / Safari)</strong>.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-xs text-slate-500 block">Khối 6</span>
                <span className="text-lg font-extrabold font-mono text-slate-900">14 lớp</span>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-xs text-slate-500 block">Khối 7</span>
                <span className="text-lg font-extrabold font-mono text-slate-900">13 lớp</span>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-xs text-slate-500 block">Khối 8</span>
                <span className="text-lg font-extrabold font-mono text-slate-900">15 lớp</span>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-xs text-slate-500 block">Khối 9</span>
                <span className="text-lg font-extrabold font-mono text-slate-900">19 lớp</span>
              </div>
            </div>
          </div>

          {/* Secondary Block: Admin Google Login & Role Guide */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="space-y-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Khu vực Ban Giám hiệu
                </span>
                <h2 className="text-base font-extrabold text-slate-900">
                  Đăng nhập Quản trị viên
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Chỉ Quản trị viên cần đăng nhập bằng Tài khoản Google để quản lý danh sách học sinh toàn trường, thiết lập phân quyền từng nhóm và tạo link / mã QR gửi các thành viên.
                </p>
              </div>

              {authError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  {authError}
                </div>
              )}

              <button
                type="button"
                onClick={() => handleGoogleLogin()}
                className="w-full min-h-[48px] flex items-center justify-center gap-2.5 rounded-xl bg-slate-900 px-5 py-3 text-xs font-extrabold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4 text-sky-400" />
                <span>Đăng nhập Quản trị viên (Google)</span>
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700 pb-2 border-b border-slate-100">
                Cơ chế truy cập theo quyền
              </h3>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li>
                  <strong className="text-slate-900">GVCN (Theo link lớp):</strong> Mở đúng lớp được giao, quét QR hoặc tick CÓ ĂN / KHÔNG ĂN trước giờ khóa sổ 08:00.
                </li>
                <li>
                  <strong className="text-slate-900">Kế toán &amp; Y tế (Theo link trường):</strong> Theo dõi số liệu, tra cứu chi tiết, xuất Excel &amp; in A4 theo đúng quyền Admin cấp.
                </li>
                <li>
                  <strong className="text-slate-900">Quản trị viên (Google Auth):</strong> Toàn quyền cấu hình phân quyền 4 nhóm, khóa/thu hồi link bất cứ lúc nào.
                </li>
              </ul>
            </div>
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-200 bg-white text-center text-xs text-slate-500">
          Trường THCS Đông Thạnh · Đồng hồ Việt Nam:{' '}
          <span className="font-mono font-semibold text-slate-700">{vnClock.fullDisplay}</span>
        </footer>
      </div>
    );
  }

  // Google-signed-in Non-Admin / Blocked / Pending Account Screen
  if (fbUser && !isTrueAdmin && userProfile && userProfile.status !== 'active') {
    const isPending = userProfile.status === 'pending';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-4 shadow-xs">
          {isPending ? (
            <KeyRound className="w-12 h-12 text-sky-600 mx-auto" />
          ) : (
            <ShieldAlert className="w-12 h-12 text-rose-600 mx-auto" />
          )}
          <div className="space-y-1">
            <span
              className={`inline-block rounded-lg border px-3 py-1 text-xs font-extrabold ${
                isPending
                  ? 'bg-sky-50 border-sky-200 text-sky-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {getAccountStatusLabel(userProfile.status)}
            </span>
            <h1 className="text-xl font-extrabold text-slate-900 pt-2">
              {isPending
                ? 'Chỉ Quản trị viên cần đăng nhập Google'
                : 'Tài khoản Google này không có quyền Quản trị'}
            </h1>
            <p className="text-xs font-mono text-slate-500">{userProfile.email}</p>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            {isPending
              ? 'Thành viên (GVCN, Kế toán, Nhân viên Y tế) không cần đăng nhập Google. Hãy dán link hoặc nhập mã được Quản trị viên cấp bên dưới để vào làm việc trực tiếp.'
              : 'Tài khoản Google này hiện đang bị tạm khóa hoặc chưa được cấp quyền Quản trị. Bạn có thể đăng xuất hoặc dùng link/mã thành viên được cấp.'}
          </p>

          {inviteRedeemNotice && (
            <div
              className={`rounded-xl border p-3 text-left text-xs font-bold flex items-start gap-2 ${
                inviteRedeemNotice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              {inviteRedeemNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{inviteRedeemNotice.text}</span>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left space-y-3">
            <label className="block text-xs font-extrabold text-slate-800">
              Vào trực tiếp bằng Link / Mã thành viên
            </label>
            <input
              type="text"
              value={pendingScreenInviteInput}
              onChange={(e) => setPendingScreenInviteInput(e.target.value)}
              placeholder="VD: DT601ABCD, DTKT... hoặc dán link ?invite=..."
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono font-bold text-slate-900"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={inviteRedeemBusy || !pendingScreenInviteInput.trim()}
                onClick={() => handleEnterByLink(pendingScreenInviteInput)}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-sky-700 disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4" />
                <span>{inviteRedeemBusy ? 'Đang mở...' : 'Vào bằng Link/Mã'}</span>
              </button>
              <label className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap">
                <QrCode className="w-4 h-4 text-sky-600" />
                <span>Đọc ảnh mã QR</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLandingQrUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={() => signOut(auth)}
            className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất tài khoản Google</span>
          </button>
        </div>
      </div>
    );
  }

  const activeActorUid = fbUser
    ? fbUser.uid
    : linkSession
    ? `invite_${linkSession.code}`
    : 'system';
  const activeActorName = fbUser
    ? userProfile?.displayName || fbUser.email || 'Quản trị viên'
    : linkSession
    ? `${getInviteDisplayLabel(linkSession.invite)} (${linkSession.code})`
    : 'Thành viên';
  const activeAssignedClassId =
    effectiveRole === 'teacher'
      ? fbUser
        ? userProfile?.assignedClassId
        : linkSession?.invite.classId
      : undefined;

  const authorizedTabs: { id: ActiveTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    ...(isModuleAllowedForGroup('teacher', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'teacher' as const,
            label: 'Điểm danh',
            shortLabel: 'Điểm danh',
            icon: <CheckSquare className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('monthly_billing', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'monthly_billing' as const,
            label: 'Báo ăn tháng – Tiền ăn',
            shortLabel: 'Ăn tháng',
            icon: <Receipt className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('reports', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'reports' as const,
            label: 'Báo cáo',
            shortLabel: 'Báo cáo',
            icon: <BarChart3 className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('students', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'students' as const,
            label: 'Học sinh',
            shortLabel: 'Học sinh',
            icon: <GraduationCap className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('users', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'users' as const,
            label: 'Người dùng',
            shortLabel: 'Tài khoản',
            icon: <UserCog className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('admin', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'admin' as const,
            label: 'Cài đặt',
            shortLabel: 'Cài đặt',
            icon: <Settings className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    ...(isModuleAllowedForGroup('verify', effectiveRole, effectiveGroup, isLinkUser)
      ? [
          {
            id: 'verify' as const,
            label: 'Kiểm thử',
            shortLabel: 'Kiểm thử',
            icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <OfflineIndicator />

      {/* Clean 3-Zone Sticky Top Bar (overflow-safe across mobile, tablet & desktop) */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white px-3 sm:px-6">
        <div className="max-w-7xl mx-auto min-h-13 sm:min-h-14 flex items-center justify-between gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() =>
              setActiveTab(getDefaultTabForGroup(effectiveRole, effectiveGroup, isLinkUser))
            }
            className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            THCS Đông Thạnh
          </button>

          {/* Desktop Navigation Tabs (>= md) */}
          <nav className="hidden md:flex items-center flex-wrap justify-center gap-1 min-w-0 py-1.5">
            {authorizedTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Primary Top Bar Utility */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExitWorkspace}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>{fbUser ? 'Đăng xuất' : 'Thoát phiên'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Secondary Context & Workspace Toolbar */}
      <div className="no-print border-b border-slate-200 bg-slate-100/80 px-3 sm:px-6 py-1.5 sm:py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <Clock className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <span className="sm:hidden font-mono tabular-nums font-semibold text-slate-700 shrink-0">
              {vnClock.timeStr}
            </span>
            <span className="hidden sm:inline font-mono tabular-nums font-medium text-slate-700 shrink-0">
              {vnClock.fullDisplay}
            </span>
            <span aria-hidden="true" className="text-slate-400 shrink-0">·</span>
            <span className="font-semibold text-slate-900 truncate max-w-[140px] sm:max-w-[240px]">
              {activeActorName}
            </span>
            <span className="rounded-md bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[11px] font-bold text-sky-800 whitespace-nowrap shrink-0">
              {getRoleLabel(effectiveRole)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
            {syncNotice && (
              <span className="text-[11px] font-semibold text-emerald-700">{syncNotice}</span>
            )}
            {isTrueAdmin && (
              <select
                value={effectiveRole}
                onChange={(e) => setPreviewRoleOverride(e.target.value as UserRole)}
                title="Xem thử giao diện của từng vai trò (Chỉ Admin)"
                className="min-h-[32px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 cursor-pointer"
              >
                <option value="admin">Vai trò: Admin</option>
                <option value="teacher">Xem như: GVCN</option>
                <option value="accountant">Xem như: Kế toán</option>
                <option value="medical">Xem như: Y tế</option>
              </select>
            )}
            <PWAInstallButton />
            <button
              type="button"
              disabled={syncBusy}
              onClick={handleReconnectCloud}
              className="min-h-[32px] inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <span>{syncBusy ? 'Đang đồng bộ...' : 'Đồng bộ'}</span>
            </button>
            {isTrueAdmin && (
              <button
                type="button"
                onClick={() => setShowStorageModal(true)}
                className="hidden sm:inline-flex min-h-[32px] items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline whitespace-nowrap cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 shrink-0" />
                <span>Cloud ({activeFirebaseConfig.projectId})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quota Warning Banner */}
      {localStore.quotaExceeded && (
        <div className="no-print bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 text-xs text-amber-950">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Đang sử dụng bộ nhớ đồng bộ thiết bị (ngoại tuyến / đạt hạn mức ghi Cloud trong ngày).
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isTrueAdmin && (
                <button
                  type="button"
                  onClick={() => setShowStorageModal(true)}
                  className="rounded-lg bg-sky-600 px-2.5 py-1 font-bold text-white hover:bg-sky-700 cursor-pointer"
                >
                  Cấu hình Cloud
                </button>
              )}
              <button
                type="button"
                onClick={handleReconnectCloud}
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 cursor-pointer"
              >
                Đồng bộ lại Cloud
              </button>
              <a
                href={`https://console.firebase.google.com/project/${activeFirebaseConfig.projectId}/firestore`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-sky-700 hover:underline"
              >
                <span>Console</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={`flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-5 ${
          authorizedTabs.length > 1
            ? 'pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-8'
            : 'pb-8'
        }`}
      >
        {inviteRedeemNotice && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-xs font-bold flex items-center justify-between gap-2 ${
              inviteRedeemNotice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            <span>{inviteRedeemNotice.text}</span>
            <button
              type="button"
              onClick={() => setInviteRedeemNotice(null)}
              className="underline cursor-pointer shrink-0"
            >
              Đóng
            </button>
          </div>
        )}

        {activeTab === 'teacher' &&
          isModuleAllowedForGroup('teacher', effectiveRole, effectiveGroup, isLinkUser) && (
            <RegistrationWorkspaceView
              date={selectedDate}
              onDateChange={setSelectedDate}
              classes={classes}
              students={students}
              registrations={currentDayRegistrations}
              logs={logs}
              report={currentDayReport}
              isLocked={isSelectedDateLocked}
              cutoffTime={cutoffTime}
              currentUserRole={effectiveRole}
              currentUserName={activeActorName}
              currentUserUid={activeActorUid}
              assignedClassId={activeAssignedClassId}
              selectedClassId={selectedClassId}
              onSelectClassId={setSelectedClassId}
              classInvites={classInvites}
              canShareClassCode={
                Boolean(fbUser) && (effectiveGroup.canShareClassCode || effectiveRole === 'admin')
              }
              canMarkAttendance={effectiveGroup.canMarkAttendance || effectiveRole === 'admin'}
              pendingSyncCount={pendingAttendanceSyncCount}
              onSyncPendingNow={syncPendingRegistrationsToCloud}
              onRegisterSingle={async (student, status, reason) => {
                const actorDisplayName =
                  effectiveRole === 'teacher'
                    ? classes.find((c) => c.id === student.classId)?.teacherName ||
                      activeActorName ||
                      'GVCN'
                    : activeActorName || 'Thành viên';

                return registerStudentMeal({
                  student,
                  date: selectedDate,
                  newStatus: status,
                  actorUid: activeActorUid,
                  actorName: actorDisplayName,
                  actorRole: effectiveRole,
                  assignedClassId: activeAssignedClassId,
                  canMarkAttendanceOverride:
                    effectiveGroup.canMarkAttendance || effectiveRole === 'admin',
                  cutoffTime,
                  adjustmentReason: reason,
                  env: 'production',
                });
              }}
              onRegisterBatchClass={async (classStudents, status, reason) => {
                const regMap = new Map<string, MealRegistration>();
                for (const r of currentDayRegistrations) regMap.set(r.studentId, r);
                const clsObj = classes.find((c) => c.id === selectedClassId);
                return batchRegisterClassMeals({
                  students: classStudents,
                  date: selectedDate,
                  newStatus: status,
                  actorUid: activeActorUid,
                  actorName: clsObj?.teacherName || activeActorName || 'GVCN',
                  actorRole: effectiveRole,
                  assignedClassId: activeAssignedClassId,
                  canMarkAttendanceOverride:
                    effectiveGroup.canMarkAttendance || effectiveRole === 'admin',
                  existingRegistrationsMap: regMap,
                  cutoffTime,
                  adjustmentReason: reason,
                  env: 'production',
                });
              }}
            />
          )}

        {activeTab === 'monthly_billing' &&
          isModuleAllowedForGroup('monthly_billing', effectiveRole, effectiveGroup, isLinkUser) && (
            <MonthlyMealBillingView
              selectedDate={selectedDate}
              classes={classes}
              students={students}
              registrations={registrations}
              reports={reports}
              pricingRules={pricingRules}
              pricingLogs={pricingLogs}
              billingConfig={billingConfig}
              payments={payments}
              paymentLogs={paymentLogs}
              settlements={settlements}
              academicYear={settings?.academicYear || '2026 - 2027'}
              currentUserRole={effectiveRole}
              currentUserUid={activeActorUid}
              currentUserName={activeActorName}
              assignedClassId={activeAssignedClassId}
              canMarkAttendance={effectiveGroup.canMarkAttendance || effectiveRole === 'admin'}
              canExportReports={effectiveGroup.canExportReports || effectiveRole === 'admin'}
              canManageMealPricing={
                Boolean(effectiveGroup.canManageMealPricing) || effectiveRole === 'admin'
              }
              canCollectPayments={
                Boolean(effectiveGroup.canCollectPayments) || effectiveRole === 'admin'
              }
              cutoffTime={cutoffTime}
            />
          )}

        {activeTab === 'reports' &&
          isModuleAllowedForGroup('reports', effectiveRole, effectiveGroup, isLinkUser) && (
            <AccountantMedicalReportView
              date={selectedDate}
              onDateChange={setSelectedDate}
              classes={classes}
              students={students}
              allRegistrations={registrations}
              reports={reports}
              logs={logs}
              currentUserRole={effectiveRole}
              canExportReports={effectiveGroup.canExportReports || effectiveRole === 'admin'}
              onExportExcel={handleExportExcel}
            />
          )}

        {activeTab === 'students' &&
          isModuleAllowedForGroup('students', effectiveRole, effectiveGroup, isLinkUser) && (
            <StudentManagementModule
              classes={classes}
              students={students}
              archivedYears={archivedYears}
              academicYear={settings?.academicYear || '2026 - 2027'}
              onSaveStudent={async (stu) => {
                await saveStudent({ ...stu, updatedByUid: activeActorUid }, 'production');
              }}
              env="production"
              currentUserName={activeActorName}
              currentUserUid={activeActorUid}
              isAdmin={Boolean(fbUser) && effectiveRole === 'admin'}
              canManageStudents={
                effectiveGroup.canManageStudents ||
                (Boolean(fbUser) && effectiveRole === 'admin')
              }
            />
          )}

        {activeTab === 'users' &&
          fbUser &&
          isModuleAllowedForGroup('users', effectiveRole, effectiveGroup, isLinkUser) && (
            <UserManagementView
              accounts={accounts}
              classes={classes}
              permissionGroups={permissionGroups}
              classInvites={classInvites}
              currentUserUid={activeActorUid}
              currentUserName={activeActorName}
              canManageUsers={
                effectiveRole === 'admin' || effectiveGroup.allowedModules.includes('users')
              }
              canShareClassCode={effectiveRole === 'admin' || effectiveGroup.canShareClassCode}
            />
          )}

        {activeTab === 'admin' &&
          fbUser &&
          isModuleAllowedForGroup('admin', effectiveRole, effectiveGroup, isLinkUser) && (
            <AdminManagementView
              date={selectedDate}
              onDateChange={setSelectedDate}
              classes={classes}
              currentDayReport={currentDayReport}
              settings={settings}
              onInitialize61Classes={async () => {
                await initializeStandard61Classes('production');
              }}
              onSaveClass={async (cls) => {
                await saveSchoolClass(cls, 'production');
              }}
              onSaveSettings={async (s) => {
                await saveSchoolSettings({
                  ...s,
                  actorUid: activeActorUid,
                });
              }}
              onLockCurrentDate={async () => {
                await lockDailyReportTransaction({
                  date: selectedDate,
                  classes,
                  students,
                  registrations: currentDayRegistrations,
                  actorUid: activeActorUid,
                  actorName: activeActorName,
                  lockType: 'manual_admin',
                  env: 'production',
                });
              }}
              onUnlockCurrentDate={async () => {
                await unlockDailyReport({
                  date: selectedDate,
                  actorUid: activeActorUid,
                  actorName: activeActorName,
                  env: 'production',
                });
              }}
              onBackupJson={() => {
                exportFullBackupJson({
                  classes: classes.filter((c) => c.env === 'production'),
                  students: students.filter((s) => s.env === 'production'),
                  registrations: registrations.filter((r) => r.env === 'production'),
                  reports: reports.filter((r) => r.env === 'production'),
                  logs: logs.filter((l) => l.env === 'production'),
                  accountAccess: accounts,
                  archivedYears: archivedYears.filter((a) => a.env === 'production'),
                });
              }}
            />
          )}

        {activeTab === 'verify' &&
          isModuleAllowedForGroup('verify', effectiveRole, effectiveGroup, isLinkUser) && (
            <VerificationCenterView />
          )}
      </main>

      {/* Android-first Bottom Navigation Bar (< md) showing all authorized tabs */}
      {authorizedTabs.length > 1 && (
        <nav className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-around overflow-x-auto no-scrollbar shadow-lg">
          {authorizedTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`min-h-[48px] flex-1 min-w-[54px] flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold cursor-pointer ${
                activeTab === t.id ? 'text-sky-700 bg-sky-50' : 'text-slate-500'
              }`}
            >
              {t.icon}
              <span className="truncate max-w-full whitespace-nowrap">{t.shortLabel}</span>
            </button>
          ))}
        </nav>
      )}

      {/* Desktop Footer */}
      <footer className="no-print hidden md:block mt-auto border-t border-slate-200 bg-white px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            Trường THCS Đông Thạnh · Quản lý Suất ăn Bán trú (61 Lớp)
          </span>
          {(effectiveGroup.canExportReports || effectiveRole === 'admin') && (
            <button
              type="button"
              onClick={() => handleExportExcel()}
              className="flex items-center gap-1 text-emerald-700 hover:underline font-bold cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Xuất Excel ngày {formatVietnameseDate(selectedDate)}</span>
            </button>
          )}
        </div>
      </footer>

      {fbUser && isTrueAdmin && (
        <StorageAccountModal
          isOpen={showStorageModal}
          onClose={() => setShowStorageModal(false)}
          userEmail={fbUser.email || 'Chưa cập nhật email'}
          userUid={fbUser.uid}
          userDisplayName={userProfile?.displayName || fbUser.displayName || 'Quản trị viên'}
          userRole={effectiveRole}
          quotaExceeded={Boolean(localStore.quotaExceeded)}
          counts={{
            classes: classes.filter((c) => c.env === 'production').length,
            students: students.filter((s) => s.env === 'production').length,
            registrations: registrations.filter((r) => r.env === 'production').length,
            reports: reports.filter((r) => r.env === 'production').length,
            logs: logs.filter((l) => l.env === 'production').length,
          }}
          onSwitchGoogleAccount={async () => {
            await signOut(auth);
            await signInWithPopup(auth, googleProvider);
          }}
          onExportBackupJson={() => {
            exportFullBackupJson({
              classes: classes.filter((c) => c.env === 'production'),
              students: students.filter((s) => s.env === 'production'),
              registrations: registrations.filter((r) => r.env === 'production'),
              reports: reports.filter((r) => r.env === 'production'),
              logs: logs.filter((l) => l.env === 'production'),
              accountAccess: accounts,
              archivedYears: archivedYears.filter((a) => a.env === 'production'),
            });
          }}
        />
      )}
    </div>
  );
}
