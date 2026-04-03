# Path: msi-build-service/CHANGE_LOGS_USER.md
# Purpose: Lịch sử thay đổi theo góc nhìn người dùng/vận hành — entry mới nhất ở đầu file

---

## [2026-04-03] — Phiên bản đầu tiên: Thiết kế hệ thống tự động build MSI

### Tính năng mới
- Hệ thống tự động phát hiện khi có code mới push lên GitHub và bắt đầu build file cài đặt (.msi)
- Nhiều máy build có thể chạy song song — mỗi job chỉ được xử lý bởi 1 máy duy nhất, không trùng lặp
- Sau khi build xong, file .msi tự động được tải lên đồng thời nhiều nơi lưu trữ:
  - OneDrive
  - Google Drive
  - AWS S3
  - NAS Synology
- Nếu file đã tồn tại trên storage → bỏ qua, không build/upload lại
- Dữ liệu cũ trên hệ thống tự được dọn dẹp theo thời gian (không tích tụ vô hạn)

### Cải thiện vận hành
- Có thể thêm máy build mới bất kỳ lúc nào mà không cần cấu hình phức tạp
- Có thể thêm storage target mới (ví dụ FTP, SharePoint) mà không ảnh hưởng hệ thống đang chạy
- Nếu máy build bị tắt đột ngột giữa chừng → job tự động được xử lý lại sau 2 giờ
- Toàn bộ trạng thái build (đang xử lý, thành công, thất bại) hiển thị trên Firebase console

### Yêu cầu triển khai
- Máy build phải chạy Windows (do Advanced Installer chỉ hỗ trợ Windows)
- Cần cài: Node.js 18+, Git, Advanced Installer, PowerShell
- Cấu hình qua file `.env` — không cần sửa code
