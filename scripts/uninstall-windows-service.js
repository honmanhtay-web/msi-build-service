// Path: scripts/uninstall-windows-service.js
// Purpose: Gỡ cài đặt MsiBuildService khỏi Windows Services
// Dependencies: node-windows, path
// Last Updated: 2026-04-03
//
// Cách dùng (chạy với quyền Administrator):
//   node scripts/uninstall-windows-service.js

"use strict";

const path    = require("path");
const { Service } = require("node-windows");

const SERVICE_NAME = "MsiBuildService";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENTRY_POINT  = path.join(PROJECT_ROOT, "src", "index.js");

console.log("=== MSI Build Service — Windows Service Uninstaller ===\n");
console.log(`Service name: ${SERVICE_NAME}\n`);

const svc = new Service({
  name:   SERVICE_NAME,
  script: ENTRY_POINT,
  workingDirectory: PROJECT_ROOT,
});

svc.on("stop", () => {
  console.log("\x1b[32m[OK]\x1b[0m Service stopped. Uninstalling...");
  svc.uninstall();
});

svc.on("uninstall", () => {
  console.log("\x1b[32m[OK]\x1b[0m Service uninstalled successfully.");
  process.exit(0);
});

svc.on("notinstalled", () => {
  console.log("\x1b[33m[WARN]\x1b[0m Service is not installed — nothing to uninstall.");
  process.exit(0);
});

svc.on("error", (err) => {
  console.error("\x1b[31m[FAIL]\x1b[0m Uninstall error:", err);
  console.error("Make sure you are running this script as Administrator.");
  process.exit(1);
});

// Dừng service trước rồi mới uninstall
svc.stop();
