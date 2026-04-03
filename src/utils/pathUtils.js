// Path: src/utils/pathUtils.js
// Purpose: Tiện ích resolve path an toàn — không hard-code, hỗ trợ relative/absolute
// Dependencies: fs, path
// Last Updated: 2026-04-03

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Resolve path: nếu là absolute thì giữ nguyên, nếu relative thì tính từ project root
 * Project root = thư mục chứa package.json, tính ngược từ file này
 * @param {string} inputPath
 * @returns {string} absolute path
 */
const resolveFromRoot = (inputPath) => {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return inputPath;
  // Tính project root: src/utils/ → src/ → root
  const projectRoot = path.resolve(__dirname, "../../");
  return path.resolve(projectRoot, inputPath);
};

/**
 * Kiểm tra file tồn tại và đúng là file (không phải thư mục)
 * @param {string} filePath
 * @returns {boolean}
 */
const isFile = (filePath) => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

/**
 * Kiểm tra thư mục tồn tại và đúng là directory
 * @param {string} dirPath
 * @returns {boolean}
 */
const isDir = (dirPath) => {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Tạo thư mục nếu chưa có (recursive)
 * @param {string} dirPath
 */
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Lấy tất cả file trong thư mục (đệ quy)
 * @param {string} dirPath
 * @param {object} options
 * @param {string[]} options.extensions - lọc theo đuôi file, ví dụ [".exe", ".ico"]
 * @param {string[]} options.ignoreNames  - bỏ qua thư mục/file có tên này
 * @returns {string[]} danh sách absolute path của tất cả file
 */
const getAllFiles = (dirPath, options = {}) => {
  const { extensions = [], ignoreNames = [] } = options;
  const results = [];

  const walk = (currentDir) => {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoreNames.includes(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions.length === 0) {
          results.push(fullPath);
        } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  };

  walk(dirPath);
  return results;
};

/**
 * Tìm file đầu tiên khớp tên trong danh sách thư mục
 * @param {string} fileName - tên file cần tìm (case-insensitive)
 * @param {string[]} searchDirs - danh sách thư mục cần tìm
 * @returns {string|null} absolute path nếu tìm thấy, null nếu không
 */
const findFileInDirs = (fileName, searchDirs = []) => {
  const lowerName = fileName.toLowerCase();
  for (const dir of searchDirs) {
    if (!isDir(dir)) continue;
    const files = getAllFiles(dir, { ignoreNames: ["node_modules", ".git"] });
    const found = files.find((f) => path.basename(f).toLowerCase() === lowerName);
    if (found) return found;
  }
  return null;
};

/**
 * Tìm file theo đuôi trong danh sách thư mục
 * @param {string} extension - ví dụ ".exe"
 * @param {string[]} searchDirs
 * @returns {string[]} danh sách file khớp
 */
const findFilesByExtension = (extension, searchDirs = []) => {
  const results = [];
  for (const dir of searchDirs) {
    if (!isDir(dir)) continue;
    const files = getAllFiles(dir, {
      extensions: [extension.toLowerCase()],
      ignoreNames: ["node_modules", ".git"],
    });
    results.push(...files);
  }
  return results;
};

module.exports = {
  resolveFromRoot,
  isFile,
  isDir,
  ensureDir,
  getAllFiles,
  findFileInDirs,
  findFilesByExtension,
};
