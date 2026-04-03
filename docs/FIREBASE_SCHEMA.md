# Path: msi-build-service/docs/FIREBASE_SCHEMA.md
# Purpose: Mô tả chi tiết schema Firebase Realtime DB, trạng thái job, và TTL rules
# Author: System Design Document
# Last Updated: 2026-04-03

# FIREBASE_SCHEMA — Schema Firebase Realtime DB

## 1. Cấu Trúc Node Tổng Thể

```
/build-queue/
  {repoId}/
    {pushId}/
      [xem mục 2]
```

- `repoId`: Định danh repo, ví dụ `dh-hospital-pharmacy`, `dh-hospital-warehouse`
  - Quy tắc đặt tên: `kebab-case`, không dấu, không ký tự đặc biệt
  - Nên map 1-1 với tên repo GitHub (bỏ prefix org nếu cần)
- `pushId`: Định danh của lần push, ví dụ `20260403-143022-abc123`
  - Format: `{yyyyMMdd}-{HHmmss}-{commitSha[0..6]}`
  - Đảm bảo unique per repo

## 2. Schema Chi Tiết Một Job Record

```json
{
  "status": "pending",
  "claimedBy": "",
  "claimedAt": 0,
  "createdAt": 1743686400000,

  "payload": {
    "repoUrl":      "https://github.com/org/repo-name",
    "branch":       "main",
    "commitSha":    "abc123def456",
    "triggeredAt":  1743686400000
  },

  "result": {
    "version":     "",
    "msiFileName": "",
    "startAt":     0,
    "endAt":       0,
    "errorMessage": "",
    "uploads": {
      "onedrive": {
        "status":     "pending",
        "url":        "",
        "error":      "",
        "doneAt":     0
      },
      "s3": {
        "status":     "pending",
        "url":        "",
        "error":      "",
        "doneAt":     0
      },
      "gdrive": {
        "status":     "pending",
        "url":        "",
        "error":      "",
        "doneAt":     0
      },
      "nas": {
        "status":     "pending",
        "url":        "",
        "error":      "",
        "doneAt":     0
      }
    }
  }
}
```

## 3. Các Trạng Thái Job (status)

| Status       | Ý nghĩa                                                              | Ai set          |
|--------------|----------------------------------------------------------------------|-----------------|
| `pending`    | Chờ xử lý, chưa có service nào claim                                | Webhook receiver|
| `claimed`    | Đã có service claim, chuẩn bị build                                 | JobClaimer      |
| `building`   | Đang chạy advinst.exe                                               | AdvinstBuilder  |
| `done`       | Build xong, tất cả upload hoàn tất (kể cả skipped)                  | StatusReporter  |
| `failed`     | Có lỗi không thể tiếp tục (build fail hoặc tất cả upload đều fail) | StatusReporter  |
| `skipped`    | File MSI đã tồn tại trên tất cả targets, không cần build lại        | StatusReporter  |

## 4. Các Trạng Thái Upload (result.uploads.{target}.status)

| Status     | Ý nghĩa                                           |
|------------|---------------------------------------------------|
| `pending`  | Chưa xử lý                                        |
| `done`     | Upload thành công                                 |
| `skipped`  | File đã tồn tại trên target, không upload lại     |
| `failed`   | Upload thất bại, xem field `error` để biết lý do |

## 5. TTL Rules — Cleanup

```
┌─────────────────────────────────────────────────────────────────┐
│ status = "done" hoặc "skipped"                                  │
│   → createdAt < NOW - CLEANUP_DONE_DAYS (default: 7 ngày)      │
│   → Hành động: XÓA record                                       │
├─────────────────────────────────────────────────────────────────┤
│ status = "failed"                                               │
│   → createdAt < NOW - CLEANUP_FAILED_DAYS (default: 7 ngày)    │
│   → Hành động: XÓA record                                       │
├─────────────────────────────────────────────────────────────────┤
│ status = "pending"                                              │
│   → createdAt < NOW - CLEANUP_PENDING_DAYS (default: 30 ngày)  │
│   → Hành động: XÓA record (stale, không ai xử lý)              │
│   → createdAt >= NOW - 30 ngày → GIỮ LẠI                       │
├─────────────────────────────────────────────────────────────────┤
│ status = "claimed" hoặc "building"                              │
│   → claimedAt < NOW - CLEANUP_STUCK_HOURS (default: 2 giờ)     │
│   → Hành động: RESET về "pending" (service crash giữa chừng)   │
│   → Xóa claimedBy, claimedAt                                    │
└─────────────────────────────────────────────────────────────────┘
```

## 6. Firebase Transaction — Claim Job

Logic transaction khi claim job:

```javascript
// Pseudo-code của JobClaimer.js
await ref.transaction((currentData) => {
  if (currentData === null) return; // abort — record không tồn tại
  if (currentData.status !== "pending") return; // abort — đã bị claim bởi service khác
  return {
    ...currentData,
    status: "claimed",
    claimedBy: machineId,
    claimedAt: Date.now(),
  };
});
// Nếu transaction commit → claim thành công
// Nếu transaction abort (return undefined) → bỏ qua job này
```

## 7. Security Rules Gợi Ý (Firebase Rules)

```json
{
  "rules": {
    "build-queue": {
      "$repoId": {
        "$pushId": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    }
  }
}
```

> **Lưu ý:** Build service authenticate với Firebase bằng Service Account (Admin SDK).
> Không dùng anonymous auth cho service.

## 8. Env Vars Liên Quan Firebase

| Env Var                        | Bắt buộc | Mô tả                                           |
|-------------------------------|----------|-------------------------------------------------|
| `FIREBASE_DATABASE_URL`        | ✅        | URL Firebase Realtime DB                        |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | ✅        | JSON string của service account key             |
| `FIREBASE_BUILD_QUEUE_PATH`    | ❌        | Path gốc, default: `build-queue`                |
| `CLEANUP_DONE_DAYS`            | ❌        | TTL cho done/skipped, default: `7`              |
| `CLEANUP_FAILED_DAYS`          | ❌        | TTL cho failed, default: `7`                    |
| `CLEANUP_PENDING_DAYS`         | ❌        | TTL cho pending stale, default: `30`            |
| `CLEANUP_STUCK_HOURS`          | ❌        | Giờ trước khi reset claimed/building, default: `2` |
| `CLEANUP_INTERVAL_MINUTES`     | ❌        | Tần suất cleanup, default: `60`                 |
