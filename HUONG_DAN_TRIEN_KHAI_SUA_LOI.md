# Sửa đăng nhập bằng link dành cho kế toán

## Quan trọng
- **Chưa triển khai lên Firebase và chưa kiểm thử trên dữ liệu thật.** Sao lưu Firestore và kiểm thử trên dự án thử nghiệm trước.
- Không cần tài khoản Google cho kế toán; quản trị viên vẫn dùng Google.
- Bản vá yêu cầu Cloud Functions và có thể cần gói Firebase Blaze (tính phí theo mức sử dụng).
- Mã mời trong URL là thông tin bí mật: sau khi triển khai, thu hồi mã đã chia sẻ và tạo mã mới.

## Các bước
1. Kiểm tra `firebase-applet-config.json` và xác nhận `projectId` / `firestoreDatabaseId` đúng dự án thật. **Không triển khai nhầm dự án**.
2. `npm install` tại thư mục gốc, `npm install` trong `functions/`.
3. Tạo `.env.production` từ `.env.production.example`, thay `VITE_PUBLIC_APP_URL` bằng **URL Firebase Hosting thực tế** (ví dụ `https://PROJECT_ID.web.app`).
4. Cloud Functions cần truy cập đúng Firestore database. Đặt biến môi trường `MEAL_FIRESTORE_DATABASE_ID` trong `functions/.env` theo `firestoreDatabaseId` từ `firebase-applet-config.json` (nếu không dùng database mặc định).
5. Kiểm tra cấu hình Firebase CLI (`firebase login`, `firebase use --add`) và project đích, xác nhận project ID trước khi deploy.
6. `npm run lint && npm run build`. Kiểm thử Firebase Emulator trước, nhất là rules và luồng nhập/sửa tiền ăn.
7. Triển khai lần lượt `firebase deploy --only functions:meal-invites`, `firebase deploy --only firestore:rules`, `firebase deploy --only hosting`.
8. Mở link `https://YOUR_PROJECT_ID.web.app/?invite=MA_MOI_MOI` bằng cửa sổ ẩn danh, kiểm tra xem/in báo cáo, thêm/sửa khoản thu, khóa sổ, thu hồi mã, và xác minh Google admin không đổi.

## Bảo mật
- Cloud Functions xác minh mã mời, vai trò, trạng thái và giới hạn thử mã theo IP. Firestore Rules kiểm tra UID đã xác thực khớp mã mời và mã còn hiệu lực trước khi cho phép sửa khoản thu.
- **Cần kiểm thử toàn bộ Firestore Rules với Firebase Emulator trước khi đưa vào vận hành.** Các quy tắc hiện hữu cho phép đọc ẩn danh nhiều collection; đây là vấn đề bảo mật có sẵn cần đánh giá riêng, không tự ý khóa vì có thể làm hỏng luồng khác.
- Mã mời dạng ngắn trong URL dễ bị chuyển tiếp; nên cân nhắc thay bằng mã ngẫu nhiên dài và quy trình thu hồi định kỳ.
- Không đưa Admin SDK vào frontend và không cấp quyền quản trị cho tài khoản mã mời.
