// Path: src/advinst/AdvinstBuilder.js
// Purpose: Orchestrate luồng build MSI: resolve config → gen command file → spawn advinst.exe → tìm output
// Dependencies: child_process, fs, path, utils/logger, utils/machineId, utils/pathUtils,
//               advinst/ConfigResolver, advinst/CommandFileGenerator, assembly/AssemblyReader
// Last Updated: 2026-04-03

"use strict";

const { spawn }  = require("child_process");
const fs         = require("fs");                        // ✅ FIX: was require("path")
const path       = require("path");

const logger               = require("../utils/logger");
const { MACHINE_ID }       = require("../utils/machineId");
const { ensureDir, getAllFiles, isFile } = require("../utils/pathUtils");

const ConfigResolver       = require("./ConfigResolver");
const CommandFileGenerator = require("./CommandFileGenerator");
const AssemblyReader       = require("../assembly/AssemblyReader");

/**
 * AdvinstBuilder
 *
 * Luồng thực hiện:
 *   1. AssemblyReader.read(mainExePath) → assemblyMeta (version, productName…)
 *   2. ConfigResolver.resolve(...)      → resolved config
 *   3. Clone file .aip vào buildTmpDir  → không sửa file gốc
 *   4. CommandFileGenerator.generate()  → nội dung command file
 *   5. Ghi command file vào buildTmpDir
 *   6. spawn advinst.exe /execute commandFile → build MSI
 *   7. Tìm file .msi trong outputDir   → copy ra outputPath
 *   8. Trả về { msiFilePath, msiFileName, version }
 *
 * Cách dùng:
 *   const builder = new AdvinstBuilder(serviceConfig);
 *   const result  = await builder.build({
 *     repoId, pushId, workDir, buildOutputDir,
 *   });
 */
class AdvinstBuilder {
  /**
   * @param {object} serviceConfig - nội dung config/service.config.json
   */
  constructor(serviceConfig) {
    this.serviceConfig = serviceConfig || {};
    this.resolver   = new ConfigResolver(serviceConfig);
    this.generator  = new CommandFileGenerator();
    this.reader     = new AssemblyReader();

    this.timeoutMs  = (parseInt(process.env.BUILD_TIMEOUT_SECONDS) || 300) * 1000;
    this.outputRoot = path.resolve(
      process.env.BUILD_OUTPUT_DIR || serviceConfig?.build?.outputDirRoot || ".oAdvBuild"
    );
  }

  /**
   * Thực hiện toàn bộ build
   * @param {object} params
   * @param {string} params.repoId        - dùng để tạo thư mục build tạm
   * @param {string} params.pushId        - dùng để tạo thư mục build tạm
   * @param {string} params.workDir       - thư mục repo đã clone
   * @returns {Promise<object>} { msiFilePath, msiFileName, version, assemblyMeta }
   */
  async build({ repoId, pushId, workDir }) {
    const ctx = { machineId: MACHINE_ID, repoId, pushId, workDir };
    logger.info("[AdvinstBuilder] Build started", ctx);

    // Thư mục build tạm cho job này — cô lập hoàn toàn
    const buildTmpDir = path.join(this.outputRoot, `${repoId}-${pushId}`);
    ensureDir(buildTmpDir);

    try {
      // ── Step 1: Resolve sơ bộ để tìm mainExe trước ──────────────────────
      const resolved0 = await this.resolver.resolve({
        workDir,
        buildOutputDir: buildTmpDir,
        assemblyMeta:   null,
      });

      // ── Step 2: Đọc assembly metadata từ MainExe ─────────────────────────
      let assemblyMeta = null;
      if (resolved0.mainExePath && isFile(resolved0.mainExePath)) {
        assemblyMeta = await this.reader.read(resolved0.mainExePath);
      } else {
        logger.warn("[AdvinstBuilder] MainExe not found — version will be from .aip.json or default", ctx);
      }

      // ── Step 3: Resolve lần 2 — có đủ assemblyMeta ────────────────────────
      const resolved = await this.resolver.resolve({
        workDir,
        buildOutputDir: buildTmpDir,
        assemblyMeta,
      });

      // ── Step 4: Clone file .aip vào buildTmpDir ────────────────────────────
      const clonedAipPath = path.join(buildTmpDir, path.basename(resolved.aipFilePath));
      fs.copyFileSync(resolved.aipFilePath, clonedAipPath);
      logger.debug("[AdvinstBuilder] .aip cloned to buildTmpDir", { ...ctx, clonedAipPath });

      // ── Step 5: Sinh command file ──────────────────────────────────────────
      const cmdConfig = { ...resolved, aipFilePath: clonedAipPath };
      const cmdContent = this.generator.generate(cmdConfig);
      const cmdFilePath = path.join(buildTmpDir, "build-cmd.txt");
      fs.writeFileSync(cmdFilePath, cmdContent, { encoding: "utf8" });
      logger.debug("[AdvinstBuilder] Command file written", { ...ctx, cmdFilePath });

      // ── Step 6: Chạy advinst.exe ──────────────────────────────────────────
      await this._runAdvinst(resolved.advinstExePath, cmdFilePath, ctx);

      // ── Step 7: Tìm file .msi output ──────────────────────────────────────
      const msiFilePath = this._findMsiOutput(buildTmpDir, resolved.msiFileName, ctx);

      logger.info("[AdvinstBuilder] Build done", {
        ...ctx,
        msiFilePath,
        msiFileName: resolved.msiFileName,
        version: resolved.productVersion,
      });

      return {
        msiFilePath,
        msiFileName: resolved.msiFileName,
        version:     resolved.productVersion,
        assemblyMeta,
      };

    } catch (err) {
      // Không xóa buildTmpDir khi fail — để debug
      logger.error("[AdvinstBuilder] Build failed", { ...ctx, error: err.message });
      throw new Error(`[AdvinstBuilder] Build failed: ${err.message}`);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Spawn advinst.exe với command file — có timeout + kill
   */
  _runAdvinst(advinstExePath, cmdFilePath, ctx) {
    return new Promise((resolve, reject) => {
      logger.info("[AdvinstBuilder] Spawning advinst.exe...", ctx);

      const proc = spawn(advinstExePath, ["/execute", cmdFilePath], {
        stdio: "pipe",
        windowsHide: true,
      });

      const stdoutLines = [];
      const stderrLines = [];

      proc.stdout?.on("data", (d) => {
        const line = d.toString().trim();
        if (line) {
          stdoutLines.push(line);
          logger.debug(`[AdvinstBuilder][stdout] ${line}`, ctx);
        }
      });

      proc.stderr?.on("data", (d) => {
        const line = d.toString().trim();
        if (line) {
          stderrLines.push(line);
          logger.warn(`[AdvinstBuilder][stderr] ${line}`, ctx);
        }
      });

      // Timeout — kill nếu quá lâu
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(
          `[AdvinstBuilder] advinst.exe timed out after ${this.timeoutMs / 1000}s`
        ));
      }, this.timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          logger.info("[AdvinstBuilder] advinst.exe exited successfully", ctx);
          resolve();
        } else {
          const errSummary = stderrLines.slice(-5).join(" | ") || stdoutLines.slice(-5).join(" | ");
          reject(new Error(
            `[AdvinstBuilder] advinst.exe exited with code ${code}: ${errSummary}`
          ));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`[AdvinstBuilder] Failed to spawn advinst.exe: ${err.message}`));
      });
    });
  }

  /**
   * Tìm file .msi trong buildTmpDir sau khi build
   * Ưu tiên tìm đúng tên msiFileName, fallback lấy file .msi đầu tiên
   */
  _findMsiOutput(buildTmpDir, msiFileName, ctx) {
    const msiFiles = getAllFiles(buildTmpDir, { extensions: [".msi"] });

    if (msiFiles.length === 0) {
      throw new Error(`[AdvinstBuilder] No .msi file found in buildTmpDir: ${buildTmpDir}`);
    }

    // Tìm đúng tên
    const exact = msiFiles.find(
      (f) => path.basename(f).toLowerCase() === msiFileName.toLowerCase()
    );
    if (exact) return exact;

    // Lấy file .msi đầu tiên nếu không khớp tên
    logger.warn("[AdvinstBuilder] msiFileName mismatch — using first .msi found", {
      ...ctx, expected: msiFileName, found: msiFiles.map((f) => path.basename(f)),
    });
    return msiFiles[0];
  }
}

module.exports = AdvinstBuilder;
