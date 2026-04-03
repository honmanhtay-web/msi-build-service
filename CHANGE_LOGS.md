# Path: msi-build-service/CHANGE_LOGS.md
# Purpose: Lịch sử thay đổi kỹ thuật (dev-facing) — entry mới nhất ở đầu file

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
