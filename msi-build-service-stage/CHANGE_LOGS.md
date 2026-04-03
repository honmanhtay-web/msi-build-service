# Path: msi-build-service/CHANGE_LOGS.md
# Purpose: Lịch sử thay đổi kỹ thuật (dev-facing) — entry mới nhất ở đầu file

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

### Notes
- Pipeline đầy đủ: `pending` → `claimed` → `building` → `done`/`failed`
- Tất cả secrets vẫn qua `.env` — không có gì hard-code
- Phase tiếp theo: scripts test (`test-firebase-connection.js`, `test-simulate-job.js`, etc.)

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

### Decisions
- Dùng Firebase Transaction để claim job, tránh race condition multi-machine
- Dùng `Promise.allSettled` cho upload song song — 1 target fail không block target khác
- Git shallow clone `--depth=1 --filter=blob:none` cho incremental fetch hiệu quả
- Adapter pattern cho upload — thêm target mới không sửa code cũ
- Cleanup TTL chạy mỗi 60 phút tại mỗi service instance — không cần service riêng
- Refactor `oAdvBuild.js` và `oAssembly.js` thành modules độc lập, bỏ hard-code path và internal deps

### Notes
- Phase này chỉ là thiết kế và tài liệu — chưa có code thực thi
- Phase tiếp theo: implement từng module theo thứ tự trong DEPLOYMENT.md mục 6
