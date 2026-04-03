// Path: src/utils/logger.js
// Purpose: Structured logger dùng chung toàn service — ghi console + file, có timestamp và level
// Dependencies: fs, path, dotenv
// Last Updated: 2026-04-03

"use strict";

const fs = require("fs");
const path = require("path");

const LOG_LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LOG_DIR = path.resolve(process.env.LOG_DIR || "logs");

// Đảm bảo thư mục log tồn tại
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Lấy tên file log theo ngày hiện tại
 * @param {string} prefix - "build-service" hoặc "error"
 * @returns {string} đường dẫn file log
 */
const getLogFilePath = (prefix = "build-service") => {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `${prefix}-${date}.log`);
};

/**
 * Ghi 1 dòng log vào file (append)
 * @param {string} filePath
 * @param {string} line
 */
const appendToFile = (filePath, line) => {
  try {
    fs.appendFileSync(filePath, line + "\n", { encoding: "utf8" });
  } catch {
    // Không throw — lỗi ghi file không được làm crash service
  }
};

/**
 * Format log entry thành JSON string
 * @param {string} level
 * @param {string} message
 * @param {object} meta - context tùy chọn
 */
const formatEntry = (level, message, meta = {}) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
};

/**
 * Hàm log chính
 * @param {string} level - debug|info|warn|error
 * @param {string} message
 * @param {object} meta - context: machineId, repoId, pushId, step, v.v.
 */
const log = (level, message, meta = {}) => {
  const currentPriority = LOG_LEVEL_PRIORITY[LOG_LEVEL] ?? 1;
  const msgPriority = LOG_LEVEL_PRIORITY[level] ?? 1;
  if (msgPriority < currentPriority) return;

  const entry = formatEntry(level, message, meta);

  // Ghi ra console với màu sắc
  const colors = { debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m" };
  const reset = "\x1b[0m";
  const color = colors[level] || reset;
  console.log(`${color}${entry}${reset}`);

  // Ghi vào file log chính
  appendToFile(getLogFilePath("build-service"), entry);

  // Ghi thêm vào file error nếu là error/warn
  if (level === "error" || level === "warn") {
    appendToFile(getLogFilePath("error"), entry);
  }
};

/**
 * API công khai
 * Cách dùng:
 *   const logger = require("./utils/logger");
 *   logger.info("Build started", { machineId, repoId, pushId });
 *   logger.error("Build failed", { machineId, repoId, pushId, error: err.message });
 */
module.exports = {
  debug: (message, meta = {}) => log("debug", message, meta),
  info:  (message, meta = {}) => log("info",  message, meta),
  warn:  (message, meta = {}) => log("warn",  message, meta),
  error: (message, meta = {}) => log("error", message, meta),
};
