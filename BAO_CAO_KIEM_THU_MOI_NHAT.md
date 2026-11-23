# Kết quả kiểm tra bổ sung – 18/11/2026

## Đã thực thi
- `node kiem-tra-tinh.js`: 8/8 phép kiểm tra tĩnh PASS.
- `npm ci`: không chạy được vì dự án chỉ có `bun.lock`, không có `package-lock.json`.
- `npm install --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=12000`: hết thời gian chờ; không có `node_modules` đầy đủ.

## Chưa thể xác nhận
- `npm run lint`, `npm run build`, `npm run dev`: không chạy được vì chưa cài thư viện.
- Đăng nhập Google và mã mời: chưa kiểm thử trên trình duyệt và Firebase Authentication.
- Ghi, sửa, chốt suất ăn và tổng hợp/xuất báo cáo: chưa chạy kiểm thử nghiệp vụ với Firestore Emulator.
- `firestore.rules.test.ts` là danh sách kịch bản, không phải bộ test thực thi.

## Rủi ro tồn đọng
- `isAuthorizedInviteActor` hiện trả về `false`, do đó đường ghi qua mã mời cũ bị vô hiệu hóa. Cần thiết kế cơ chế đăng nhập xác thực trước khi đưa vào vận hành.
- Không triển khai các quy tắc mới vào hệ thống sản xuất trước khi thử nghiệm phân quyền từng vai trò.

## Chạy trên máy có mạng
1. Cài Node.js phù hợp Vite 8 (Node 20.19+ hoặc 22.12+).
2. Tại thư mục dự án chạy `npm install` (hoặc dùng Bun theo `bun.lock`).
3. Chạy `npm run lint`, `npm run build`, `npm run dev`.
4. Cấu hình dự án Firebase thử nghiệm và Firebase Emulator, tạo dữ liệu giả, thử đăng nhập admin/giáo viên/kế toán/y tế và đối chiếu số liệu báo cáo.

Không dùng dữ liệu học sinh thật để thử nghiệm.
