# Báo cáo bản vá bảo mật — THCS Đông Thạnh

## Các thay đổi đã thực hiện
1. `firestore.rules`: Yêu cầu tài khoản đã xác minh, đang hoạt động khi đọc tài liệu thuộc các bộ sưu tập nghiệp vụ; giới hạn quyền xem học sinh, đăng ký và nhật ký theo vai trò/lớp; siết truy vấn danh sách.
2. `firestore.rules`: Tạm vô hiệu hóa nhánh ghi Firestore sử dụng `invite_*` không gắn với danh tính Firebase; tạm chặn cập nhật lượt sử dụng mã mời từ người chưa đăng nhập.
3. `src/services/localStoreFallback.ts`: Không còn nuốt lỗi ghi localStorage; ném lỗi tiếng Việt để tầng gọi có thể thông báo thay vì coi thao tác lưu thành công.

## Chưa hoàn thành / ảnh hưởng cần biết
- Chức năng đăng ký bằng liên kết/mã mời không đăng nhập có thể không hoạt động sau khi triển khai quy tắc mới. Cần thiết kế đổi mã mời thành phiên đăng nhập Firebase được xác thực (ví dụ Cloud Function + custom token), kiểm soát lớp và thời hạn trước khi triển khai.
- Các truy vấn danh sách của giáo viên có thể cần thêm bộ lọc lớp phù hợp với Firestore Rules. Cần thử nghiệm từng màn hình với Firebase Emulator.
- Chưa khóa cấu hình Firebase tùy chỉnh vì việc này cần biết dự án Firebase chính thức và quy trình chuyển đổi hiện tại.
- Chưa triển khai sao lưu máy chủ, xử lý xung đột đồng bộ hoặc kiểm tra tất cả đường gọi saveHybridStore.
- Chưa xác nhận TypeScript/build: thiếu node_modules; `npm run lint` trả lỗi thiếu `vite/client` và `vite-plugin-pwa/client`. Lệnh npm install đã hết thời gian chờ.
- Chưa chạy kiểm thử Firebase Emulator hoặc kiểm thử thực tế. File `firestore.rules.test.ts` hiện chỉ khai báo tình huống, không phải test thực thi.

## Trước khi triển khai
1. Sao lưu Firestore, xác nhận dự án đích và cấu hình môi trường.
2. Cài dependency bằng `npm ci` (nếu có package-lock) hoặc `npm install`; chạy `npm run lint`, `npm run build`.
3. Kiểm thử Firestore Emulator với người chưa đăng nhập, quản trị viên, giáo viên đúng/sai lớp, kế toán, y tế và mã mời.
4. Hoàn thiện luồng đăng nhập giáo viên qua mã mời và sửa các truy vấn bị từ chối trước khi cập nhật quy tắc production.

**Trạng thái:** Bản vá bước đầu để đánh giá, KHÔNG phải bản đã kiểm thử đủ điều kiện triển khai chính thức.
