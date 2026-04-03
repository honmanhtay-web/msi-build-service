# Path: msi-build-service/CHANGE_LOGS.md

# Purpose: Lịch sử thay đổi kỹ thuật (dev-facing) — entry mới nhất ở đầu file

---

## [2026-04-03] — Phase 6: Bug fixes, missing features và file thiếu

### Fixed — Bugs

- **`src/advinst/AdvinstBuilder.js`**: `const fs = require("path")` sai → sửa thành `require("fs")`; thống nhất dùng tên `fs` thay vì `fss` cho module fs
- **`scripts/test-advinst-build.js`**: `const { ConfigResolver } = require(...)` sai (named destructuring) → sửa thành `const ConfigResolver = require(...)` vì module export class trực tiếp; không phải named export
- **`src/git/CloneManager.js`**: Fetch incremental không inject auth token → thêm `_setRemoteUrl()` cập nhật `remote origin` URL (có token mới) trước mỗi lần `git fetch`; comment trong code nói sẽ làm nhưng không implement

### Added — Missing features

- **`src/upload/UploadManager.checkAllExist(msiFileName)`**: Method mới kiểm tra tất cả enabled adapters, trả về `true` nếu TẤT CẢ đều có file. Dùng `Promise.all` với catch individual — 1 adapter lỗi không block các adapter khác, coi như "chưa có" để an toàn
- **`src/upload/UploadManager.uploadAll()`**: Thêm return value `{ allSkipped: boolean }` để caller biết kết quả tổng thể
- **`src/index.js` — Pre-build skip check**: Implement đúng theo `ARCHITECTURE.md` mục 3.2 — sau clone, resolve tentative config, gọi `checkAllExist()`. Nếu tất cả targets đã có file → `setSkipped()` và return sớm, không build lại. Nếu resolve fail (chưa có advinst.exe, adapter chưa config) → log warn và tiếp tục build bình thường
- **`src/index.js` — Post-upload allSkipped check**: Sau `uploadAll`, nếu tất cả uploads đều `skipped` (file đã có khi bắt đầu upload) → `setSkipped()` thay vì `setDone()`; giải quyết edge case race condition giữa pre-build check và lúc upload thật sự

### Added — Missing files

- **`config/service.config.json`**: File tồn tại trong documents nhưng đặt sai path (`src/utils/config/` và root). `src/index.js` require tại `../config/service.config.json` (= `config/service.config.json`). File đã được tạo đúng đường dẫn
- **`.aip.json.example`**: File config per-project mà `ConfigResolver` tìm kiếm trong repo của từng app cần build. Không có file mẫu nào → developer không biết cần đặt gì. File example đã được tạo với đầy đủ comments giải thích từng field
- **`.env.example`**: Bổ sung `GIT_WORK_DIRS_ROOT` và `BUILD_OUTPUT_DIR` còn thiếu — cả hai được `CloneManager` và `AdvinstBuilder` đọc từ env nhưng không có trong example

### Notes

- Pre-build skip check dùng tentative filename (không có assemblyMeta) — chính xác 100% nếu project đặt `msiFileName` cố định trong `.aip.json`; có thể miss nếu filename chứa version động từ exe. Đây là trade-off chấp nhận được vì trường hợp worst case chỉ là build thêm 1 lần, sau đó `uploadAll` sẽ skip tất cả và đặt status `skipped`
- `ConfigResolver` vẫn export trực tiếp `module.exports = ConfigResolver` (không phải named export) — nhất quán với tất cả module khác trong codebase

---

## [2026-04-03] — Phase 5: Test scripts và Windows service installer

### Added

#### Scripts — Test

- `scripts/test-firebase-connection.js` — Kiểm tra env vars, parse service account, init Firebase, test read/write/delete build-queue; exit 0 nếu pass
- `scripts/test-simulate-job.js` — Tạo job `pending` trên Firebase qua CLI (`--repoId`, `--repoUrl`, `--branch`, `--commitSha`); poll real-time qua `onValue()` đợi đến `done`/`failed`/`skipped`; in kết quả từng upload target; timeout 10 phút
- `scripts/test-clone.js` — Test `CloneManager` độc lập; verify `.git` folder, đếm files, in HEAD commit SHA
- `scripts/test-advinst-build.js` — Test `AdvinstBuilder` độc lập; verify `advinst.exe` trước khi chạy; in `version`/`msiFileName`/`msiFilePath`/size/assemblyMeta
- `scripts/test-upload.js` — Test từng adapter: `checkExists` → `upload` → `checkExists` lại; tự tạo file MSI giả 1MB nếu không có `--msiPath`; filter adapter qua `--adapter` hoặc test tất cả enabled

#### Scripts — Windows Service

- `scripts/install-windows-service.js` — Đăng ký `MsiBuildService` qua `node-windows`; auto-start khi Windows boot; restart policy max 5 lần với exponential backoff
- `scripts/uninstall-windows-service.js` — Stop service rồi uninstall sạch

### Notes

- Tất cả scripts đều dùng color-coded output: xanh = OK, đỏ = FAIL, vàng = WARN, cyan = INFO
- Scripts test dùng `process.exit(0/1)` để CI/CD có thể detect kết quả
- `install-windows-service.js` phải chạy với quyền Administrator

---

## [2026-04-03] — Phase 2-4: Implement build pipeline đầy đủ

### Added

#### Phase 2 — Git

- `src/git/CloneManager.js` — Shallow clone `--depth=1 --filter=blob:none` lần đầu; incremental fetch + reset lần sau; auto-wipe & re-clone khi corrupt; inject `GIT_TOKEN` vào URL, redact khỏi log

#### Phase 3 — Assembly & Advinst

- `src/assembly/AssemblyReader.js` — Đọc `fileVersion`, `productVersion`, `productName`, `sha256` từ `.exe` qua PowerShell inline script; auto-detect `pwsh` vs `powershell.exe`
- `src/advinst/ConfigResolver.js` — Merge config ENV → `.aip.json` → `service.config.json` → defaults; 4-level priority detect `advinst.exe`; auto-detect `MainExe` theo convention thư mục
- `src/advinst/CommandFileGenerator.js` — Pure function sinh command file `.txt` cho `advinst.exe /execute`; không side effect, dễ unit test
- `src/advinst/AdvinstBuilder.js` — Orchestrate: resolve config → clone `.aip` → gen command file → spawn `advinst.exe` → find `.msi` output; timeout + kill (`BUILD_TIMEOUT_SECONDS`)

#### Phase 4 — Upload

- `src/upload/adapters/BaseAdapter.js` — Abstract class: `getName()`, `checkExists()`, `upload()`; helper `_log()`, `_wrap()`
- `src/upload/adapters/S3Adapter.js` — AWS S3 multipart upload `@aws-sdk/lib-storage`; hỗ trợ S3-compatible qua `UPLOAD_S3_ENDPOINT`; `HeadObject` để checkExists
- `src/upload/adapters/OneDriveAdapter.js` — Graph API client credentials flow; small file PUT ≤4MB; large file resumable upload session (chunk 10MB)
- `src/upload/adapters/GoogleDriveAdapter.js` — `googleapis` Service Account JWT; `files.list` để checkExists; `files.create` multipart upload
- `src/upload/adapters/SynologyAdapter.js` — DSM File Station API; login → SID token → upload FormData → logout; hỗ trợ file lớn qua axios `maxContentLength: Infinity`
- `src/upload/UploadManager.js` — `Promise.allSettled` song song; `checkExists()` trước upload; update Firebase ngay từng adapter

#### Entry Point

- `src/index.js` — Wire đầy đủ `runBuildPipeline()`: `CloneManager` → `AdvinstBuilder` → `UploadManager` → `setDone`; xóa placeholder warning

### Decisions

- `CommandFileGenerator` là pure function để dễ test độc lập với filesystem
- `AdvinstBuilder` clone file `.aip` vào `buildTmpDir` trước khi modify — không bao giờ sửa file gốc trong repo
- `UploadManager._buildAdapters()` đọc enable flag từ ENV trước, config file sau — ENV luôn override
- `SynologyAdapter` dùng login/logout mỗi lần upload thay vì giữ session — đơn giản hơn, tránh session timeout
- `OneDriveAdapter` tự phân nhánh small/large upload dựa trên file size 4MB threshold của Graph API

---

## [2026-04-03] — Init: Thiết kế kiến trúc và tài liệu hệ thống

### Added

- `docs/ARCHITECTURE.md` — Kiến trúc tổng thể: luồng trigger → clone → build → upload
- `docs/PROJECT_STRUCTURE.md` — Cấu trúc thư mục, quy tắc đặt tên, trách nhiệm từng module
- `docs/AGENT_RULES.md` — Ràng buộc cho AI agent: present_files, header comment, không hard-code
- `docs/FIREBASE_SCHEMA.md` — Schema Firebase Realtime DB, TTL rules, transaction claim
- `docs/DEPLOYMENT.md` — Hướng dẫn triển khai: self-host, GitHub runner, Azure agent
- `.env.example` — Mẫu đầy đủ tất cả env vars có prefix chuẩn
- `package.json` — Dependencies: firebase-admin, AWS SDK v3, Graph API, googleapis, axios
- `.gitignore` — Loại trừ .env, .work-dirs, .oAdvBuild, logs
