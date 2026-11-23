# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Catch-All**: All unspecified paths in Firestore are strictly denied (`allow read, write: if false;`).
2. **Admin Google Authentication + Verified Share-Link Member Access**: Only Administrators (`minhtrangdongthanh@gmail.com` or active Admin accounts) require Google Authentication (`request.auth != null && request.auth.token.email_verified == true`). Non-admin members (GVCN, Kế toán, Nhân viên Y tế) authenticate via an active, non-revoked `/classInvites/{code}` link token (`actorUid == 'invite_' + code`).
3. **PII Isolation (`/users/{userId}`, `/accountAccess/{accessId}`, list `/classInvites`)**: `get` and `list` of account credentials and PII are strictly restricted to the verified owner or an active verified Admin. Passwordless link sessions can never read or list `/users` or `/accountAccess`.
4. **Live Link & Permission Group Enforcement (`isAuthorizedInviteActor`)**: Every write from a share-link session verifies in Firestore Rules that:
   - `/classInvites/{code}` exists and `active == true`.
   - `/permissionGroups/{role}` explicitly grants the corresponding module (`teacher` / `students`) and capability flag (`canMarkAttendance` / `canManageStudents`).
   - Homeroom teachers (`teacher`) can ONLY write registrations for their assigned `inviteDoc(code).classId` and ONLY while `!isReportLocked`.
5. **Accountant & Medical Enforcement**: `accountant` and `medical` link sessions have read access to operational school collections (`classes`, `students`, `registrations`, `logs`, `reports`, `archives`) and CANNOT modify daily locks, settings, user accounts, or permanent deletions unless explicitly authorized by an Admin.
6. **Strict Key & Size Validation (Anti-Update-Gap)**: Every `create` and `update` validates exact keys (`hasAll` and `hasOnly`), string `.size()` boundaries, enum values, and immutable fields (`id`, `createdAt`, `schoolId`).
7. **Temporal Integrity**: `createdAt` on create and `updatedAt` on update must equal `request.time`.

## 2. The "Dirty Dozen" Payloads

1. **Forged Unauthenticated Write**: `auth = null` attempting to create `/registrations/prod_2026-11-16_hs1` with an invalid or disabled invite code (`updatedByUid: 'invite_FAKE9999'`).
2. **Unverified Email Admin Spoof**: `auth = { uid: 'u1', token: { email: 'minhtrangdongthanh@gmail.com', email_verified: false } }` attempting to update `/settings/general_settings`.
3. **PII Leak on `/users`**: Authenticated user `u2` or unauthenticated link session attempting `get` on `/users/u1` or `list` on `/accountAccess`.
4. **Privilege Escalation on Profile Create**: Non-admin user `u2` creating `/users/u2` with `role: 'admin'`.
5. **Shadow Field Injection on Registration**: Creating `/registrations/prod_2026-11-16_hs1` with extra field `isBypassed: true`.
6. **Oversized String DoS**: Creating `/students/stu_1` with a 5,000-character `fullName` string (exceeding `maxLength: 120`).
7. **ID Poisoning**: Creating `/classes/invalid$id!@#` with non-alphanumeric characters.
8. **Identity Spoofing on Registration**: User `u1` creating a registration where `updatedByUid: 'u2'`.
9. **Immutable Field Mutation**: Updating `/registrations/prod_2026-11-16_hs1` and changing `studentId` or `createdAt`.
10. **Forged Past Timestamp**: Creating `/registrations/prod_2026-11-16_hs1` with `createdAt` set to a past timestamp instead of `request.time`.
11. **Log Tampering**: Attempting to `update` or `delete` an existing audit record in `/registrationLogs/{logId}`.
12. **Blanket Unfiltered List Query**: Attempting `list` on `/users` or `/classInvites` without Admin verification.
13. **Teacher Cross-Class Registration**: GVCN link or account assigned to `6/1` attempting to register a student in `6/2`.
14. **Locked Invite Link Mutation**: Locked or deleted `/classInvites/{code}` (`active == false`) attempting to write `/registrations`.
15. **Link Privilege Escalation on Daily Reports / Settings**: Non-admin Google or link user attempting to create/update `/dailyReports`, `/settings`, `/permissionGroups`, or delete `/students/{studentId}`.

