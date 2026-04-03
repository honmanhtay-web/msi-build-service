// Path: src/advinst/ConfigResolver.js
// Purpose: Merge config từ ENV → .aip.json → defaults; detect advinst.exe và MainExe
// Dependencies: fs, path, utils/logger, utils/machineId, utils/pathUtils
// Last Updated: 2026-04-03

"use strict";

const fs   = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");
const { isFile, isDir, getAllFiles } = require("../utils/pathUtils");

// Hard-coded fallback paths khi không tìm được advinst.exe qua ENV/config/scan
const ADVINST_FALLBACK_PATHS = [
  "C:/Program Files (x86)/Caphyon/Advanced Installer 21.3/bin/x86/advinst.exe",
  "C:/Program Files (x86)/Caphyon/Advanced Installer 22.0/bin/x86/advinst.exe",
  "C:/Program Files (x86)/Caphyon/Advanced Installer/bin/x86/advinst.exe",
];

// Thư mục scan tìm advinst.exe trong repo hoặc service root
const ADVINST_SCAN_DIRS = [".advinst", ".bin-advinst", "advinst", "bin-advinst"];

/**
 * ConfigResolver
 *
 * Resolve config cuối cùng cho AdvinstBuilder từ nhiều nguồn theo thứ tự ưu tiên:
 *   ENV > .aip.json (trong repo) > service.config.json > defaults
 *
 * Output:
 * {
 *   aipFilePath:     "C:/.../.../app.aip",           ← path tới file .aip
 *   advinstExePath:  "C:/.../advinst.exe",            ← path advinst.exe
 *   mainExePath:     "C:/.../app.exe",                ← file exe chính để đọc version
 *   productVersion:  "1.2.3.4",                       ← version sẽ set vào MSI
 *   outputDir:       "C:/.../build-output/",          ← thư mục chứa MSI output
 *   msiFileName:     "Setup-AppName.v1.2.3.4.msi",   ← tên file MSI sau build
 *   setupTitle:      "DH Hospital Pharmacy",          ← tiêu đề hiển thị trong installer
 * }
 *
 * Cách dùng:
 *   const resolver = new ConfigResolver(serviceConfig);
 *   const resolved = await resolver.resolve({
 *     workDir,        // đường dẫn repo đã clone
 *     buildOutputDir, // thư mục output tạm
 *     assemblyMeta,   // kết quả từ AssemblyReader
 *   });
 */
class ConfigResolver {
  /**
   * @param {object} serviceConfig - nội dung config/service.config.json
   */
  constructor(serviceConfig) {
    this.serviceConfig = serviceConfig || {};
  }

  /**
   * Resolve toàn bộ config cần thiết để build MSI
   * @param {object} params
   * @param {string} params.workDir        - thư mục repo đã clone
   * @param {string} params.buildOutputDir - thư mục output tạm
   * @param {object} params.assemblyMeta   - output của AssemblyReader
   * @returns {object} resolved config
   */
  async resolve({ workDir, buildOutputDir, assemblyMeta }) {
    const ctx = { machineId: MACHINE_ID, workDir };

    // 1. Đọc .aip.json trong repo (config của từng project)
    const aipJson = this._readAipJson(workDir);

    // 2. Tìm file .aip
    const aipFilePath = this._resolveAipFilePath(workDir, aipJson, ctx);

    // 3. Tìm advinst.exe
    const advinstExePath = this.detectAdvinstExe(workDir, ctx);

    // 4. Tìm MainExe
    const mainExePath = this._resolveMainExe(workDir, aipJson, assemblyMeta, ctx);

    // 5. Lấy version từ assemblyMeta
    const productVersion = this._resolveVersion(assemblyMeta, aipJson);

    // 6. Tên MSI
    const appName    = aipJson.appName || assemblyMeta?.productName || "Setup";
    const safeName   = appName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const msiFileName = aipJson.msiFileName
      || `${safeName}.v${productVersion}.msi`;

    // 7. Setup title
    const setupTitle = aipJson.setupTitle || assemblyMeta?.productName || appName;

    const resolved = {
      aipFilePath,
      advinstExePath,
      mainExePath,
      productVersion,
      outputDir: buildOutputDir,
      msiFileName,
      setupTitle,
      appName,
      // Pass-through extras từ aipJson
      extraCommands: aipJson.extraCommands || [],
    };

    logger.info("[ConfigResolver] Config resolved", { ...ctx, resolved });
    return resolved;
  }

  /**
   * Detect đường dẫn advinst.exe theo thứ tự ưu tiên:
   * 1. ENV ADVINST_EXE_PATH
   * 2. service.config.json → advinst.exePath
   * 3. Scan ADVINST_SCAN_DIRS trong repo
   * 4. Hard-coded fallback paths
   * @param {string} [workDir] - thư mục repo (để scan)
   * @param {object} [ctx]     - log context
   * @returns {string} path đến advinst.exe
   */
  detectAdvinstExe(workDir = "", ctx = {}) {
    // 1. ENV
    const envPath = process.env.ADVINST_EXE_PATH;
    if (envPath && isFile(envPath)) {
      logger.debug("[ConfigResolver] advinst.exe from ENV", { ...ctx, envPath });
      return envPath;
    }

    // 2. service.config.json
    const configPath = this.serviceConfig?.advinst?.exePath;
    if (configPath && isFile(configPath)) {
      logger.debug("[ConfigResolver] advinst.exe from service.config.json", { ...ctx, configPath });
      return configPath;
    }

    // 3. Scan thư mục trong repo và service root
    const scanRoots = [workDir, process.cwd()].filter(Boolean);
    for (const root of scanRoots) {
      for (const subDir of ADVINST_SCAN_DIRS) {
        const scanPath = path.join(root, subDir);
        if (!isDir(scanPath)) continue;
        const found = getAllFiles(scanPath, { extensions: [".exe"] })
          .find((f) => path.basename(f).toLowerCase() === "advinst.exe");
        if (found) {
          logger.debug("[ConfigResolver] advinst.exe found by scan", { ...ctx, found });
          return found;
        }
      }
    }

    // 4. Fallback paths từ config hoặc hard-coded list
    const fallbacks = this.serviceConfig?.advinst?.fallbackPaths || ADVINST_FALLBACK_PATHS;
    for (const fp of fallbacks) {
      if (isFile(fp)) {
        logger.debug("[ConfigResolver] advinst.exe from fallback", { ...ctx, fp });
        return fp;
      }
    }

    // Không tìm thấy — throw để job bị đánh dấu failed với thông báo rõ ràng
    throw new Error(
      "[ConfigResolver] advinst.exe not found. Set ADVINST_EXE_PATH in .env or install Advanced Installer."
    );
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Đọc .aip.json trong repo (config riêng của từng project)
   * File này do developer của repo đặt, không phải secret
   */
  _readAipJson(workDir) {
    const candidates = [
      path.join(workDir, ".aip.json"),
      path.join(workDir, "advinst.json"),
      path.join(workDir, ".advinst", "config.json"),
    ];
    for (const p of candidates) {
      if (isFile(p)) {
        try {
          const content = fs.readFileSync(p, "utf8");
          return JSON.parse(content);
        } catch {
          logger.warn("[ConfigResolver] Failed to parse .aip.json", { machineId: MACHINE_ID, path: p });
        }
      }
    }
    return {};
  }

  /**
   * Tìm file .aip trong repo
   */
  _resolveAipFilePath(workDir, aipJson, ctx) {
    // Từ .aip.json
    if (aipJson.aipFile) {
      const p = path.resolve(workDir, aipJson.aipFile);
      if (isFile(p)) return p;
    }

    // Scan toàn bộ workDir tìm file .aip đầu tiên
    const found = getAllFiles(workDir, {
      extensions: [".aip"],
      ignoreNames: ["node_modules", ".git", "bin", "obj"],
    });
    if (found.length > 0) {
      if (found.length > 1) {
        logger.warn("[ConfigResolver] Multiple .aip files found, using first", { ...ctx, files: found });
      }
      return found[0];
    }

    throw new Error(`[ConfigResolver] No .aip file found in workDir: ${workDir}`);
  }

  /**
   * Resolve đường dẫn MainExe — file .exe chính của app
   */
  _resolveMainExe(workDir, aipJson, assemblyMeta, ctx) {
    // Từ .aip.json
    if (aipJson.mainExe) {
      const p = path.resolve(workDir, aipJson.mainExe);
      if (isFile(p)) return p;
      logger.warn("[ConfigResolver] mainExe from .aip.json not found", { ...ctx, path: p });
    }

    // Scan thư mục APPDIRFiles (convention của Advanced Installer)
    const appDirCandidates = ["APPDIRFiles", "APPDIR", "Release", "bin/Release", "bin/x64/Release", "bin/x86/Release"];
    for (const subDir of appDirCandidates) {
      const scanDir = path.join(workDir, subDir);
      if (!isDir(scanDir)) continue;
      const exeFiles = getAllFiles(scanDir, {
        extensions: [".exe"],
        ignoreNames: ["node_modules", ".git"],
      });
      if (exeFiles.length === 1) return exeFiles[0];
      if (exeFiles.length > 1) {
        // Ưu tiên exe có tên trùng productName
        const nameHint = (assemblyMeta?.productName || "").toLowerCase().replace(/\s+/g, "");
        const matched = exeFiles.find((f) =>
          path.basename(f, ".exe").toLowerCase().replace(/\s+/g, "") === nameHint
        );
        return matched || exeFiles[0];
      }
    }

    // Không tìm được — trả null, bước đọc version sẽ dùng fallback
    logger.warn("[ConfigResolver] MainExe not detected", ctx);
    return null;
  }

  /**
   * Lấy version string: ưu tiên assemblyMeta, fallback về aipJson, rồi "1.0.0.0"
   */
  _resolveVersion(assemblyMeta, aipJson) {
    return assemblyMeta?.fileVersion
      || assemblyMeta?.productVersion
      || aipJson?.version
      || "1.0.0.0";
  }
}

module.exports = ConfigResolver;
