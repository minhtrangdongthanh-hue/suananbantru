const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const firestore = admin.firestore();
const databaseId = process.env.MEAL_FIRESTORE_DATABASE_ID || '(default)';
const db = databaseId === '(default)' ? firestore : admin.firestore().database(databaseId);
const CODE_PATTERN = /^DT(?:[6789]|KT|YT)[A-Z0-9]{4,16}$/;

exports.redeemMealInvite = onCall({ enforceAppCheck: false, maxInstances: 10 }, async (request) => {
  const code = String(request.data?.code || '').trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new HttpsError('invalid-argument', 'Mã mời không hợp lệ.');

  // Reject large volumes of guesses from one IP, including invalid codes.
  const crypto = require('crypto');
  const ip = String(request.rawRequest.ip || 'unknown');
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const key = crypto.createHash('sha256').update(ip + ':' + bucket).digest('hex');
  const rateRef = db.collection('inviteRateLimits').doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const count = snap.exists ? Number(snap.data().count || 0) : 0;
    if (count >= 15) throw new HttpsError('resource-exhausted', 'Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.');
    tx.set(rateRef, { count: count + 1, expiresAt: admin.firestore.Timestamp.fromMillis((bucket + 2) * 15 * 60 * 1000) });
  });

  const snap = await db.collection('classInvites').doc(code).get();
  if (!snap.exists || snap.get('active') !== true || snap.get('schoolId') !== 'THCS_DONG_THANH') {
    throw new HttpsError('permission-denied', 'Mã mời không tồn tại hoặc đã bị thu hồi.');
  }
  const role = snap.get('role') || 'teacher';
  if (!['teacher', 'accountant', 'medical'].includes(role)) {
    throw new HttpsError('permission-denied', 'Vai trò không hợp lệ.');
  }
  const uid = `invite_${code}`;
  const token = await admin.auth().createCustomToken(uid, { inviteCode: code, inviteRole: role });
  return { token };
});
