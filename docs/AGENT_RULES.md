# Path: msi-build-service/docs/AGENT_RULES.md
# Purpose: Quy tắc bắt buộc cho AI agent khi làm việc với dự án msi-build-service
# Author: System Design Document
# Last Updated: 2026-04-03

# AGENT_RULES — Quy Tắc Bắt Buộc Cho AI Agent

> Đây là tài liệu ràng buộc. Agent PHẢI đọc file này trước khi thực hiện bất kỳ task nào
> trong dự án msi-build-service. Mọi hành động phải tuân theo các quy tắc dưới đây.

---

## 1. QUY TẮC LÀM VIỆC VỚI OWNER

### 1.1 Thực Hiện File — Show Ngay, Không Gộp
- Sau khi tạo xong MỖI file, PHẢI `present_files` ngay lập tức cho owner xem
- KHÔNG được tạo nhiều file rồi mới present cuối cùng
- KHÔNG được hỏi "bạn có muốn xem file không" — cứ present ngay

### 1.2 Header Comment Bắt Buộc Trong Mỗi File
Mỗi file tạo ra PHẢI có block comment ở đầu theo đúng format sau:

**JavaScript/Node.js:**
```javascript
// Path: src/firebase/FirebaseListener.js
// Purpose: [Mô tả ngắn gọn mục đích file này làm gì]
// Dependencies: [Các module chính file này import]
// Last Updated: YYYY-MM-DD
```

**Markdown:**
```markdown
# Path: docs/ARCHITECTURE.md
# Purpose: [Mô tả ngắn gọn]
# Last Updated: YYYY-MM-DD
```

**JSON:**
```json
{
  "_path": "config/service.config.json",
  "_purpose": "Config tĩnh cho service: advinst, upload targets, TTL"
}
```

**PowerShell:**
```powershell
# Path: scripts/setup.ps1
# Purpose: [Mô tả]
# Last Updated: YYYY-MM-DD
```

### 1.3 Khi Hoàn Thành Task
Sau khi hoàn thành toàn bộ task, PHẢI thực hiện theo thứ tự:

1. **Cập nhật `.opushforce.message`** — Ghi nội dung PR/release message mới nhất
2. **Append lên đầu `CHANGE_LOGS.md`** — Ghi nhận thay đổi kỹ thuật (dev-facing)
3. **Append lên đầu `CHANGE_LOGS_USER.md`** — Ghi nhận thay đổi (user-facing)
4. **Zip toàn bộ output** — Đúng đường dẫn trong zip, KHÔNG có ký tự `{}` trong path
5. **Present file zip** cho owner

### 1.4 Format Zip
- Zip phải giữ đúng cấu trúc thư mục bên trong
- Tên file zip: `msi-build-service-{YYYYMMDD}-{task-slug}.zip`
  - Ví dụ: `msi-build-service-20260403-init-design.zip`
- KHÔNG dùng ký tự `{`, `}` trong đường dẫn bên trong zip
- KHÔNG flatten thư mục — giữ nguyên nested structure

---

## 2. QUY TẮC CODE

### 2.1 Không Hard-code Path Tuyệt Đối
```javascript
// ❌ CẤM TUYỆT ĐỐI
const path = "E:/CLOUDCODE/github.com/...";
const advPath = "C:/Program Files (x86)/Caphyon/advinst.exe";

// ✅ BẮT BUỘC
const path = process.env.SOME_PATH || config.somePath;
const advPath = ConfigResolver.detectAdvinstExe(); // tự dò theo thứ tự ưu tiên
```

### 2.2 Không Dùng Internal Modules Không Tồn Tại
```javascript
// ❌ CẤM — đây là internal module không có trên npm
const rJS = require("E:/CLOUDCODE/.../rJS.js");
const rNode = require("E:/CLOUDCODE/.../rNode.js");

// ✅ THAY THẾ bằng standard Node.js hoặc npm packages
const fs = require("fs");
const path = require("path");
```

### 2.3 Biến Môi Trường — Prefix Quy Định
| Prefix       | Dùng cho                   | Ví dụ                          |
|--------------|----------------------------|--------------------------------|
| `FIREBASE_`  | Firebase config            | `FIREBASE_DATABASE_URL`        |
| `ADVINST_`   | Advanced Installer         | `ADVINST_EXE_PATH`             |
| `GIT_`       | Git credentials            | `GIT_TOKEN`, `GIT_USERNAME`    |
| `UPLOAD_`    | Upload target config       | `UPLOAD_S3_BUCKET`             |
| `BUILD_`     | Build behavior             | `BUILD_MAX_CONCURRENT`         |
| `CLEANUP_`   | Cleanup TTL                | `CLEANUP_DONE_DAYS`            |
| `SERVICE_`   | Service identity           | `SERVICE_MACHINE_ID`           |

### 2.4 Adapter Pattern — Bắt Buộc Implement BaseAdapter
Mọi upload adapter PHẢI kế thừa `BaseAdapter` và implement đúng 3 method:
```javascript
getName()                        // → string
async checkExists(msiFileName)   // → boolean
async upload(msiFilePath, meta)  // → { url, size, uploadedAt }
```

### 2.5 Error Handling — Không Throw Raw
```javascript
// ❌ SAI
throw error;

// ✅ ĐÚNG — wrap với context
throw new Error(`[AdvinstBuilder] Build failed at step SetVersion: ${error.message}`);
```

### 2.6 Log Phải Có Context
```javascript
// ❌ Thiếu context
logger.info("Build started");

// ✅ Đủ context
logger.info(`[${machineId}][${repoId}][${pushId}] Build started`);
```

---

## 3. QUY TẮC FIREBASE

### 3.1 Claim Job — Bắt Buộc Dùng Transaction
- KHÔNG dùng `set()` hoặc `update()` trực tiếp để claim job
- BẮT BUỘC dùng Firebase `runTransaction()` để claim
- Nếu transaction fail → log warning → bỏ qua job (đừng retry ngay)

### 3.2 Update Status — Đúng Path
- Mọi update lên Firebase phải đi qua `StatusReporter`
- KHÔNG được gọi Firebase ref trực tiếp từ module khác ngoài `firebase/`

### 3.3 Cleanup — Dùng Transaction Khi Xóa
- Khi cleanup xóa hoặc reset record → dùng transaction
- Log rõ số record đã xóa/reset mỗi lần cleanup

---

## 4. QUY TẮC GIT / CLONE

### 4.1 Shallow Clone — Bắt Buộc
```bash
# Clone lần đầu — BẮT BUỘC dùng --depth=1 --filter=blob:none
git clone --depth=1 --filter=blob:none --no-checkout {repoUrl} {workDir}
git -C {workDir} sparse-checkout set .
git -C {workDir} checkout

# Lần sau — BẮT BUỘC incremental
git -C {workDir} fetch origin --depth=1
git -C {workDir} reset --hard origin/{branch}
```

### 4.2 Xử Lý Corrupt Cache
- Nếu git command fail → thử xóa `.work-dirs/{repoId}/` → clone lại từ đầu
- Chỉ retry 1 lần — nếu vẫn fail thì set job = `failed`

---

## 5. QUY TẮC BUILD ADVINST

### 5.1 Thứ Tự Detect advinst.exe
```
1. ENV: ADVINST_EXE_PATH
2. config/service.config.json → advinstexePath
3. Scan thư mục hiện tại (process.cwd())
4. Scan thư mục cha
5. Hard paths mặc định (chỉ là fallback cuối)
```

### 5.2 Timeout — Bắt Buộc
- Mọi lần spawn `advinst.exe` PHẢI có timeout
- Default: `BUILD_TIMEOUT_SECONDS` env hoặc 120 giây
- Khi timeout: kill process → log → throw error

### 5.3 Command File — Không Append Trực Tiếp Vào .aip
- KHÔNG sửa file `.aip` gốc
- BẮT BUỘC clone file `.aip` ra thư mục build tạm trước
- Chỉ sửa file `.aip` clone

---

## 6. QUY TẮC UPLOAD

### 6.1 Check Trước Khi Upload
- Mỗi adapter PHẢI gọi `checkExists()` trước khi upload
- Nếu đã tồn tại → log → update Firebase `status: "skipped"` → không upload lại

### 6.2 Parallel — Dùng allSettled
```javascript
// ✅ BẮT BUỘC
const results = await Promise.allSettled(adapters.map(a => a.upload(...)));

// ❌ CẤM — 1 cái fail làm dừng tất cả
const results = await Promise.all(adapters.map(a => a.upload(...)));
```

### 6.3 Update Firebase Ngay Khi Từng Adapter Xong
- KHÔNG đợi tất cả adapter xong mới update Firebase
- Mỗi adapter xong → gọi `statusReporter.updateUpload(adapterName, result)` ngay

---

## 7. QUY TẮC THÊM ADAPTER MỚI

Khi thêm upload adapter mới (ví dụ `FtpAdapter.js`):

1. Tạo file `src/upload/adapters/FtpAdapter.js`
2. Kế thừa `BaseAdapter`
3. Implement đủ 3 method: `getName()`, `checkExists()`, `upload()`
4. Thêm env vars với prefix `UPLOAD_FTP_`
5. Đăng ký adapter trong `UploadManager.js`
6. Thêm section vào `config/service.config.json`
7. Cập nhật `.env.example`
8. Cập nhật `docs/DEPLOYMENT.md`
9. KHÔNG cần sửa bất kỳ file nào khác

---

## 8. CẤU TRÚC FILE BẮT BUỘC ĐỌC TRƯỚC KHI LÀM

Trước khi thực hiện bất kỳ task nào, agent PHẢI đọc:
1. `docs/ARCHITECTURE.md` — hiểu tổng thể luồng
2. `docs/PROJECT_STRUCTURE.md` — biết file nào nằm đâu, làm gì
3. `docs/AGENT_RULES.md` — file này, nắm rõ ràng buộc
4. `docs/FIREBASE_SCHEMA.md` — nếu task liên quan Firebase
5. `docs/DEPLOYMENT.md` — nếu task liên quan deploy

---

## 9. CHECKLIST TRƯỚC KHI SUBMIT

Agent PHẢI tự kiểm tra trước khi submit kết quả:

- [ ] Mỗi file có header comment đúng format?
- [ ] Không có hard-code absolute path?
- [ ] Không import module nội bộ không tồn tại (`rJS`, `rNode`)?
- [ ] Biến môi trường đặt tên đúng prefix?
- [ ] Upload adapter implement đủ `BaseAdapter` interface?
- [ ] Có gọi `present_files` ngay sau mỗi file?
- [ ] Đã cập nhật `.opushforce.message`?
- [ ] Đã append vào `CHANGE_LOGS.md`?
- [ ] Đã append vào `CHANGE_LOGS_USER.md`?
- [ ] File zip đúng cấu trúc, không có `{}` trong path?
