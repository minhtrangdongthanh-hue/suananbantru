# Kết quả kiểm tra biên dịch và luồng nghiệp vụ — 18/11/2026

## 1. Biên dịch
- Thử `npm install --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=0`: hết thời gian chờ 90 giây, không tạo được bộ thư viện hoàn chỉnh.
- `npm run lint`: TS2688, thiếu định nghĩa `vite-plugin-pwa/client` và `vite/client` do chưa cài dependency.
- `npm run build`: chưa thể chạy vì thiếu Vite. Không được coi là build đạt.
- Chưa chạy được máy chủ Vite và chưa kiểm thử giao diện trên trình duyệt.

## 2. Đăng nhập
- Có lời gọi `signInWithPopup(auth, googleProvider)` trong `src/App.tsx` (khoảng dòng 1503, 2449).
- Có xử lý mã mời, nhưng quy tắc bảo mật bản vá đã chặn ghi theo danh tính mã mời chưa được xác thực; cần kiểm thử và sửa luồng đăng ký bằng liên kết trước khi triển khai.
- Chưa kiểm thử tài khoản thật hoặc Firebase Emulator.

## 3. Suất ăn và báo cáo
- Có mô-đun `mealService` và giao diện báo cáo trong mã nguồn.
- Quy tắc `firestore.rules` cho báo cáo có điều kiện `existing().visibility == 'school'` khi truy vấn danh sách (dòng ~721). Nếu tài liệu không có trường `visibility`, hoặc truy vấn không phù hợp quy tắc, chức năng báo cáo có thể bị từ chối. Cần kiểm thử trên Emulator với dữ liệu mẫu.
- Tương tự cần kiểm tra quyền truy vấn đăng ký theo từng lớp, kế toán và y tế.
- Chưa xác nhận được đăng ký, chỉnh sửa, tổng hợp và xuất báo cáo chạy thành công.

## 4. Bộ kiểm thử
- `firestore.rules.test.ts` chỉ định nghĩa dữ liệu tình huống, không thực thi `assertSucceeds`/`assertFails` với Emulator.
- Cần xây dựng test thực thi và dữ liệu mẫu cho vai trò admin, giáo viên đúng/sai lớp, kế toán, y tế, khách chưa đăng nhập.

## Kết luận
CHƯA ĐẠT ĐIỀU KIỆN TRIỂN KHAI. Các kiểm tra chưa thực hiện không được xem là đạt. Không thay thế ứng dụng đang chạy bằng bản này.
