import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8');
const rules=read('firestore.rules');
const local=read('src/services/localStoreFallback.ts');
const app=read('src/App.tsx');
const tests=[
 ['Quy tắc học sinh yêu cầu xác thực', /match \/students\/\{studentId\}[\s\S]*?allow get: if isVerified\(\)/.test(rules)],
 ['Quy tắc suất ăn yêu cầu xác thực', /match \/registrations\/\{registrationId\}[\s\S]*?allow get: if isVerified\(\)/.test(rules)],
 ['Quy tắc báo cáo yêu cầu xác thực', /match \/dailyReports\/\{reportId\}[\s\S]*?allow get: if isVerified\(\)/.test(rules)],
 ['Đường ghi mã mời cũ bị chặn', /function isAuthorizedInviteActor\([\s\S]*?return false &&/.test(rules)],
 ['Lỗi ghi localStorage được thông báo', /localStorage\.setItem\(STORAGE_KEY,[\s\S]*?catch \(error\) \{[\s\S]*?throw new Error/.test(local)],
 ['Có xử lý đăng nhập Google', app.includes('signInWithPopup(auth, googleProvider)')],
 ['Có dịch vụ suất ăn', fs.existsSync('src/services/mealService.ts')],
 ['Có cấu trúc kiểm thử quy tắc', fs.existsSync('firestore.rules.test.ts')]
];
for(const [name,ok] of tests) console.log(`${ok?'PASS':'FAIL'} | ${name}`);
if(tests.some(x=>!x[1])) process.exitCode=1;
