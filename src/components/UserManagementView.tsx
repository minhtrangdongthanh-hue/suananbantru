import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  KeyRound,
  Link2,
  Lock,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import {
  AccountAccess,
  AccountStatus,
  AppModuleId,
  BOOTSTRAPPED_ADMIN_EMAIL,
  ClassInvite,
  copyTextSafe,
  getAccountStatusLabel,
  getDefaultPermissionGroups,
  getInviteTargetRole,
  getRoleLabel,
  GradeLevel,
  PermissionGroup,
  resolveEffectiveGroup,
  SchoolClass,
  SYSTEM_MODULES_META,
  UserRole,
} from '../types';
import {
  createOrRotateAccessInvite,
  createOrRotateClassInvite,
  deleteAccountAccess,
  deleteClassInvite,
  generateMissing61ClassInvites,
  performFullBidirectionalSync,
  resetDefaultPermissionGroups,
  saveAccountAccess,
  saveAllPermissionGroups,
  syncPendingClassInvitesToCloud,
  toggleClassInviteActive,
} from '../services/mealService';
import {
  getHybridStore,
  LOCAL_STORE_EVENT,
  serializeForDiff,
} from '../services/localStoreFallback';
import {
  buildClassInviteUrl,
  ClassInviteShareModal,
  RoleInviteTarget,
} from './ClassInviteShareModal';

interface UserManagementViewProps {
  accounts: AccountAccess[];
  classes: SchoolClass[];
  permissionGroups?: PermissionGroup[];
  classInvites?: ClassInvite[];
  currentUserUid: string;
  currentUserName?: string;
  canManageUsers?: boolean;
  canShareClassCode?: boolean;
}

const ROLE_ORDER: UserRole[] = ['teacher', 'accountant', 'medical', 'admin'];
const DEFAULT_PERMISSION_GROUPS = getDefaultPermissionGroups();
const EMPTY_CLASS_INVITES: ClassInvite[] = [];

const CAPABILITY_META: {
  key:
    | 'canMarkAttendance'
    | 'canExportReports'
    | 'canManageStudents'
    | 'canShareClassCode'
    | 'canManageMealPricing'
    | 'canCollectPayments';
  label: string;
  hint: string;
}[] = [
  {
    key: 'canMarkAttendance',
    label: 'Điểm danh CÓ ĂN / KHÔNG ĂN',
    hint: 'Cho phép chấm suất ăn và quét QR điểm danh (GVCN chỉ chấm đúng lớp được phân công).',
  },
  {
    key: 'canExportReports',
    label: 'Xuất Excel / PDF & In báo cáo',
    hint: 'Hiển thị nút tải Excel, xuất PDF và mẫu in A4/A3 chính thức.',
  },
  {
    key: 'canManageStudents',
    label: 'Thêm / sửa / xóa & Nhập Excel HS',
    hint: 'Cho phép cập nhật danh sách học sinh trong mục Học sinh.',
  },
  {
    key: 'canShareClassCode',
    label: 'Tạo & chia sẻ mã vào lớp cho GVCN',
    hint: 'Cho phép tạo, copy link, mở QR mời Giáo viên vào điểm danh lớp.',
  },
  {
    key: 'canManageMealPricing',
    label: 'Cài đặt giá suất ăn & Khóa sổ tháng',
    hint: 'Cho phép thiết lập/chỉnh sửa đơn giá VNĐ, ngày nghỉ lễ và khóa/mở sổ quyết toán tháng.',
  },
  {
    key: 'canCollectPayments',
    label: 'Thu tiền ăn học sinh & In phiếu thu',
    hint: 'Cho phép ghi nhận, chỉnh sửa/hủy phiếu thu tiền ăn và xuất danh sách chưa đóng đủ.',
  },
];

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  accounts,
  classes,
  permissionGroups = DEFAULT_PERMISSION_GROUPS,
  classInvites = EMPTY_CLASS_INVITES,
  currentUserUid,
  currentUserName = 'Quản trị viên',
  canManageUsers = true,
  canShareClassCode = true,
}) => {
  const [subTab, setSubTab] = useState<'accounts' | 'groups' | 'invites'>(
    canManageUsers ? 'accounts' : 'invites'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add / Edit Account Modal
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountAccess | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [roleInput, setRoleInput] = useState<UserRole>('teacher');
  const [statusInput, setStatusInput] = useState<AccountStatus>('active');
  const [classIdInput, setClassIdInput] = useState('production_class_6_1');
  const [pendingDeleteAccount, setPendingDeleteAccount] = useState<AccountAccess | null>(null);

  // Group Permissions Matrix State
  const resolvedIncomingGroups = useMemo(
    () => ROLE_ORDER.map((r) => resolveEffectiveGroup(r, permissionGroups)),
    [permissionGroups]
  );
  const [draftGroups, setDraftGroups] = useState<PermissionGroup[]>(resolvedIncomingGroups);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [confirmResetGroups, setConfirmResetGroups] = useState(false);

  useEffect(() => {
    if (!groupsDirty) {
      setDraftGroups((prev) =>
        serializeForDiff(prev) === serializeForDiff(resolvedIncomingGroups)
          ? prev
          : resolvedIncomingGroups
      );
    }
  }, [resolvedIncomingGroups, groupsDirty]);

  // Class & Staff Invites Sharing State
  const [inviteGradeFilter, setInviteGradeFilter] = useState<'all' | GradeLevel>('all');
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteShareTarget, setInviteShareTarget] = useState<SchoolClass | null>(null);
  const [roleShareTarget, setRoleShareTarget] = useState<RoleInviteTarget | null>(null);
  const [pendingDeleteInvite, setPendingDeleteInvite] = useState<ClassInvite | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [pendingInviteSyncCount, setPendingInviteSyncCount] = useState<number>(() => {
    const s = getHybridStore();
    return (s.syncQueue || []).filter((q) => q.collectionName === 'classInvites').length;
  });
  const [syncingInvites, setSyncingInvites] = useState(false);

  useEffect(() => {
    const refreshSyncCount = () => {
      const s = getHybridStore();
      setPendingInviteSyncCount(
        (s.syncQueue || []).filter((q) => q.collectionName === 'classInvites').length
      );
    };
    window.addEventListener(LOCAL_STORE_EVENT, refreshSyncCount);
    return () => window.removeEventListener(LOCAL_STORE_EVENT, refreshSyncCount);
  }, []);

  useEffect(() => {
    if (!canManageUsers && subTab !== 'invites') {
      setSubTab('invites');
    }
  }, [canManageUsers, subTab]);

  const activeClasses = useMemo(
    () =>
      classes
        .filter((c) => c.env === 'production' && c.active)
        .sort((a, b) => (a.grade !== b.grade ? a.grade - b.grade : a.order - b.order)),
    [classes]
  );

  const classMap = useMemo(() => {
    const m = new Map<string, SchoolClass>();
    for (const c of activeClasses) m.set(c.id, c);
    return m;
  }, [activeClasses]);

  const inviteByClassId = useMemo(() => {
    const m = new Map<string, ClassInvite>();
    for (const inv of classInvites) {
      if (getInviteTargetRole(inv) !== 'teacher') continue;
      const existing = m.get(inv.classId);
      if (!existing || (inv.active && !existing.active)) {
        m.set(inv.classId, inv);
      }
    }
    return m;
  }, [classInvites]);

  const inviteByStaffRole = useMemo(() => {
    const m = new Map<'accountant' | 'medical', ClassInvite>();
    for (const inv of classInvites) {
      const r = getInviteTargetRole(inv);
      if (r !== 'accountant' && r !== 'medical') continue;
      const existing = m.get(r);
      if (!existing || (inv.active && !existing.active)) {
        m.set(r, inv);
      }
    }
    return m;
  }, [classInvites]);

  const roleSummaryStats = useMemo(() => {
    return ROLE_ORDER.map((role) => {
      const roleAccounts = accounts.filter((a) => a.role === role);
      const activeCount = roleAccounts.filter((a) => a.status === 'active').length;
      const effGroup = resolveEffectiveGroup(role, permissionGroups);
      return {
        role,
        label: getRoleLabel(role),
        totalCount: roleAccounts.length,
        activeCount,
        moduleCount: effGroup.allowedModules.length,
      };
    });
  }, [accounts, permissionGroups]);

  const filteredAccounts = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return [...accounts]
      .sort((a, b) => a.email.localeCompare(b.email))
      .filter((acc) => {
        if (roleFilter !== 'all' && acc.role !== roleFilter) return false;
        if (statusFilter !== 'all' && acc.status !== statusFilter) return false;
        if (
          q &&
          !acc.email.toLowerCase().includes(q) &&
          !acc.displayName.toLowerCase().includes(q) &&
          !(acc.joinedInviteCode || '').toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      });
  }, [accounts, searchTerm, roleFilter, statusFilter]);

  const filteredInviteClasses = useMemo(() => {
    const q = inviteSearch.toLowerCase().trim();
    return activeClasses.filter((cls) => {
      if (inviteGradeFilter !== 'all' && cls.grade !== inviteGradeFilter) return false;
      if (!q) return true;
      const inv = inviteByClassId.get(cls.id);
      return (
        cls.name.toLowerCase().includes(q) ||
        cls.teacherName.toLowerCase().includes(q) ||
        (inv?.code || '').toLowerCase().includes(q)
      );
    });
  }, [activeClasses, inviteGradeFilter, inviteSearch, inviteByClassId]);

  const openCreateModal = () => {
    setEditingAccount(null);
    setEmailInput('');
    setNameInput('');
    setRoleInput('teacher');
    setStatusInput('active');
    setClassIdInput(activeClasses[0]?.id || 'production_class_6_1');
    setErrorMsg(null);
    setShowModal(true);
  };

  const openEditModal = (acc: AccountAccess) => {
    setEditingAccount(acc);
    setEmailInput(acc.email);
    setNameInput(acc.displayName);
    setRoleInput(acc.role);
    setStatusInput(acc.status);
    setClassIdInput(acc.assignedClassId || activeClasses[0]?.id || 'production_class_6_1');
    setErrorMsg(null);
    setShowModal(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId('form');
    try {
      const saved = await saveAccountAccess({
        email: emailInput,
        displayName: nameInput,
        role: roleInput,
        status: statusInput,
        assignedClassId: roleInput === 'teacher' ? classIdInput : '',
        joinedInviteCode: editingAccount?.joinedInviteCode || '',
        uid: editingAccount?.uid,
        lastLoginAtIso: editingAccount?.lastLoginAtIso,
        actorUid: currentUserUid,
        existingAccounts: accounts,
      });
      setShowModal(false);
      setSuccessMsg(
        `Đã lưu quyền truy cập cho ${saved.email} (${getRoleLabel(saved.role)} · ${getAccountStatusLabel(saved.status)}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickStatusChange = async (acc: AccountAccess, newStatus: AccountStatus) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(acc.id);
    try {
      await saveAccountAccess({
        email: acc.email,
        displayName: acc.displayName,
        role: acc.role,
        status: newStatus,
        assignedClassId: acc.assignedClassId,
        joinedInviteCode: acc.joinedInviteCode || '',
        uid: acc.uid,
        lastLoginAtIso: acc.lastLoginAtIso,
        actorUid: currentUserUid,
        existingAccounts: accounts,
      });
      setSuccessMsg(
        `Đã cập nhật trạng thái tài khoản ${acc.email} → ${getAccountStatusLabel(newStatus)}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!pendingDeleteAccount) return;
    const acc = pendingDeleteAccount;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(acc.id);
    try {
      await deleteAccountAccess({
        account: acc,
        existingAccounts: accounts,
        actorUid: currentUserUid,
      });
      setPendingDeleteAccount(null);
      setSuccessMsg(`Đã xóa vĩnh viễn tài khoản ${acc.email} khỏi danh sách phân quyền.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const toggleGroupModule = (role: UserRole, moduleId: AppModuleId) => {
    if (role === 'admin' && (moduleId === 'users' || moduleId === 'admin')) {
      return;
    }
    setGroupsDirty(true);
    setDraftGroups((prev) =>
      prev.map((g) => {
        if (g.id !== role) return g;
        const exists = g.allowedModules.includes(moduleId);
        const nextModules = exists
          ? g.allowedModules.filter((m) => m !== moduleId)
          : [...g.allowedModules, moduleId];
        return {
          ...g,
          allowedModules: nextModules,
        };
      })
    );
  };

  const toggleGroupCapability = (
    role: UserRole,
    key:
      | 'canMarkAttendance'
      | 'canExportReports'
      | 'canManageStudents'
      | 'canShareClassCode'
      | 'canManageMealPricing'
      | 'canCollectPayments'
  ) => {
    setGroupsDirty(true);
    setDraftGroups((prev) =>
      prev.map((g) => {
        if (g.id !== role) return g;
        return {
          ...g,
          [key]: !Boolean(g[key]),
        };
      })
    );
  };

  const handleSaveAllGroups = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId('save_groups');
    try {
      await saveAllPermissionGroups({
        groups: draftGroups,
        actorUid: currentUserUid,
      });
      setGroupsDirty(false);
      setSuccessMsg('Đã lưu cấu hình phân quyền cho 4 nhóm và đồng bộ toàn hệ thống.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmResetGroups = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId('reset_groups');
    try {
      const defaults = await resetDefaultPermissionGroups(currentUserUid);
      setDraftGroups(defaults);
      setGroupsDirty(false);
      setConfirmResetGroups(false);
      setSuccessMsg('Đã khôi phục phân quyền mặc định chuẩn cho 4 nhóm.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateMissing61 = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId('gen_61');
    try {
      const created = await generateMissing61ClassInvites({
        classes: activeClasses,
        existingInvites: classInvites,
        actorUid: currentUserUid,
        actorName: currentUserName,
      });
      if (created === 0) {
        setSuccessMsg(`Tất cả ${activeClasses.length} lớp hiện đã có mã chia sẻ.`);
      } else {
        setSuccessMsg(`Đã tạo thêm ${created} mã chia sẻ lớp mới cho các lớp còn thiếu.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateOrRotateForClass = async (
    cls: SchoolClass,
    existing?: ClassInvite | null
  ): Promise<ClassInvite> => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(`inv_${cls.id}`);
    try {
      const existingForClass = classInvites.filter(
        (i) => getInviteTargetRole(i) === 'teacher' && i.classId === cls.id
      );
      const created = await createOrRotateClassInvite({
        schoolClass: cls,
        actorUid: currentUserUid,
        actorName: currentUserName,
        existingInvitesForClass: existing ? existingForClass : [],
      });
      setSuccessMsg(
        existing
          ? `Đã đổi link mới cho Lớp ${cls.name}: ${created.code} (link cũ đã bị thu hồi vĩnh viễn).`
          : `Đã tạo link vào Lớp ${cls.name}: ${created.code}.`
      );
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateOrRotateForRole = async (
    role: 'accountant' | 'medical',
    existing?: ClassInvite | null
  ): Promise<ClassInvite> => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(`role_${role}`);
    try {
      const existingForRole = classInvites.filter((i) => getInviteTargetRole(i) === role);
      const created = await createOrRotateAccessInvite({
        role,
        memberLabel: getRoleLabel(role),
        actorUid: currentUserUid,
        actorName: currentUserName,
        existingInvites: existing ? existingForRole : [],
      });
      setSuccessMsg(
        existing
          ? `Đã đổi link mới cho ${getRoleLabel(role)}: ${created.code} (link cũ đã bị thu hồi vĩnh viễn).`
          : `Đã tạo link truy cập cho ${getRoleLabel(role)}: ${created.code}.`
      );
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleInviteStatus = async (invite: ClassInvite, nextActive: boolean) => {
    const r = getInviteTargetRole(invite);
    const key = r === 'teacher' ? `inv_${invite.classId}` : `role_${r}`;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(key);
    try {
      await toggleClassInviteActive({ invite, active: nextActive });
      const targetDesc = r === 'teacher' ? `Lớp ${invite.className}` : getRoleLabel(r);
      setSuccessMsg(
        `Đã ${nextActive ? 'mở lại' : 'tạm khóa'} link / mã ${invite.code} (${targetDesc}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDeleteInvite = async () => {
    if (!pendingDeleteInvite) return;
    const inv = pendingDeleteInvite;
    const r = getInviteTargetRole(inv);
    const key = r === 'teacher' ? `inv_${inv.classId}` : `role_${r}`;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyId(key);
    try {
      await deleteClassInvite({ invite: inv, actorUid: currentUserUid });
      setPendingDeleteInvite(null);
      const targetDesc = r === 'teacher' ? `Lớp ${inv.className}` : getRoleLabel(r);
      setSuccessMsg(`Đã xóa vĩnh viễn link / mã ${inv.code} (${targetDesc}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyText = async (text: string, token: string) => {
    const ok = await copyTextSafe(text);
    if (ok) {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } else {
      setErrorMsg('Không thể sao chép tự động, vui lòng mở QR & Chia sẻ để sao chép.');
    }
  };

  const handleSyncInvitesNow = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setSyncingInvites(true);
    try {
      const res = await syncPendingClassInvitesToCloud();
      setPendingInviteSyncCount(res.remainingCount);
      if (res.remainingCount === 0) {
        setSuccessMsg(
          res.syncedCount > 0
            ? `Đã đồng bộ ${res.syncedCount} Link & Mã truy cập lên máy chủ Cloud thành công.`
            : 'Tất cả Link & Mã truy cập đã được đồng bộ trên máy chủ Cloud.'
        );
      } else {
        setErrorMsg(
          `Vẫn còn ${res.remainingCount} mã chưa đồng bộ được, vui lòng kiểm tra lại kết nối mạng.`
        );
      }
      void performFullBidirectionalSync().catch(() => {});
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg.includes('permission-denied') || rawMsg.includes('Missing or insufficient permissions')) {
        setErrorMsg(
          'Máy chủ Firestore từ chối quyền ghi (permission-denied). Hãy đảm bảo bạn đang đăng nhập đúng email Quản trị viên và thử tải lại trang.'
        );
      } else if (rawMsg.includes('FIRESTORE_WRITE_TIMEOUT')) {
        setErrorMsg('Kết nối máy chủ Cloud quá chậm (timeout). Vui lòng kiểm tra WiFi / 4G và bấm Đồng bộ lại.');
      } else {
        setErrorMsg(rawMsg);
      }
    } finally {
      setSyncingInvites(false);
    }
  };

  const getStatusBadgeClass = (status: AccountStatus) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'suspended':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'locked':
      case 'revoked':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'pending':
        return 'bg-sky-50 text-sky-800 border-sky-200';
    }
  };

  const inviteStats = useMemo(() => {
    let generatedCount = 0;
    let openCount = 0;
    for (const cls of activeClasses) {
      const inv = inviteByClassId.get(cls.id);
      if (inv) {
        generatedCount++;
        if (inv.active) openCount++;
      }
    }
    return {
      totalClasses: activeClasses.length,
      generatedCount,
      openCount,
    };
  }, [activeClasses, inviteByClassId]);

  const staffLinkRoles: RoleInviteTarget[] = useMemo(
    () => [
      {
        role: 'accountant',
        title: 'Kế toán nhà trường',
        subtitle: 'Xem thống kê ngày/tháng, nhật ký chỉnh sửa, xuất Excel & in báo cáo A4 theo phân quyền nhóm.',
      },
      {
        role: 'medical',
        title: 'Nhân viên Y tế',
        subtitle: 'Tra cứu nhanh học sinh ăn/không ăn toàn trường và xuất danh sách kiểm tra theo phân quyền nhóm.',
      },
    ],
    []
  );

  const activeShareModalInvite = inviteShareTarget
    ? inviteByClassId.get(inviteShareTarget.id) || null
    : roleShareTarget
    ? inviteByStaffRole.get(roleShareTarget.role) || null
    : null;

  return (
    <div className="space-y-5">
      {/* Header & Sub-tab Navigation */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">
              QUẢN LÝ NGƯỜI DÙNG &amp; LINK TRUY CẬP ({accounts.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Chỉ Quản trị viên cần đăng nhập Google. Các thành viên (GVCN, Kế toán, Nhân viên Y tế) bấm vào Link / QR để xem và thao tác đúng quyền được cấp.
            </p>
          </div>

          {canManageUsers && subTab === 'accounts' && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-sky-400" />
              <span>Cấp tài khoản Google</span>
            </button>
          )}
        </div>

        {/* Sub-tab Switcher */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
          {canManageUsers && (
            <>
              <button
                type="button"
                onClick={() => setSubTab('accounts')}
                className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                  subTab === 'accounts' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Tài khoản Quản trị ({accounts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('groups')}
                className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                  subTab === 'groups' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Phân quyền Nhóm (Theo mục)</span>
                {groupsDirty && (
                  <span className="ml-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                    Chưa lưu
                  </span>
                )}
              </button>
            </>
          )}

          {(canShareClassCode || canManageUsers) && (
            <button
              type="button"
              onClick={() => setSubTab('invites')}
              className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                subTab === 'invites' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>
                Link &amp; Mã thành viên ({inviteStats.openCount}/{inviteStats.totalClasses} lớp)
              </span>
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:underline cursor-pointer shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-bold text-rose-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 hover:underline cursor-pointer shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {/* SUB-TAB 1: ACCOUNTS & STATUS */}
      {subTab === 'accounts' && canManageUsers && (
        <div className="space-y-4">
          {/* 4 Group Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
            {roleSummaryStats.map((stat) => (
              <div
                key={stat.role}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">{stat.label}</span>
                  <button
                    type="button"
                    onClick={() => setSubTab('groups')}
                    className="text-[11px] font-bold text-sky-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {stat.moduleCount} mục
                  </button>
                </div>
                <div className="text-2xl font-extrabold font-mono text-slate-900">
                  {stat.activeCount}
                  <span className="text-xs font-normal text-slate-500 ml-1">
                    / {stat.totalCount} TK hoạt động
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm theo email, họ tên hoặc mã lớp..."
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="all">Tất cả Vai trò</option>
              <option value="teacher">Giáo viên chủ nhiệm (GVCN)</option>
              <option value="accountant">Kế toán</option>
              <option value="medical">Nhân viên Y tế</option>
              <option value="admin">Quản trị viên</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AccountStatus)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="all">Tất cả Trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="pending">Chờ cấp quyền</option>
              <option value="suspended">Ngưng quyền tạm thời</option>
              <option value="locked">Đã khóa tài khoản</option>
              <option value="revoked">Đã thu hồi quyền</option>
            </select>
          </div>

          {/* Account List */}
          <div className="space-y-3">
            {filteredAccounts.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                Chưa có tài khoản nào phù hợp với bộ lọc.
              </div>
            ) : (
              filteredAccounts.map((acc) => {
                const assignedCls = acc.assignedClassId
                  ? classMap.get(acc.assignedClassId)
                  : undefined;
                const isBootAdmin = acc.email === BOOTSTRAPPED_ADMIN_EMAIL;
                const isBusy = busyId === acc.id;

                return (
                  <div
                    key={acc.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-extrabold text-slate-900">
                          {acc.displayName}
                        </h4>
                        <span className="rounded-lg bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-800">
                          {getRoleLabel(acc.role)}
                          {acc.role === 'teacher' && assignedCls
                            ? ` · Lớp ${assignedCls.name}`
                            : ''}
                        </span>
                        <span
                          className={`rounded-lg border px-2.5 py-0.5 text-[11px] font-bold ${getStatusBadgeClass(
                            acc.status
                          )}`}
                        >
                          {getAccountStatusLabel(acc.status)}
                        </span>
                        {acc.joinedInviteCode && (
                          <span className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-mono font-bold text-sky-800">
                            Vào bằng mã: {acc.joinedInviteCode}
                          </span>
                        )}
                        {isBootAdmin && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                            <Shield className="w-3 h-3" />
                            <span>Admin gốc</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-slate-600">{acc.email}</p>
                      <p className="text-[11px] text-slate-500">
                        Đăng nhập gần nhất:{' '}
                        <span className="font-mono text-slate-700">
                          {acc.lastLoginAtIso || 'Chưa đăng nhập'}
                        </span>
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditModal(acc)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-sky-600" />
                        <span>Đổi quyền / Lớp</span>
                      </button>

                      {!isBootAdmin && (
                        <>
                          {acc.status !== 'active' ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickStatusChange(acc, 'active')}
                              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Mở khóa / Kích hoạt</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleQuickStatusChange(acc, 'suspended')}
                                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 cursor-pointer"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                <span>Ngưng tạm thời</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleQuickStatusChange(acc, 'locked')}
                                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100 cursor-pointer"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>Khóa tài khoản</span>
                              </button>
                            </>
                          )}

                          {acc.status !== 'revoked' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickStatusChange(acc, 'revoked')}
                              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              <span>Thu hồi quyền</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setPendingDeleteAccount(acc)}
                            className="min-h-[40px] inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Xóa bản ghi phân quyền"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: GROUP PERMISSION MATRIX */}
      {subTab === 'groups' && canManageUsers && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Ma trận Phân quyền Nhóm theo Mục quản trị đã có
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bật/tắt mục hiển thị và quyền thao tác cho 4 nhóm nội bộ. Thay đổi có hiệu lực ngay trên giao diện và Firestore Security Rules.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === 'reset_groups' || busyId === 'save_groups'}
                  onClick={() => setConfirmResetGroups(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Khôi phục mặc định</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === 'save_groups' || busyId === 'reset_groups'}
                  onClick={handleSaveAllGroups}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5 text-sky-400" />
                  <span>{busyId === 'save_groups' ? 'Đang lưu...' : 'Lưu phân quyền nhóm'}</span>
                </button>
              </div>
            </div>

            {/* Mobile Permission Matrix Cards (< md) */}
            <div className="md:hidden space-y-4">
              <div className="rounded-xl bg-sky-50 px-3 py-2 text-[11px] font-extrabold text-sky-900">
                I. MỤC CHỨC NĂNG ĐƯỢC TRUY CẬP ({SYSTEM_MODULES_META.length} MỤC)
              </div>
              {SYSTEM_MODULES_META.map((mod) => (
                <div
                  key={`mob_${mod.id}`}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5"
                >
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">{mod.label}</div>
                    <div className="text-[11px] text-slate-500">{mod.description}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {draftGroups.map((g) => {
                      const checked =
                        (g.id === 'admin' && mod.lockedForAdmin) ||
                        g.allowedModules.includes(mod.id);
                      const locked = g.id === 'admin' && Boolean(mod.lockedForAdmin);
                      return (
                        <label
                          key={`mob_${mod.id}_${g.id}`}
                          className={`min-h-[42px] flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer ${
                            checked
                              ? 'border-sky-300 bg-sky-50 text-sky-900'
                              : 'border-slate-200 bg-white text-slate-600'
                          } ${locked ? 'opacity-70' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggleGroupModule(g.id, mod.id)}
                            className="w-4 h-4 rounded border-slate-300 text-sky-600 shrink-0"
                          />
                          <span className="truncate">{getRoleLabel(g.id)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-extrabold text-emerald-900">
                II. QUYỀN THAO TÁC NGHIỆP VỤ CHI TIẾT
              </div>
              {CAPABILITY_META.map((cap) => (
                <div
                  key={`mob_${cap.key}`}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5"
                >
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">{cap.label}</div>
                    <div className="text-[11px] text-slate-500">{cap.hint}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {draftGroups.map((g) => {
                      const checked = Boolean(g[cap.key]);
                      return (
                        <label
                          key={`mob_${cap.key}_${g.id}`}
                          className={`min-h-[42px] flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer ${
                            checked
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGroupCapability(g.id, cap.key)}
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 shrink-0"
                          />
                          <span className="truncate">{getRoleLabel(g.id)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Matrix Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <th className="p-3 text-left font-bold min-w-[260px]">
                      Mục quản trị / Quyền nghiệp vụ
                    </th>
                    {draftGroups.map((g) => (
                      <th key={g.id} className="p-3 text-center font-extrabold min-w-[130px]">
                        <div>{getRoleLabel(g.id)}</div>
                        <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                          {accounts.filter((a) => a.role === g.id && a.status === 'active').length}{' '}
                          TK đang mở
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-2 bg-sky-50/70 text-[11px] font-extrabold text-sky-900"
                    >
                      I. MỤC CHỨC NĂNG ĐƯỢC TRUY CẬP ({SYSTEM_MODULES_META.length} MỤC TRONG HỆ THỐNG)
                    </td>
                  </tr>
                  {SYSTEM_MODULES_META.map((mod) => (
                    <tr key={mod.id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{mod.label}</div>
                        <div className="text-[11px] text-slate-500">{mod.description}</div>
                      </td>
                      {draftGroups.map((g) => {
                        const checked =
                          (g.id === 'admin' && mod.lockedForAdmin) ||
                          g.allowedModules.includes(mod.id);
                        const locked = g.id === 'admin' && Boolean(mod.lockedForAdmin);
                        return (
                          <td key={`${mod.id}_${g.id}`} className="p-3 text-center">
                            <label className="inline-flex items-center justify-center p-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked}
                                onChange={() => toggleGroupModule(g.id, mod.id)}
                                className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50 cursor-pointer"
                                title={
                                  locked
                                    ? 'Quản trị viên luôn có quyền truy cập mục này để tránh tự khóa hệ thống.'
                                    : `Bật/tắt mục "${mod.label}" cho ${getRoleLabel(g.id)}`
                                }
                              />
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-2 bg-emerald-50/70 text-[11px] font-extrabold text-emerald-900"
                    >
                      II. QUYỀN THAO TÁC NGHIỆP VỤ CHI TIẾT
                    </td>
                  </tr>
                  {CAPABILITY_META.map((cap) => (
                    <tr key={cap.key} className="hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{cap.label}</div>
                        <div className="text-[11px] text-slate-500">{cap.hint}</div>
                      </td>
                      {draftGroups.map((g) => (
                        <td key={`${cap.key}_${g.id}`} className="p-3 text-center">
                          <label className="inline-flex items-center justify-center p-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(g[cap.key])}
                              onChange={() => toggleGroupCapability(g.id, cap.key)}
                              className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-[11px] text-slate-600 space-y-1">
              <p className="font-bold text-slate-800">Lưu ý bảo mật:</p>
              <p>
                • Dù thay đổi phân quyền nhóm, Giáo viên chủ nhiệm (GVCN) vẫn chỉ thao tác trên đúng lớp mình phụ trách hoặc lớp đã vào bằng mã chia sẻ.
              </p>
              <p>
                • Mục <strong>Quản lý Người dùng</strong> và <strong>Cài đặt &amp; 61 Lớp</strong> luôn được khóa bảo vệ cho nhóm Quản trị viên để không thể tự mất quyền quản trị.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: STAFF LINKS (ACCOUNTANT / MEDICAL) & 61-CLASS GVCN LINKS */}
      {subTab === 'invites' && (
        <div className="space-y-4">
          {pendingInviteSyncCount > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-950">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold">
                    Có {pendingInviteSyncCount} liên kết mới tạo đang chờ đồng bộ lên máy chủ Cloud.
                  </p>
                  <p className="text-amber-900 mt-0.5">
                    Cần bấm đồng bộ lên Cloud để Giáo viên dùng điện thoại khác có thể bấm vào link truy cập được ngay.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={syncingInvites}
                onClick={handleSyncInvitesNow}
                className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>{syncingInvites ? 'Đang đồng bộ...' : 'Đồng bộ link lên Cloud ngay'}</span>
              </button>
            </div>
          )}

          {/* Section 1: School-wide Member Role Links */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  1. Link truy cập Toàn trường (Kế toán &amp; Nhân viên Y tế — Không cần đăng nhập)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tạo và gửi link hoặc QR để bộ phận Kế toán / Y tế bấm vào xem thẳng các mục đã cấp ở tab Phân quyền Nhóm.
                </p>
              </div>
              {canManageUsers && (
                <button
                  type="button"
                  onClick={() => setSubTab('groups')}
                  className="min-h-[36px] self-start inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Chỉnh quyền từng nhóm</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {staffLinkRoles.map((target) => {
                const inv = inviteByStaffRole.get(target.role) || null;
                const effGroup = resolveEffectiveGroup(target.role, permissionGroups);
                const grantedNames = SYSTEM_MODULES_META.filter((m) =>
                  effGroup.allowedModules.includes(m.id)
                )
                  .map((m) => m.shortLabel)
                  .join(', ');
                const isRoleBusy = busyId === `role_${target.role}`;

                return (
                  <div
                    key={target.role}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-extrabold text-slate-900">{target.title}</h4>
                        {inv ? (
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                              inv.active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-rose-200 bg-rose-50 text-rose-700'
                            }`}
                          >
                            {inv.active ? 'Đang mở link' : 'Đang tạm khóa'}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Chưa tạo link</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">{target.subtitle}</p>
                      <p className="text-[11px] font-semibold text-sky-800">
                        Quyền mục hiện tại: {grantedNames || 'Chưa cấp mục nào'}
                      </p>
                    </div>

                    {!inv ? (
                      <button
                        type="button"
                        disabled={isRoleBusy}
                        onClick={() => handleCreateOrRotateForRole(target.role, null)}
                        className="min-h-[40px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                        <span>{isRoleBusy ? 'Đang tạo link...' : `Tạo link vào ${target.title}`}</span>
                      </button>
                    ) : (
                      <div className="space-y-2.5 pt-1 border-t border-slate-200">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-extrabold text-slate-900 text-sm">
                            {inv.code}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {inv.usageCount} lượt mở
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(buildClassInviteUrl(inv.code), `link_${inv.id}`)
                            }
                            className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                          >
                            {copiedToken === `link_${inv.id}` ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Đã copy link</span>
                              </>
                            ) : (
                              <>
                                <Link2 className="w-3.5 h-3.5 text-sky-400" />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setInviteShareTarget(null);
                              setRoleShareTarget(target);
                            }}
                            className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer whitespace-nowrap"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QR &amp; Chia sẻ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isRoleBusy}
                            onClick={() => handleToggleInviteStatus(inv, !inv.active)}
                            className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap ${
                              inv.active
                                ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            }`}
                          >
                            {inv.active ? (
                              <>
                                <Lock className="w-3.5 h-3.5" />
                                <span>Khóa</span>
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3.5 h-3.5" />
                                <span>Mở</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={isRoleBusy}
                            onClick={() => setPendingDeleteInvite(inv)}
                            className="min-h-[36px] inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Xóa link bộ phận"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: 61 Class Links for GVCN */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  2. Link &amp; Mã Điểm danh cho Giáo viên chủ nhiệm 61 Lớp ({inviteStats.openCount}/
                  {inviteStats.totalClasses} lớp đang mở)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mỗi lớp có link &amp; QR riêng. Giáo viên bấm vào link hoặc quét QR sẽ mở thẳng giao diện điểm danh đúng lớp đó (không cần đăng nhập Google).
                </p>
              </div>

              <button
                type="button"
                disabled={busyId === 'gen_61'}
                onClick={handleGenerateMissing61}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <KeyRound className="w-4 h-4 text-sky-400" />
                <span>
                  {busyId === 'gen_61'
                    ? 'Đang khởi tạo link...'
                    : 'Tạo link cho các lớp chưa có mã'}
                </span>
              </button>
            </div>

            {/* Grade filter & Search */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto no-scrollbar">
                {(['all', 6, 7, 8, 9] as const).map((g) => (
                  <button
                    key={String(g)}
                    type="button"
                    onClick={() => setInviteGradeFilter(g)}
                    className={`min-h-[38px] px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                      inviteGradeFilter === g
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {g === 'all' ? `Tất cả (${activeClasses.length})` : `Khối ${g}`}
                  </button>
                ))}
              </div>

              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Tìm theo tên lớp (6/1, 9/19), tên GVCN hoặc mã mời..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            {/* Mobile 61-Class Invite Cards (< md) */}
            <div className="md:hidden space-y-2.5">
              {filteredInviteClasses.map((cls) => {
                const inv = inviteByClassId.get(cls.id);
                const isRowBusy = busyId === `inv_${cls.id}`;
                return (
                  <div
                    key={`mob_inv_${cls.id}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-slate-900">
                          Lớp {cls.name}{' '}
                          <span className="text-xs font-medium text-slate-500">· Khối {cls.grade}</span>
                        </div>
                        <div className="text-xs text-slate-600 truncate">{cls.teacherName}</div>
                      </div>
                      {!inv ? (
                        <span className="text-[11px] font-semibold text-slate-400 shrink-0">Chưa có mã</span>
                      ) : inv.active ? (
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 shrink-0">
                          Đang mở
                        </span>
                      ) : (
                        <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 shrink-0">
                          Tạm khóa
                        </span>
                      )}
                    </div>

                    {!inv ? (
                      <button
                        type="button"
                        disabled={isRowBusy}
                        onClick={() => handleCreateOrRotateForClass(cls, null)}
                        className="min-h-[40px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                        <span>Tạo link &amp; mã vào lớp</span>
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-sm font-extrabold text-slate-900">
                            {inv.code}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {inv.usageCount} lượt mở
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(buildClassInviteUrl(inv.code), `link_${inv.id}`)
                            }
                            className="min-h-[38px] flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer whitespace-nowrap"
                          >
                            {copiedToken === `link_${inv.id}` ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Đã copy link</span>
                              </>
                            ) : (
                              <>
                                <Link2 className="w-3.5 h-3.5 text-sky-400" />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setInviteShareTarget(cls)}
                            className="min-h-[38px] inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer whitespace-nowrap"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QR</span>
                          </button>
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => handleToggleInviteStatus(inv, !inv.active)}
                            className={`min-h-[38px] inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap ${
                              inv.active
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {inv.active ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            <span>{inv.active ? 'Khóa' : 'Mở'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => setPendingDeleteInvite(inv)}
                            className="min-h-[38px] inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 cursor-pointer"
                            title="Xóa mã lớp"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Class Invite Table (>= md) */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                  <tr>
                    <th className="p-3 w-24">Lớp</th>
                    <th className="p-3">GVCN phụ trách</th>
                    <th className="p-3">Mã vào lớp</th>
                    <th className="p-3">Trạng thái</th>
                    <th className="p-3">Lượt sử dụng</th>
                    <th className="p-3 text-right">Thao tác chia sẻ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredInviteClasses.map((cls) => {
                    const inv = inviteByClassId.get(cls.id);
                    const isRowBusy = busyId === `inv_${cls.id}`;
                    return (
                      <tr key={cls.id} className="hover:bg-slate-50/80">
                        <td className="p-3 font-extrabold text-slate-900">
                          <div>Lớp {cls.name}</div>
                          <div className="text-[11px] font-normal text-slate-500">
                            Khối {cls.grade}
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-semibold">{cls.teacherName}</td>
                        <td className="p-3">
                          {inv ? (
                            <span className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-sm font-extrabold tracking-wide text-slate-900">
                              {inv.code}
                            </span>
                          ) : (
                            <span className="text-slate-400">Chưa tạo mã</span>
                          )}
                        </td>
                        <td className="p-3">
                          {!inv ? (
                            <span className="text-slate-400">—</span>
                          ) : inv.active ? (
                            <span className="inline-block rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">
                              Đang mở
                            </span>
                          ) : (
                            <span className="inline-block rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 font-bold text-rose-700">
                              Tạm khóa
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-600">
                          {inv ? (
                            <div>
                              <span className="font-mono font-bold text-slate-900">
                                {inv.usageCount} lượt
                              </span>
                              {inv.lastUsedByEmail && (
                                <div className="text-[11px] text-slate-500 font-mono truncate max-w-[180px]">
                                  {inv.lastUsedByEmail}
                                </div>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {!inv ? (
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => handleCreateOrRotateForClass(cls, null)}
                                className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                              >
                                <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                                <span>Tạo mã</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(inv.code, `code_${inv.id}`)}
                                  className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                                >
                                  {copiedToken === `code_${inv.id}` ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Đã copy</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                                      <span>Copy mã</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyText(buildClassInviteUrl(inv.code), `link_${inv.id}`)
                                  }
                                  className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                                >
                                  {copiedToken === `link_${inv.id}` ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Đã copy</span>
                                    </>
                                  ) : (
                                    <>
                                      <Link2 className="w-3.5 h-3.5 text-sky-600" />
                                      <span>Link</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setInviteShareTarget(cls)}
                                  className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer whitespace-nowrap"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>QR &amp; Chia sẻ</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => handleToggleInviteStatus(inv, !inv.active)}
                                  className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap ${
                                    inv.active
                                      ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                      : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                  }`}
                                >
                                  {inv.active ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5" />
                                      <span>Khóa</span>
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5" />
                                      <span>Mở</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => setPendingDeleteInvite(inv)}
                                  className="min-h-[36px] inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                                  title="Xóa mã lớp"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Account Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-sky-600" />
                <span>
                  {editingAccount ? 'Cập nhật phân quyền tài khoản' : 'Cấp quyền tài khoản mới'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Email Google đăng nhập *
                </label>
                <input
                  type="email"
                  required
                  disabled={Boolean(editingAccount)}
                  placeholder="vd: gvcn.6.1@gmail.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Họ và tên *</label>
                <input
                  type="text"
                  required
                  placeholder="Cô Nguyễn Thị Lan"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Vai trò công việc *
                </label>
                <select
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value as UserRole)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="teacher">Giáo viên chủ nhiệm (GVCN)</option>
                  <option value="accountant">Kế toán</option>
                  <option value="medical">Nhân viên Y tế</option>
                  <option value="admin">Quản trị viên (Toàn quyền)</option>
                </select>
              </div>

              {roleInput === 'teacher' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Lớp phụ trách (Bắt buộc đối với GVCN) *
                  </label>
                  <select
                    value={classIdInput}
                    onChange={(e) => setClassIdInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    {activeClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        Lớp {c.name} (Khối {c.grade})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Trạng thái tài khoản
                </label>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as AccountStatus)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="active">Đang hoạt động (Cho phép đăng nhập)</option>
                  <option value="suspended">Ngưng quyền tạm thời</option>
                  <option value="locked">Khóa tài khoản</option>
                  <option value="revoked">Thu hồi quyền truy cập</option>
                  <option value="pending">Chờ cấp quyền</option>
                </select>
              </div>

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
                  disabled={busyId === 'form'}
                  className="min-h-[42px] rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                >
                  {busyId === 'form' ? 'Đang lưu...' : 'Lưu phân quyền'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {pendingDeleteAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold">Xác nhận xóa tài khoản phân quyền</h3>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Bạn có chắc chắn muốn xóa vĩnh viễn quyền truy cập của tài khoản{' '}
              <strong className="font-mono text-slate-900">{pendingDeleteAccount.email}</strong> (
              {pendingDeleteAccount.displayName})? Tài khoản này sẽ không tự khôi phục quyền cũ khi đăng nhập lại hoặc đồng bộ giữa các thiết bị.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={busyId === pendingDeleteAccount.id}
                onClick={() => setPendingDeleteAccount(null)}
                className="min-h-[42px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={busyId === pendingDeleteAccount.id}
                onClick={handleConfirmDeleteAccount}
                className="min-h-[42px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {busyId === pendingDeleteAccount.id
                  ? 'Đang xóa...'
                  : 'Xác nhận xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Reset Permission Groups Modal */}
      {confirmResetGroups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-slate-900">
              <RotateCcw className="w-6 h-6 text-sky-600 shrink-0" />
              <h3 className="text-base font-extrabold">Khôi phục phân quyền mặc định</h3>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Thao tác này sẽ đưa quyền truy cập của 4 nhóm (GVCN, Kế toán, Nhân viên Y tế, Quản trị viên) về cấu hình chuẩn ban đầu của trường THCS Đông Thạnh.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={busyId === 'reset_groups'}
                onClick={() => setConfirmResetGroups(false)}
                className="min-h-[42px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={busyId === 'reset_groups'}
                onClick={handleConfirmResetGroups}
                className="min-h-[42px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {busyId === 'reset_groups' ? 'Đang khôi phục...' : 'Xác nhận khôi phục'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Class / Staff Invite Confirmation Modal */}
      {pendingDeleteInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold">Xác nhận xóa link / mã truy cập</h3>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Bạn có chắc chắn muốn xóa vĩnh viễn mã{' '}
              <strong className="font-mono text-slate-900">{pendingDeleteInvite.code}</strong> (
              <strong>
                {getInviteTargetRole(pendingDeleteInvite) === 'teacher'
                  ? `GVCN Lớp ${pendingDeleteInvite.className}`
                  : getRoleLabel(getInviteTargetRole(pendingDeleteInvite))}
              </strong>
              )? Sau khi xóa, đường dẫn và mã này sẽ ngừng hiệu lực trên tất cả thiết bị và không tự khôi phục khi đồng bộ lại.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={
                  busyId ===
                  (getInviteTargetRole(pendingDeleteInvite) === 'teacher'
                    ? `inv_${pendingDeleteInvite.classId}`
                    : `role_${getInviteTargetRole(pendingDeleteInvite)}`)
                }
                onClick={() => setPendingDeleteInvite(null)}
                className="min-h-[42px] rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={
                  busyId ===
                  (getInviteTargetRole(pendingDeleteInvite) === 'teacher'
                    ? `inv_${pendingDeleteInvite.classId}`
                    : `role_${getInviteTargetRole(pendingDeleteInvite)}`)
                }
                onClick={handleConfirmDeleteInvite}
                className="min-h-[42px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {busyId ===
                (getInviteTargetRole(pendingDeleteInvite) === 'teacher'
                  ? `inv_${pendingDeleteInvite.classId}`
                  : `role_${getInviteTargetRole(pendingDeleteInvite)}`)
                  ? 'Đang xóa...'
                  : 'Xác nhận xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR & Share Invite Modal */}
      <ClassInviteShareModal
        isOpen={Boolean(inviteShareTarget || roleShareTarget)}
        onClose={() => {
          setInviteShareTarget(null);
          setRoleShareTarget(null);
        }}
        schoolClass={inviteShareTarget}
        roleTarget={roleShareTarget}
        invite={activeShareModalInvite}
        onCreateOrRotate={handleCreateOrRotateForClass}
        onCreateOrRotateRole={handleCreateOrRotateForRole}
        onToggleActive={handleToggleInviteStatus}
      />
    </div>
  );
};

