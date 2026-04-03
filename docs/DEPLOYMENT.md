# Path: msi-build-service/docs/DEPLOYMENT.md
# Purpose: Hướng dẫn triển khai MSI Build Service lên các môi trường khác nhau
# Author: System Design Document
# Last Updated: 2026-04-03

# DEPLOYMENT — Hướng Dẫn Triển Khai

## 1. Yêu Cầu Tối Thiểu Của Máy Host

| Yêu cầu              | Chi tiết                                                    |
|----------------------|-------------------------------------------------------------|
| OS                   | Windows 10/11 hoặc Windows Server 2019/2022                 |
| Node.js              | >= 18 LTS                                                   |
| Git                  | Phải có trong PATH                                          |
| PowerShell           | `powershell.exe` hoặc `pwsh` (PowerShell 7+)               |
| Advanced Installer   | Đã cài và có license hợp lệ                                 |
| RAM                  | Tối thiểu 4GB, khuyến nghị 8GB+ nếu chạy nhiều job song song|
| Disk                 | Tối thiểu 20GB free cho .work-dirs và .oAdvBuild            |

## 2. Chuẩn Bị Môi Trường

### Bước 1: Cài Node.js
```powershell
# Kiểm tra version
node --version   # >= 18.0.0
npm --version
```

### Bước 2: Cài Git và kiểm tra
```powershell
git --version
git config --global user.email "build-service@yourorg.com"
git config --global user.name "MSI Build Service"
```

### Bước 3: Xác nhận Advanced Installer
```powershell
# Kiểm tra advinst.exe tồn tại
Test-Path "C:\Program Files (x86)\Caphyon\Advanced Installer 21.3\bin\x86\advinst.exe"

# Hoặc tìm theo tên
Get-ChildItem -Path "C:\Program Files (x86)" -Filter "advinst.exe" -Recurse -ErrorAction SilentlyContinue
```

### Bước 4: Xác nhận PowerShell
```powershell
$PSVersionTable.PSVersion
# Nếu dùng pwsh:
pwsh --version
```

## 3. Cài Đặt Build Service

### Bước 1: Clone repo build service
```powershell
git clone https://github.com/yourorg/msi-build-service.git C:\services\msi-build-service
cd C:\services\msi-build-service
```

### Bước 2: Cài dependencies
```powershell
npm install
```

### Bước 3: Tạo file .env từ example
```powershell
Copy-Item .env.example .env
# Sau đó chỉnh sửa .env bằng editor
notepad .env
```

### Bước 4: Điền đầy đủ .env
```env
# Firebase
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}

# Advanced Installer
ADVINST_EXE_PATH=C:\Program Files (x86)\Caphyon\Advanced Installer 21.3\bin\x86\advinst.exe

# Git
GIT_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GIT_USERNAME=build-service-bot

# Service Identity
SERVICE_MACHINE_ID=build-machine-01

# Build
BUILD_MAX_CONCURRENT=2
BUILD_TIMEOUT_SECONDS=300

# Upload — S3
UPLOAD_S3_BUCKET=your-bucket
UPLOAD_S3_REGION=ap-southeast-1
UPLOAD_S3_ACCESS_KEY_ID=AKIA...
UPLOAD_S3_SECRET_ACCESS_KEY=xxx

# Upload — OneDrive
UPLOAD_ONEDRIVE_CLIENT_ID=xxx
UPLOAD_ONEDRIVE_CLIENT_SECRET=xxx
UPLOAD_ONEDRIVE_TENANT_ID=xxx
UPLOAD_ONEDRIVE_FOLDER_PATH=/MSI-Releases

# Upload — Google Drive
UPLOAD_GDRIVE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
UPLOAD_GDRIVE_FOLDER_ID=1aBcDeFgH...

# Upload — Synology NAS
UPLOAD_NAS_BASE_URL=http://192.168.1.100:5000
UPLOAD_NAS_USERNAME=build-service
UPLOAD_NAS_PASSWORD=xxx
UPLOAD_NAS_SHARE_FOLDER=/MSI-Releases

# Cleanup TTL
CLEANUP_DONE_DAYS=7
CLEANUP_FAILED_DAYS=7
CLEANUP_PENDING_DAYS=30
CLEANUP_STUCK_HOURS=2
CLEANUP_INTERVAL_MINUTES=60
```

### Bước 5: Tạo thư mục cần thiết
```powershell
New-Item -ItemType Directory -Force -Path "C:\services\msi-build-service\.work-dirs"
New-Item -ItemType Directory -Force -Path "C:\services\msi-build-service\.oAdvBuild"
```

## 4. Chạy Service

### 4.1 Chạy Thử (Development)
```powershell
cd C:\services\msi-build-service
node src/index.js
```

### 4.2 Chạy Như Windows Service (Production)

**Option A: Dùng NSSM (Non-Sucking Service Manager)**
```powershell
# Cài NSSM
choco install nssm  # hoặc tải từ https://nssm.cc/

# Đăng ký service
nssm install MsiBuildService "C:\Program Files\nodejs\node.exe" "C:\services\msi-build-service\src\index.js"
nssm set MsiBuildService AppDirectory "C:\services\msi-build-service"
nssm set MsiBuildService AppEnvironmentExtra "NODE_ENV=production"
nssm set MsiBuildService Description "MSI Build Service - Auto build MSI from GitHub push"
nssm set MsiBuildService Start SERVICE_AUTO_START

# Khởi động
nssm start MsiBuildService

# Kiểm tra
nssm status MsiBuildService
```

**Option B: Dùng node-windows (npm package)**
```powershell
npm install -g node-windows
# Chạy script đăng ký service (xem scripts/install-windows-service.js)
node scripts/install-windows-service.js
```

## 5. Triển Khai Trên GitHub Self-Hosted Runner

### 5.1 Cài GitHub Actions Runner
```powershell
# Tải runner từ GitHub Settings > Actions > Runners > New self-hosted runner
# Chọn Windows, làm theo hướng dẫn trên GitHub

# Đăng ký runner
.\config.cmd --url https://github.com/yourorg --token YOUR_TOKEN --labels "windows,msi-build"

# Chạy như service
.\svc.ps1 install
.\svc.ps1 start
```

### 5.2 Workflow Trigger Build Service
```yaml
# .github/workflows/trigger-build.yml
# Webhook → Firebase → Build Service tự động (không cần workflow này)
# Workflow này chỉ dùng nếu muốn trigger thủ công hoặc scheduled
```

## 6. Triển Khai Trên Azure Self-Hosted Agent

```powershell
# Tải Azure Pipelines Agent
# Azure DevOps > Project Settings > Agent pools > Add agent > Windows

# Đăng ký agent
.\config.cmd --pool "MSI-Build-Pool" --agent "build-machine-01" --url https://dev.azure.com/yourorg --auth pat --token YOUR_PAT

# Chạy như service
.\svc.ps1 install
.\svc.ps1 start
```

## 7. Test Sau Khi Deploy

### 7.1 Test Firebase Connection
```powershell
node scripts/test-firebase-connection.js
# Expected output:
# [OK] Firebase connected
# [OK] Build queue accessible
```

### 7.2 Test Simulate Job
```powershell
node scripts/test-simulate-job.js --repoId test-repo --repoUrl https://github.com/yourorg/test-repo
# Expected output:
# [OK] Job created: pending
# [OK] Job claimed by: build-machine-01
# [OK] Clone completed
# [OK] Build started...
# [OK] MSI created: Setup-X.v1.0.0.msi
# [OK] Upload started (parallel)...
# [OK] S3: done
# [OK] Job status: done
```

### 7.3 Test Multi-Machine Race Condition
```powershell
# Chạy 2 service instances trên cùng máy với MACHINE_ID khác nhau
# Instance 1:
$env:SERVICE_MACHINE_ID="test-01"; node src/index.js

# Instance 2 (terminal khác):
$env:SERVICE_MACHINE_ID="test-02"; node src/index.js

# Tạo 1 job → chỉ 1 instance claim được, instance kia bỏ qua
node scripts/test-simulate-job.js
```

## 8. Thêm Upload Adapter Mới

Khi cần thêm upload target mới (ví dụ FTP):

1. Tạo `src/upload/adapters/FtpAdapter.js` kế thừa `BaseAdapter`
2. Thêm env vars `UPLOAD_FTP_*` vào `.env.example`
3. Thêm section `ftp` vào `config/service.config.json`
4. Đăng ký trong `UploadManager.js`
5. Cập nhật file này (DEPLOYMENT.md) mục env vars

## 9. Logs và Monitoring

### Log Files
```
C:\services\msi-build-service\logs\
  build-service-{YYYY-MM-DD}.log   ← structured JSON log
  error-{YYYY-MM-DD}.log           ← chỉ error level
```

### Xem Log Real-time
```powershell
Get-Content "C:\services\msi-build-service\logs\build-service-$(Get-Date -Format 'yyyy-MM-dd').log" -Wait -Tail 50
```

### Kiểm Tra Service Health
```powershell
nssm status MsiBuildService
# hoặc
Get-Service MsiBuildService
```

## 10. Troubleshooting

| Triệu chứng                        | Kiểm tra                                              |
|------------------------------------|-------------------------------------------------------|
| Service không start                | Xem Windows Event Log, kiểm tra .env                 |
| Job stuck ở "claimed" quá lâu      | Kiểm tra advinst.exe path, kiểm tra license          |
| Clone fail                         | Kiểm tra GIT_TOKEN, kiểm tra network                 |
| Upload fail                        | Kiểm tra credentials từng adapter trong .env          |
| Firebase connection fail           | Kiểm tra FIREBASE_SERVICE_ACCOUNT_KEY format         |
| advinst.exe not found              | Set ADVINST_EXE_PATH trong .env                      |
