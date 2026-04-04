// Path: scripts/test-upload.js
// Purpose: Test từng upload adapter độc lập — dùng file MSI giả hoặc thật để kiểm tra checkExists + upload
// Dependencies: dotenv, src/upload/adapters/*, fs
// Last Updated: 2026-04-03
//
// Cách dùng:
//   node scripts/test-upload.js                        ← test tất cả adapters được enable
//   node scripts/test-upload.js --adapter s3           ← chỉ test S3
//   node scripts/test-upload.js --msiPath C:\path\to\real.msi  ← dùng file MSI thật
//   node scripts/test-upload.js --adapter onedrive --msiPath C:\build\Setup.msi

"use strict";

require("./mock/local-dotenv").config();
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { requestJson } = require("./mock/http-client");

const OK   = (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
const FAIL = (msg) => console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`);
const INFO = (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
const WARN = (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
const SEP  = ()    => console.log("─".repeat(60));

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    result[args[i].replace(/^--/, "")] = args[i + 1] || "";
  }
  return result;
};

/** Tạo file MSI giả để test nếu không có file thật */
const createFakeMsi = () => {
  const tmpPath = path.join(os.tmpdir(), `test-upload-${Date.now()}.msi`);
  // 1MB random bytes để giả lập file MSI
  const buf = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
};

const buildAdapters = () => {
  const S3Adapter = require("../src/upload/adapters/S3Adapter");
  const OneDriveAdapter = require("../src/upload/adapters/OneDriveAdapter");
  const GoogleDriveAdapter = require("../src/upload/adapters/GoogleDriveAdapter");
  const SynologyAdapter = require("../src/upload/adapters/SynologyAdapter");
  return {
    s3: () => new S3Adapter(),
    onedrive: () => new OneDriveAdapter(),
    gdrive: () => new GoogleDriveAdapter(),
    nas: () => new SynologyAdapter(),
  };
};

/** Kiểm tra adapter có được enable qua ENV không */
const isEnabled = (name) => {
  const map = {
    s3:       "UPLOAD_S3_ENABLED",
    onedrive: "UPLOAD_ONEDRIVE_ENABLED",
    gdrive:   "UPLOAD_GDRIVE_ENABLED",
    nas:      "UPLOAD_NAS_ENABLED",
  };
  return process.env[map[name]] === "true";
};

const testAdapter = async (adapter, msiFilePath, msiFileName) => {
  const name = adapter.getName();
  SEP();
  INFO(`Testing adapter: ${name.toUpperCase()}`);

  // 1. checkExists (file giả chắc chắn chưa có)
  let exists;
  try {
    exists = await adapter.checkExists(msiFileName);
    OK(`checkExists(${msiFileName}) → ${exists}`);
  } catch (err) {
    FAIL(`checkExists failed: ${err.message}`);
    return { name, success: false, error: err.message };
  }

  if (exists) {
    WARN(`File already exists on ${name} — skipping upload (checkExists working correctly)`);
    return { name, success: true, skipped: true };
  }

  // 2. upload
  let result;
  try {
    result = await adapter.upload(msiFilePath, {
      repoId:  "test-upload-script",
      pushId:  `test-${Date.now()}`,
      version: "0.0.1-test",
    });
    OK(`upload done → url=${result.url} size=${result.size} bytes`);
  } catch (err) {
    FAIL(`upload failed: ${err.message}`);
    return { name, success: false, error: err.message };
  }

  // 3. checkExists lại — phải thấy file vừa upload
  try {
    const existsAfter = await adapter.checkExists(msiFileName);
    if (existsAfter) {
      OK(`checkExists after upload → true (file confirmed on storage)`);
    } else {
      WARN(`checkExists after upload → false (may be propagation delay)`);
    }
  } catch (err) {
    WARN(`checkExists after upload failed: ${err.message}`);
  }

  return { name, success: true, url: result.url };
};

const testMockAdapter = async (name, msiFilePath, msiFileName, baseUrl) => {
  SEP();
  INFO(`Testing adapter: ${name.toUpperCase()} (mock)`);
  let exists = false;
  try {
    const r = await requestJson(baseUrl, "POST", "/upload/check-exists", { adapter: name, fileName: msiFileName });
    exists = !!r.exists;
    OK(`checkExists(${msiFileName}) → ${exists}`);
  } catch (err) {
    FAIL(`checkExists failed: ${err.message}`);
    return { name, success: false, error: err.message };
  }

  if (exists) return { name, success: true, skipped: true };

  try {
    const size = fs.statSync(msiFilePath).size;
    const r = await requestJson(baseUrl, "POST", "/upload", { adapter: name, fileName: msiFileName, size });
    OK(`upload done → url=${r.url} size=${r.size} bytes`);
    return { name, success: true, url: r.url };
  } catch (err) {
    FAIL(`upload failed: ${err.message}`);
    return { name, success: false, error: err.message };
  }
};

(async () => {
  const args        = parseArgs();
  const onlyAdapter = args.adapter || "";
  const msiPath     = args.msiPath ? path.resolve(args.msiPath) : "";

  // Chọn file MSI để test
  let msiFilePath;
  let isFake = false;
  if (msiPath && fs.existsSync(msiPath)) {
    msiFilePath = msiPath;
    INFO(`Using real MSI file: ${msiFilePath}`);
  } else {
    msiFilePath = createFakeMsi();
    isFake = true;
    INFO(`Using fake MSI file (1MB random): ${msiFilePath}`);
  }

  const msiFileName = path.basename(msiFilePath);
  INFO(`MSI filename: ${msiFileName}\n`);
  const mockMode = process.env.MOCK_MODE === "true" || !!process.env.MOCK_SERVER_URL;
  const mockBaseUrl = process.env.MOCK_SERVER_URL || "http://127.0.0.1:4311";
  const ALL_ADAPTERS = mockMode ? { s3: null, onedrive: null, gdrive: null, nas: null } : buildAdapters();

  // Chọn adapters cần test
  const adapterNames = onlyAdapter
    ? [onlyAdapter]
    : (mockMode ? Object.keys(ALL_ADAPTERS) : Object.keys(ALL_ADAPTERS).filter(isEnabled));

  if (adapterNames.length === 0) {
    WARN("No adapters are enabled. Set UPLOAD_*_ENABLED=true in .env");
    if (!onlyAdapter) WARN("Or specify --adapter s3|onedrive|gdrive|nas to force test one");
    process.exit(0);
  }

  INFO(`Adapters to test: ${adapterNames.join(", ")}\n`);

  const results = [];
  for (const name of adapterNames) {
    if (!mockMode && !ALL_ADAPTERS[name]) {
      FAIL(`Unknown adapter: ${name}`);
      continue;
    }
    const r = mockMode
      ? await testMockAdapter(name, msiFilePath, msiFileName, mockBaseUrl)
      : await testAdapter(ALL_ADAPTERS[name](), msiFilePath, msiFileName);
    results.push(r);
  }

  // Cleanup fake file
  if (isFake && fs.existsSync(msiFilePath)) {
    fs.unlinkSync(msiFilePath);
  }

  // Summary
  SEP();
  INFO("Summary:");
  let allOk = true;
  for (const r of results) {
    if (r.success) {
      OK(`${r.name}: ${r.skipped ? "skipped (already exists)" : "passed"} ${r.url ? `→ ${r.url}` : ""}`);
    } else {
      FAIL(`${r.name}: FAILED — ${r.error}`);
      allOk = false;
    }
  }

  console.log("");
  if (allOk) console.log("\x1b[32mAll upload adapter tests passed.\x1b[0m");
  else       console.log("\x1b[31mSome adapters failed — check logs above.\x1b[0m");

  process.exit(allOk ? 0 : 1);
})();
