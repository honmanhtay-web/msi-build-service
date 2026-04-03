# Path: msi-build-service/README.md
# Purpose: Hướng dẫn nhanh để bắt đầu với MSI Build Service
# Last Updated: 2026-04-03

# MSI Build Service

Hệ thống tự động build file cài đặt `.msi` khi có code push lên GitHub,
sử dụng Advanced Installer, và upload song song lên nhiều storage target.

## Luồng Hoạt Động

```
GitHub push → Webhook → Firebase Realtime DB
                                │
                     Build Service (Node.js, Windows)
                                │
                    ┌───────────┼───────────┐
                    │           │           │
              Clone repo    Build MSI   Upload song song
              (incremental) (advinst)   OneDrive/S3/GDrive/NAS
```

## Bắt Đầu Nhanh

```powershell
# 1. Clone và cài dependencies
git clone https://github.com/yourorg/msi-build-service.git
cd msi-build-service
npm install

# 2. Cấu hình môi trường
Copy-Item .env.example .env
notepad .env   # Điền đầy đủ giá trị

# 3. Chạy service
npm start
```

## Tài Liệu

| File | Mô tả |
|------|-------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kiến trúc tổng thể, luồng dữ liệu |
| [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) | Cấu trúc thư mục, quy tắc đặt tên |
| [docs/AGENT_RULES.md](docs/AGENT_RULES.md) | Quy tắc cho AI agent làm việc với dự án |
| [docs/FIREBASE_SCHEMA.md](docs/FIREBASE_SCHEMA.md) | Schema Firebase, TTL rules |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hướng dẫn deploy từng bước |
| [.env.example](.env.example) | Mẫu biến môi trường |

## Yêu Cầu

- Windows 10/11 hoặc Windows Server 2019/2022
- Node.js >= 18 LTS
- Git trong PATH
- Advanced Installer đã cài + có license
- PowerShell (`powershell.exe` hoặc `pwsh`)

## Thêm Upload Target Mới

Xem hướng dẫn tại [docs/DEPLOYMENT.md#8-thêm-upload-adapter-mới](docs/DEPLOYMENT.md).

## License

UNLICENSED — Internal use only, DHG Pharma.
