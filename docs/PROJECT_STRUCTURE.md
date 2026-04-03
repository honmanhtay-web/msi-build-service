# Path: msi-build-service/docs/PROJECT_STRUCTURE.md
# Purpose: Mô tả cấu trúc thư mục, quy tắc đặt tên file, và trách nhiệm từng module
# Author: System Design Document
# Last Updated: 2026-04-03

# MSI Build Service — Cấu Trúc Dự Án & Quy Tắc Đặt Tên

## 1. Cấu Trúc Thư Mục Đầy Đủ

```
msi-build-service/
│
├── src/                                    ← Toàn bộ source code
│   │
│   ├── index.js                            ← Entry point: khởi động service, wire modules
│   │
│   ├── firebase/                           ← Tương tác Firebase Realtime DB
│   │   ├── FirebaseListener.js             ← onValue(), filter job pending
│   │   ├── JobClaimer.js                   ← Transaction claim job, tránh race condition
│   │   └── StatusReporter.js              ← Update status, result, uploads lên Firebase
│   │
│   ├── cleanup/                            ← Dọn dẹp dữ liệu cũ trên Firebase
│   │   └── DbCleanup.js                   ← TTL rules, chạy định kỳ mỗi 1 giờ
│   │
│   ├── queue/                              ← Quản lý concurrent build trên 1 máy
│   │   └── JobQueue.js                    ← Giới hạn số job chạy đồng thời per instance
│   │
│   ├── git/                               ← Clone và sync repo
│   │   └── CloneManager.js               ← Shallow clone lần đầu, incremental fetch lần sau
│   │
│   ├── assembly/                          ← Đọc metadata từ file .exe
│   │   └── AssemblyReader.js             ← Refactor từ oAssembly.js, dùng PowerShell/.NET
│   │
│   ├── advinst/                           ← Build MSI bằng Advanced Installer
│   │   ├── AdvinstBuilder.js             ← Orchestrate toàn bộ luồng build, refactor oAdvBuild.js
│   │   ├── CommandFileGenerator.js       ← Sinh file .txt command cho advinst.exe
│   │   └── ConfigResolver.js            ← Merge config, detect MainExe, detect advinst.exe path
│   │
│   ├── upload/                           ← Upload MSI lên các storage targets
│   │   ├── UploadManager.js             ← Chạy allSettled, update Firebase từng adapter
│   │   └── adapters/                    ← Mỗi adapter là 1 file độc lập
│   │       ├── BaseAdapter.js           ← Abstract class: checkExists(), upload(), getName()
│   │       ├── OneDriveAdapter.js       ← Upload lên Microsoft OneDrive
│   │       ├── GoogleDriveAdapter.js    ← Upload lên Google Drive
│   │       ├── S3Adapter.js             ← Upload lên AWS S3 hoặc S3-compatible
│   │       └── SynologyAdapter.js      ← Upload lên NAS Synology qua WebDAV/API
│   │
│   └── utils/                           ← Tiện ích dùng chung
│       ├── logger.js                    ← Structured log, ghi file + console, có timestamp
│       ├── machineId.js                 ← Tạo unique ID: hostname:pid để identify service
│       └── pathUtils.js                ← Resolve path an toàn, không hard-code
│
├── config/
│   └── service.config.json             ← Config tĩnh: advinst path, upload targets, TTL
│
├── docs/                               ← Tài liệu thiết kế (thư mục này)
│   ├── ARCHITECTURE.md                 ← Kiến trúc tổng thể
│   ├── PROJECT_STRUCTURE.md            ← File này
│   ├── AGENT_RULES.md                  ← Quy tắc cho AI agent khi làm việc với dự án
│   ├── FIREBASE_SCHEMA.md              ← Schema Firebase chi tiết
│   └── DEPLOYMENT.md                  ← Hướng dẫn deploy từng bước
│
├── .work-dirs/                         ← Clone cache (gitignore)
│   └── {repoId}/                      ← Mỗi repo giữ nguyên giữa các lần build
│
├── .oAdvBuild/                         ← Build output tạm (gitignore)
│
├── .env.example                        ← Mẫu biến môi trường
├── .env                                ← Biến môi trường thực (gitignore)
├── .gitignore
├── package.json
├── .opushforce.message                 ← Thông điệp push/release mới nhất
├── CHANGE_LOGS.md                     ← Lịch sử thay đổi kỹ thuật (dev-facing)
├── CHANGE_LOGS_USER.md                ← Lịch sử thay đổi (user-facing)
└── README.md                          ← Hướng dẫn nhanh
```

## 2. Quy Tắc Đặt Tên File

### 2.1 Source Files (src/)
| Loại             | Quy tắc           | Ví dụ                    |
|------------------|-------------------|--------------------------|
| Class/Module chính | PascalCase       | `FirebaseListener.js`    |
| Utility/Helper   | camelCase         | `logger.js`, `pathUtils.js` |
| Config/Schema    | kebab-case        | `service.config.json`    |
| Entry point      | lowercase         | `index.js`               |

### 2.2 Thư Mục (src/)
| Quy tắc    | Ví dụ                                     |
|------------|-------------------------------------------|
| lowercase  | `firebase/`, `advinst/`, `upload/`        |
| Danh từ số ít khi là nhóm chức năng | `queue/`, `git/`, `assembly/` |

### 2.3 Docs
| Quy tắc        | Ví dụ                   |
|----------------|-------------------------|
| UPPER_SNAKE    | `ARCHITECTURE.md`       |
| Mô tả rõ mục đích | `DEPLOYMENT.md`      |

### 2.4 Config & Env
| File                   | Mục đích                                       |
|------------------------|------------------------------------------------|
| `.env`                 | Secrets và biến môi trường thực, không commit  |
| `.env.example`         | Mẫu, commit vào git                            |
| `config/service.config.json` | Config tĩnh không phải secret, commit được |

## 3. Quy Tắc Viết Code

### 3.1 Mỗi File Phải Có Header Comment
```javascript
// Path: src/firebase/FirebaseListener.js
// Purpose: Lắng nghe Firebase Realtime DB, phát hiện job pending mới
// Dependencies: firebase-admin, JobClaimer, logger
// Last Updated: YYYY-MM-DD
```

### 3.2 Không Hard-code Path
```javascript
// ❌ SAI
const advinstPath = "C:/Program Files (x86)/Caphyon/advinst.exe";

// ✅ ĐÚNG
const advinstPath = process.env.ADVINST_EXE_PATH
  || config.advinstexePath
  || ConfigResolver.autoDetect();
```

### 3.3 Biến Môi Trường — Đặt Tên
| Prefix      | Dùng cho                     | Ví dụ                           |
|-------------|------------------------------|---------------------------------|
| `FIREBASE_` | Firebase config              | `FIREBASE_DATABASE_URL`         |
| `ADVINST_`  | Advanced Installer           | `ADVINST_EXE_PATH`              |
| `GIT_`      | Git credentials              | `GIT_TOKEN`, `GIT_USERNAME`     |
| `UPLOAD_`   | Upload target config         | `UPLOAD_S3_BUCKET`              |
| `BUILD_`    | Build behavior               | `BUILD_MAX_CONCURRENT`          |
| `CLEANUP_`  | Cleanup TTL config           | `CLEANUP_DONE_DAYS`             |
| `SERVICE_`  | Service identity             | `SERVICE_MACHINE_ID`            |

### 3.4 Adapter Pattern — Upload
Mỗi adapter PHẢI implement đúng interface từ `BaseAdapter.js`:
```javascript
class BaseAdapter {
  getName()                          // → string: tên hiển thị trong log/Firebase
  async checkExists(msiFileName)     // → boolean: file đã có trên target chưa
  async upload(msiFilePath, meta)    // → { url, size, uploadedAt }
}
```

### 3.5 Error Handling
- Không throw raw error ra ngoài module — wrap với context
- Log đủ thông tin: machineId, repoId, pushId, step đang chạy
- Phân biệt: lỗi có thể retry vs lỗi không thể retry

## 4. Trách Nhiệm Từng Module

### FirebaseListener.js
- Subscribe `onValue` vào `/build-queue`
- Chỉ xử lý record có `status === "pending"`
- Không tự claim — gọi `JobClaimer`
- Không tự build — đẩy vào `JobQueue`

### JobClaimer.js
- Nhận `{ repoId, pushId, machineId }`
- Chạy Firebase transaction: nếu `status === "pending"` thì set `status = "claimed"`, `claimedBy`, `claimedAt`
- Trả về `true` nếu claim thành công, `false` nếu thua race

### StatusReporter.js
- Nhận repoId, pushId
- Cung cấp các method: `setBuilding()`, `setDone()`, `setFailed()`, `setSkipped()`, `updateUpload(target, result)`
- Tất cả đều ghi đúng path Firebase

### DbCleanup.js
- Chạy mỗi 1 giờ (setInterval)
- Đọc toàn bộ `/build-queue`
- Áp dụng TTL rules (xem ARCHITECTURE.md mục 3.5)
- Dùng transaction khi xóa/reset để tránh conflict với service khác

### CloneManager.js
- Nhận `{ repoUrl, branch, commitSha, workDir }`
- Tự phát hiện: thư mục đã có git repo chưa → fetch hoặc clone
- Nếu fetch thất bại → xóa cache → clone lại
- Trả về path thư mục đã checkout

### AssemblyReader.js
- Nhận path file `.exe`
- Sinh PowerShell script inline, chạy qua `child_process.exec`
- Parse JSON output → trả về object chuẩn
- Không phụ thuộc `rJS`, `rNode` — dùng standard Node.js

### ConfigResolver.js
- Merge config từ: ENV → `.aip.json` → defaults
- `detectMainExe(APPDIRFiles)`: scan tìm .exe nếu chưa có
- `detectAdvinstExe()`: theo thứ tự ENV → config → scan → hard paths

### CommandFileGenerator.js
- Nhận config đã resolve
- Sinh nội dung file `.txt` command cho advinst.exe
- Không có side effect — pure function, dễ test

### AdvinstBuilder.js
- Orchestrate: ConfigResolver → CommandFileGenerator → spawn advinst.exe
- Tạo thư mục build tạm
- Có timeout + kill process
- Tìm file .msi output → copy ra OutputPath

### UploadManager.js
- Nhận `{ msiFilePath, msiFileName, meta, adapters, statusReporter }`
- Với mỗi adapter: `checkExists()` trước → skip nếu có, upload nếu chưa
- Dùng `Promise.allSettled()` — không block
- Gọi `statusReporter.updateUpload()` ngay khi từng adapter xong

## 5. Flow Dữ Liệu Qua Các Module

```
FirebaseListener
    └─► JobQueue.enqueue(job)
            └─► JobClaimer.claim(job)           [Firebase Transaction]
                    └─► (nếu claim thành công)
                    └─► StatusReporter.setBuilding()
                    └─► CloneManager.syncRepo()
                    └─► AssemblyReader.read(exePath)
                    └─► AdvinstBuilder.build(config)
                            └─► ConfigResolver.resolve()
                            └─► CommandFileGenerator.generate()
                            └─► spawn advinst.exe
                    └─► UploadManager.uploadAll()
                            └─► adapter.checkExists()  [per adapter]
                            └─► adapter.upload()       [per adapter, parallel]
                            └─► StatusReporter.updateUpload()  [per adapter]
                    └─► StatusReporter.setDone() | setFailed()
```
