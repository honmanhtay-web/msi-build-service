// Path: scripts/install-windows-service.js
// Purpose: Đăng ký MSI Build Service như Windows Service dùng node-windows
// Dependencies: node-windows, path
// Last Updated: 2026-04-03
//
// Cách dùng (chạy với quyền Administrator):
//   node scripts/install-windows-service.js
//
// Sau khi cài:
//   - Service name: MsiBuildService
//   - Tự start khi Windows khởi động
//   - Log ra: logs/build-service-YYYY-MM-DD.log

"use strict";

const path    = require("path");
const { requestJson } = require("./mock/http-client");

const SERVICE_NAME        = "MsiBuildService";
const SERVICE_DESCRIPTION = "MSI Build Service — tự động build và upload MSI từ GitHub push (DHG Pharma)";
const PROJECT_ROOT        = path.resolve(__dirname, "..");
const ENTRY_POINT         = path.join(PROJECT_ROOT, "src", "index.js");

// Đọc env file để lấy MACHINE_ID (dùng làm display name)
let machineId = "build-machine";
try {
  const envContent = require("fs").readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
  const match = envContent.match(/^SERVICE_MACHINE_ID\s*=\s*(.+)$/m);
  if (match) machineId = match[1].trim();
} catch { /* .env có thể không tồn tại lúc chạy script */ }

console.log("=== MSI Build Service — Windows Service Installer ===\n");
console.log(`Project root:  ${PROJECT_ROOT}`);
console.log(`Entry point:   ${ENTRY_POINT}`);
console.log(`Service name:  ${SERVICE_NAME}`);
console.log(`Machine ID:    ${machineId}`);
console.log("");

const mockMode = process.env.MOCK_MODE === "true" || !!process.env.MOCK_SERVER_URL;
if (mockMode) {
  const baseUrl = process.env.MOCK_SERVER_URL || "http://127.0.0.1:4311";
  requestJson(baseUrl, "POST", "/service/install", { service: SERVICE_NAME })
    .then(() => {
      console.log("\x1b[32m[OK]\x1b[0m Mock service installed & started.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\x1b[31m[FAIL]\x1b[0m Mock service install error:", err.message);
      process.exit(1);
    });
  return;
}

const { Service } = require("node-windows");
const svc = new Service({
  name:        SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  script:      ENTRY_POINT,
  nodeOptions: [],
  workingDirectory: PROJECT_ROOT,

  // Biến môi trường inject vào service process
  // Thực tế sẽ đọc từ .env qua dotenv — không cần set thủ công ở đây
  // Nhưng NODE_ENV nên set để tránh nhầm môi trường
  env: [
    { name: "NODE_ENV", value: "production" },
  ],

  // Restart policy — tự restart nếu crash
  // node-windows default: restart sau 1 giây, tối đa 3 lần trong 1 phút
  maxRestarts: 5,
  wait:        2,   // giây giữa mỗi lần restart
  grow:        0.5, // tăng wait mỗi lần restart (exponential backoff)
  abortOnError: false,
});

// Handler khi install thành công
svc.on("install", () => {
  console.log("\x1b[32m[OK]\x1b[0m Service installed successfully.");
  console.log("\x1b[32m[OK]\x1b[0m Starting service...");
  svc.start();
});

svc.on("start", () => {
  console.log("\x1b[32m[OK]\x1b[0m Service started.");
  console.log("");
  console.log("Useful commands:");
  console.log("  nssm status MsiBuildService");
  console.log("  Get-Service MsiBuildService");
  console.log(`  Get-Content "${path.join(PROJECT_ROOT, "logs")}" -Wait -Tail 50`);
  process.exit(0);
});

svc.on("alreadyinstalled", () => {
  console.log("\x1b[33m[WARN]\x1b[0m Service is already installed.");
  console.log("To reinstall: node scripts/uninstall-windows-service.js && node scripts/install-windows-service.js");
  process.exit(0);
});

svc.on("error", (err) => {
  console.error("\x1b[31m[FAIL]\x1b[0m Service install error:", err);
  console.error("Make sure you are running this script as Administrator.");
  process.exit(1);
});

// Bắt đầu install
svc.install();
