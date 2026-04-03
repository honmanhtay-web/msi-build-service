# Path: msi-build-service/docs/ARCHITECTURE.md
# Purpose: Mô tả kiến trúc tổng thể hệ thống MSI Build Service
# Author: System Design Document
# Last Updated: 2026-04-03

# MSI Build Service — Kiến Trúc Tổng Thể

## 1. Tổng Quan

Hệ thống tự động lắng nghe sự kiện push code từ GitHub thông qua Firebase Realtime DB,
clone repo về máy Windows, build file MSI bằng Advanced Installer, rồi upload song song
lên nhiều storage target (OneDrive, Google Drive, S3, NAS Synology).

## 2. Luồng Hoạt Động

```
GitHub Repo
    │ push code
    ▼
GitHub Webhook  (đã có sẵn, ngoài scope dự án này)
    │ ghi JSON vào Firebase
    ▼
Firebase Realtime DB
    /build-queue/{repoId}/{pushId}
    { status: "pending", payload: { repoUrl, branch, commitSha } }
    │
    │ onValue() — mỗi service instance lắng nghe độc lập
    ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Service A   │   │  Service B   │   │  Service C   │
│  (máy #1)   │   │  (máy #2)   │   │  (máy #3)   │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       └──────────────────┼───────────────────┘
                          │ Firebase Transaction (ai claim trước thắng)
                          ▼
                    BuildJob thực thi:
                    1. CloneManager   — shallow clone / incremental fetch
                    2. AssemblyReader — đọc version/hash từ .exe qua PowerShell
                    3. AdvinstBuilder — sinh command file, spawn advinst.exe
                    4. UploadManager  — upload song song, báo từng cái xong
                          │
                          ▼
                    Firebase update status + result
```

## 3. Nguyên Tắc Thiết Kế

### 3.1 Claim Job — Tránh Race Condition
- Mỗi service instance có `machineId` = hostname + pid
- Dùng **Firebase Transaction** để claim job: chỉ 1 instance thắng, các instance khác bỏ qua
- Job có status `claimed` quá 2 giờ → coi là crash → reset về `pending` cho phép retry

### 3.2 Idempotency — Không Build Lại Nếu Đã Có
- Trước khi build, kiểm tra file MSI đã tồn tại trên TẤT CẢ upload targets chưa
- Nếu đã có hết → mark `skipped`, không build lại
- Từng upload adapter có method `checkExists()` độc lập

### 3.3 Upload Song Song — Độc Lập Từng Target
- Dùng `Promise.allSettled()` — 1 target fail không block các target khác
- Mỗi adapter tự update Firebase `result.uploads.{target}` ngay khi xong/fail
- Không retry upload trong cùng job (để job sau retry nếu cần)

### 3.4 Clone Incremental — Tối Ưu Hiệu Năng
- Lần đầu: `git clone --depth=1 --filter=blob:none --no-checkout` rồi sparse-checkout
- Lần sau: `git fetch --depth=1` + `git reset --hard origin/{branch}`
- Cache tại `.work-dirs/{repoId}/` — giữ nguyên giữa các lần build
- Nếu cache bị corrupt → detect lỗi → xóa → clone lại từ đầu

### 3.5 Cleanup Firebase DB — TTL Rules
| Trạng thái        | TTL                          | Hành động               |
|-------------------|------------------------------|-------------------------|
| `done`/`skipped`  | 7 ngày kể từ `createdAt`     | Xóa                     |
| `failed`          | 7 ngày kể từ `createdAt`     | Xóa (đã debug xong)     |
| `pending`         | 30 ngày kể từ `createdAt`    | Xóa (stale)             |
| `claimed/building`| 2 giờ kể từ `claimedAt`      | Reset về `pending`      |

- Mỗi service instance tự chạy cleanup mỗi 1 giờ
- Dùng Firebase transaction khi cleanup để tránh conflict

## 4. Firebase Data Structure

```
/build-queue/
  {repoId}/                         ← ví dụ: "dh-hospital-pharmacy"
    {pushId}/                       ← ví dụ: "20240403-abc123"
      status: "pending"             ← pending|claimed|building|done|failed|skipped
      claimedBy: ""                 ← machineId = hostname:pid
      claimedAt: 0                  ← timestamp ms
      createdAt: 0                  ← timestamp ms — dùng cho TTL
      payload:
        repoUrl:   "https://github.com/org/repo"
        branch:    "main"
        commitSha: "abc123def456"
        triggeredAt: 0
      result:
        version:     "1.2.3.4"
        msiFileName: "Setup-X.v1.2.3.4.msi"
        uploads:
          onedrive: { status: "done|failed|skipped", url: "", error: "", doneAt: 0 }
          s3:       { status: "done|failed|skipped", url: "", error: "", doneAt: 0 }
          gdrive:   { status: "done|failed|skipped", url: "", error: "", doneAt: 0 }
          nas:      { status: "done|failed|skipped", url: "", error: "", doneAt: 0 }
        startAt:      0
        endAt:        0
        errorMessage: ""
```

## 5. Ràng Buộc Kỹ Thuật

- **Windows only**: `advinst.exe` và .NET Assembly reflection chỉ chạy trên Windows
- **PowerShell**: cần `powershell.exe` hoặc `pwsh` để đọc metadata EXE
- **advinst.exe**: phải được cài sẵn trên máy host hoặc được chỉ định qua ENV
- **Node.js**: >= 18 LTS
- **Git**: phải có trong PATH để CloneManager hoạt động

## 6. Môi Trường Hỗ Trợ

| Môi trường                        | Hỗ trợ | Ghi chú                                  |
|-----------------------------------|--------|------------------------------------------|
| Self-hosted Windows               | ✅      | Tốt nhất, kiểm soát hoàn toàn           |
| GitHub self-hosted Windows runner | ✅      | Cần cài Node, Git, advinst.exe           |
| Azure self-hosted Windows agent   | ✅      | Tương tự trên                            |
| GitHub-hosted runner (windows)    | ⚠️      | Cần cài advinst.exe mỗi lần, chậm        |
| Azure hosted agent (windows)      | ⚠️      | Tương tự trên                            |
| Linux (bất kỳ)                    | ❌      | Không hỗ trợ, advinst.exe là Windows-only|
