/**
 * Security Rules Verification Suite for THCS Đông Thạnh Boarding Meal System
 * Verifies that all adversarial payloads defined in security_spec.md
 * are rejected with PERMISSION_DENIED by firestore.rules.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  guardTriggered: string;
}

export const DIRTY_DOZEN_VERIFICATION_SUITE: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Forged Invite UID Write on /registrations',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isAuthorizedInviteActor(...) -> hasValidActiveInvite(code)',
  },
  {
    id: 2,
    name: 'Unverified Email Admin Spoof on /settings',
    collection: 'settings',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isVerified() -> request.auth.token.email_verified == true',
  },
  {
    id: 3,
    name: 'PII Leak on /users/{otherUid} and /accountAccess',
    collection: 'users',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isVerified() && (request.auth.uid == userId || isAdmin())',
  },
  {
    id: 4,
    name: 'Privilege Escalation Self-Assigning Admin Role on /users',
    collection: 'users',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'incoming().role != "admin" || isBootstrappedAdmin()',
  },
  {
    id: 5,
    name: 'Shadow Field Injection (isBypassed: true) on /registrations',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isValidMealRegistration(incoming()) -> data.keys().hasOnly(...)',
  },
  {
    id: 6,
    name: 'Oversized String DoS (5000 chars) on /students',
    collection: 'students',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isValidStudent(incoming()) -> data.fullName.size() <= 120',
  },
  {
    id: 7,
    name: 'ID Poisoning with Special Characters on /classes',
    collection: 'classes',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isValidId(classId) -> id.matches("^[a-zA-Z0-9_\\\\-]+$")',
  },
  {
    id: 8,
    name: 'Identity Spoofing (updatedByUid != request.auth.uid) on /registrations',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'data.updatedByUid == request.auth.uid || isAuthorizedInviteActor(...)',
  },
  {
    id: 9,
    name: 'Immutable Field Mutation (changing studentId/date) on /registrations',
    collection: 'registrations',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'incoming().studentId == existing().studentId && incoming().date == existing().date',
  },
  {
    id: 10,
    name: 'Forged Past Timestamp on /registrations',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'incoming().createdAt == request.time',
  },
  {
    id: 11,
    name: 'Audit Log Tampering (update/delete) on /registrationLogs',
    collection: 'registrationLogs',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'allow update: if false',
  },
  {
    id: 12,
    name: 'Unfiltered List Query on /users or /classInvites without Admin Auth',
    collection: 'classInvites',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isVerified() && (isAdmin() || hasGroupFlag("canShareClassCode"))',
  },
  {
    id: 13,
    name: 'Teacher Modification Blocked after Daily Report is Locked on /registrations',
    collection: 'registrations',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: '!isReportLocked(existing().env, existing().date)',
  },
  {
    id: 14,
    name: 'Teacher Link or Account Attempting to Register Student of Another Class',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isTeacherForClass(incoming().classId) || inviteDoc(code).classId == incoming().classId',
  },
  {
    id: 15,
    name: 'Locked or Revoked Invite Link Attempting Write on /registrations',
    collection: 'registrations',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'hasValidActiveInvite(code) -> inviteDoc.active == true',
  },
  {
    id: 16,
    name: 'Link User Attempting to Lock Reports or Delete Student on /students',
    collection: 'students',
    operation: 'delete',
    expectedOutcome: 'PERMISSION_DENIED',
    guardTriggered: 'isVerified() && (isAdmin() || ...)',
  },
];
