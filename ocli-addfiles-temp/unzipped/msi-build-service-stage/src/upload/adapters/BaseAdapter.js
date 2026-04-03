// Path: src/upload/adapters/BaseAdapter.js
// Purpose: Abstract base class định nghĩa interface bắt buộc cho mọi upload adapter
// Dependencies: utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../../utils/logger");
const { MACHINE_ID } = require("../../utils/machineId");

/**
 * BaseAdapter
 *
 * Mọi upload adapter PHẢI kế thừa class này và implement đủ 3 method:
 *   - getName()
 *   - checkExists(msiFileName)
 *   - upload(msiFilePath, meta)
 *
 * Không được override _log() và _wrap().
 */
class BaseAdapter {
  /**
   * Tên adapter — dùng trong log và Firebase key
   * @returns {string} ví dụ: "s3", "onedrive", "gdrive", "nas"
   */
  getName() {
    throw new Error(`[${this.constructor.name}] getName() must be implemented`);
  }

  /**
   * Kiểm tra file đã tồn tại trên storage target chưa
   * @param {string} msiFileName - tên file (không phải path đầy đủ)
   * @returns {Promise<boolean>}
   */
  async checkExists(msiFileName) {
    throw new Error(`[${this.constructor.name}] checkExists() must be implemented`);
  }

  /**
   * Upload file MSI lên storage target
   * @param {string} msiFilePath - absolute path tới file .msi local
   * @param {object} meta        - metadata: { repoId, pushId, version, msiFileName }
   * @returns {Promise<{url: string, size: number, uploadedAt: number}>}
   */
  async upload(msiFilePath, meta) {
    throw new Error(`[${this.constructor.name}] upload() must be implemented`);
  }

  // ─── Helpers dùng chung trong subclass ────────────────────────────────────

  /**
   * Log với context adapter name
   */
  _log(level, message, extra = {}) {
    logger[level](`[${this.getName()}] ${message}`, { machineId: MACHINE_ID, ...extra });
  }

  /**
   * Wrap async call với log + timing — dùng trong upload()
   * @param {string} label
   * @param {Function} fn
   */
  async _wrap(label, fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      this._log("info", `${label} done (${Date.now() - t0}ms)`);
      return result;
    } catch (err) {
      this._log("error", `${label} failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = BaseAdapter;
