# Path: msi-build-service/CHANGE_LOGS_USER.md

# Purpose: Lịch sử thay đổi theo góc nhìn người dùng/vận hành — entry mới nhất ở đầu file

---

## [2026-04-03] — Scripts kiểm tra và cài đặt Windows Service

### Công cụ mới cho vận hành

- **Kiểm tra kết nối Firebase** (`npm run test:firebase`) — chạy trước khi deploy để xác nhận credentials hợp lệ
- **Mô phỏng job build** (`npm run test:job`) — tạo job thử nghiệm và theo dõi kết quả real-time, dùng để kiểm tra toàn bộ luồng từ đầu đến cuối
- **Kiểm tra clone repo** (`npm run test:clone`) — xác nhận quyền truy cập GitHub và tốc độ clone
- **Kiểm tra build MSI** (`npm run test:build`) — test AdvinstBuilder với repo đã clone sẵn
- **Kiểm tra upload** (`npm run test:upload`) — test từng storage target, tự tạo file giả nếu chưa có MSI thật

### Cài đặt như Windows Service

- Chạy `npm run service:install` (với quyền Administrator) để đăng ký service tự khởi động cùng Windows
- Service tự restart nếu bị crash (tối đa 5 lần)
- Gỡ cài đặt bằng `npm run service:uninstall`

---

---

## [2026-04-03] — Build pipeline hoàn chỉnh: từ push code đến file MSI trên storage

### Tính năng hoạt động đầy đủ

- Hệ thống đã có thể nhận job từ Firebase, clone code, build file `.msi` và upload lên tất cả storage targets trong một luồng tự động hoàn chỉnh
- Khi máy build nhận được job mới: tự động clone (hoặc cập nhật) code từ GitHub, đọc version từ file `.exe`, build MSI với Advanced Installer, rồi upload song song lên OneDrive / S3 / Google Drive / NAS
- Nếu file MSI đã tồn tại trên storage → bỏ qua bước upload đó, không upload lại
- Mỗi bước (clone, build, từng storage upload) đều được ghi trạng thái lên Firebase real-time

### Cải thiện độ tin cậy

- Clone repo: nếu cache bị hỏng sẽ tự xóa và clone lại từ đầu mà không cần can thiệp thủ công
- Build: có giới hạn thời gian tối đa (mặc định 5 phút) — nếu `advinst.exe` bị treo sẽ tự kill và báo lỗi
- Upload: nếu 1 storage target bị lỗi, các target khác vẫn tiếp tục bình thường
- File `.aip` gốc trong repo không bao giờ bị sửa — service clone ra bản riêng để build

### Cấu hình dự án (cho developer)

- Thêm file `.aip.json` vào repo để chỉ định file `.aip`, `mainExe`, tên MSI output, v.v.
- Không bắt buộc — service tự tìm file `.aip` và `.exe` nếu không có `.aip.json`

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
