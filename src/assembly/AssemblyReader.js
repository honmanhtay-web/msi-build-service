// Path: src/assembly/AssemblyReader.js
// Purpose: Đọc version, ProductName, hash từ file .exe bằng PowerShell/.NET reflection
// Dependencies: child_process, utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * AssemblyReader
 *
 * Dùng PowerShell inline script để gọi .NET FileVersionInfo và Get-FileHash.
 * Không phụ thuộc module ngoài — chỉ dùng standard Node.js + PowerShell có sẵn trên Windows.
 *
 * Output chuẩn:
 * {
 *   fileVersion:    "1.2.3.4",
 *   productVersion: "1.2.3",
 *   productName:    "DH Hospital Pharmacy",
 *   companyName:    "DHG Pharma",
 *   fileDescription:"...",
 *   sha256:         "ABCDEF...",
 * }
 *
 * Cách dùng:
 *   const reader = new AssemblyReader();
 *   const meta = await reader.read("C:/path/to/app.exe");
 */
class AssemblyReader {
  constructor() {
    // Tự chọn powershell.exe hoặc pwsh tuỳ hệ thống
    this.psExe = this._detectPowerShell();
  }

  /**
   * Đọc metadata từ file .exe
   * @param {string} exePath - absolute path tới file .exe
   * @returns {Promise<object>} metadata object
   */
  async read(exePath) {
    const ctx = { machineId: MACHINE_ID, exePath };
    logger.info("[AssemblyReader] Reading exe metadata...", ctx);

    const script = this._buildScript(exePath);
    const result = this._runPowerShell(script, ctx);

    logger.info("[AssemblyReader] Metadata read successfully", { ...ctx, version: result.fileVersion });
    return result;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Sinh inline PowerShell script đọc metadata và xuất JSON
   */
  _buildScript(exePath) {
    // Escape backslash và quote trong path
    const safePath = exePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    return `
$ErrorActionPreference = 'Stop'
try {
  $exePath = '${safePath}'
  $fvi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exePath)
  $hash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash

  $obj = [ordered]@{
    fileVersion    = $fvi.FileVersion
    productVersion = $fvi.ProductVersion
    productName    = $fvi.ProductName
    companyName    = $fvi.CompanyName
    fileDescription= $fvi.FileDescription
    sha256         = $hash
  }

  $obj | ConvertTo-Json -Compress
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim();
  }

  /**
   * Chạy PowerShell script và parse JSON output
   * @param {string} script
   * @param {object} ctx
   * @returns {object}
   */
  _runPowerShell(script, ctx) {
    const result = spawnSync(this.psExe, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command", script,
    ], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30000, // 30 giây tối đa
    });

    if (result.status !== 0) {
      const errMsg = (result.stderr || result.error?.message || "Unknown PowerShell error").trim();
      const msg = `[AssemblyReader] PowerShell failed: ${errMsg}`;
      logger.error(msg, ctx);
      throw new Error(msg);
    }

    const stdout = (result.stdout || "").trim();
    if (!stdout) {
      throw new Error("[AssemblyReader] PowerShell returned empty output");
    }

    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`[AssemblyReader] Failed to parse PowerShell JSON output: ${stdout.slice(0, 200)}`);
    }
  }

  /**
   * Detect powershell.exe hoặc pwsh — ưu tiên pwsh (cross-platform, faster)
   * @returns {string}
   */
  _detectPowerShell() {
    // Thử pwsh trước (PowerShell 7+)
    const pwshResult = spawnSync("pwsh", ["--version"], { stdio: "pipe", encoding: "utf8" });
    if (pwshResult.status === 0) return "pwsh";

    // Fallback về powershell.exe (Windows built-in)
    return "powershell.exe";
  }
}

module.exports = AssemblyReader;
