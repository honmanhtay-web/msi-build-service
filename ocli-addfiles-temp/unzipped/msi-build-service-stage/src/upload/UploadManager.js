// Path: src/upload/UploadManager.js
// Purpose: Orchestrate upload song song tới nhiều storage targets, update Firebase từng adapter ngay khi xong
// Dependencies: fs, path, utils/logger, utils/machineId, upload/adapters/*
// Last Updated: 2026-04-03

"use strict";

const fs   = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

const S3Adapter          = require("./adapters/S3Adapter");
const OneDriveAdapter    = require("./adapters/OneDriveAdapter");
const GoogleDriveAdapter = require("./adapters/GoogleDriveAdapter");
const SynologyAdapter    = require("./adapters/SynologyAdapter");

/**
 * UploadManager
 *
 * Luồng xử lý với mỗi adapter:
 *   1. checkExists(msiFileName) → nếu đã có → updateUpload(name, {status:"skipped"}) → skip
 *   2. upload(msiFilePath, meta) → updateUpload(name, {status:"done", url, ...})
 *   3. Nếu lỗi → updateUpload(name, {status:"failed", error})
 *
 * Tất cả adapters chạy song song qua Promise.allSettled — 1 cái fail không block cái khác.
 * Firebase được update ngay khi từng adapter xong, không đợi tất cả.
 *
 * Cách dùng:
 *   const manager = new UploadManager(serviceConfig);
 *   await manager.uploadAll({
 *     msiFilePath,
 *     msiFileName,
 *     meta: { repoId, pushId, version },
 *     statusReporter,
 *   });
 */
class UploadManager {
  /**
   * @param {object} serviceConfig - nội dung config/service.config.json
   */
  constructor(serviceConfig) {
    this.serviceConfig = serviceConfig || {};
    this._adapters = this._buildAdapters();
  }

  /**
   * Upload MSI lên tất cả enabled targets song song
   * @param {object} params
   * @param {string} params.msiFilePath    - absolute path tới file .msi
   * @param {string} params.msiFileName    - tên file (dùng để checkExists)
   * @param {object} params.meta           - { repoId, pushId, version }
   * @param {object} params.statusReporter - instance của StatusReporter
   * @returns {Promise<void>}
   */
  async uploadAll({ msiFilePath, msiFileName, meta, statusReporter }) {
    const ctx = { machineId: MACHINE_ID, ...meta, msiFileName };

    if (this._adapters.length === 0) {
      logger.warn("[UploadManager] No upload adapters enabled — skipping all uploads", ctx);
      return;
    }

    logger.info("[UploadManager] Starting parallel upload", {
      ...ctx,
      targets: this._adapters.map((a) => a.getName()),
    });

    // Chạy tất cả song song — allSettled đảm bảo không bị block khi 1 adapter fail
    await Promise.allSettled(
      this._adapters.map((adapter) =>
        this._handleAdapter(adapter, msiFilePath, msiFileName, meta, statusReporter, ctx)
      )
    );

    logger.info("[UploadManager] All uploads settled", ctx);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Xử lý 1 adapter: checkExists → upload → report
   */
  async _handleAdapter(adapter, msiFilePath, msiFileName, meta, statusReporter, ctx) {
    const name = adapter.getName();
    const adapterCtx = { ...ctx, adapter: name };

    try {
      // 1. Kiểm tra đã tồn tại chưa
      const exists = await adapter.checkExists(msiFileName);
      if (exists) {
        logger.info(`[UploadManager] ${name}: file exists — skipping`, adapterCtx);
        await statusReporter.updateUpload(name, {
          status: "skipped",
          url:    "",
          error:  "",
          doneAt: Date.now(),
        });
        return;
      }

      // 2. Upload
      const result = await adapter.upload(msiFilePath, meta);

      // 3. Báo thành công ngay — không đợi adapter khác
      await statusReporter.updateUpload(name, {
        status: "done",
        url:    result.url    || "",
        error:  "",
        doneAt: result.uploadedAt || Date.now(),
      });

      logger.info(`[UploadManager] ${name}: upload done`, { ...adapterCtx, url: result.url });

    } catch (err) {
      logger.error(`[UploadManager] ${name}: upload failed`, { ...adapterCtx, error: err.message });

      // Báo fail ngay — không throw để không block các adapter khác
      await statusReporter.updateUpload(name, {
        status: "failed",
        url:    "",
        error:  err.message,
        doneAt: Date.now(),
      });
    }
  }

  /**
   * Khởi tạo danh sách adapters dựa trên config + env
   * Chỉ tạo adapter nếu được enable
   */
  _buildAdapters() {
    const adapters = [];
    const targets  = this.serviceConfig?.upload?.targets || {};

    // S3
    const s3Enabled = process.env.UPLOAD_S3_ENABLED === "true"
      || targets?.s3?.enabled === true;
    if (s3Enabled) {
      adapters.push(new S3Adapter(targets.s3 || {}));
      logger.info("[UploadManager] S3 adapter enabled", { machineId: MACHINE_ID });
    }

    // OneDrive
    const odEnabled = process.env.UPLOAD_ONEDRIVE_ENABLED === "true"
      || targets?.onedrive?.enabled === true;
    if (odEnabled) {
      adapters.push(new OneDriveAdapter(targets.onedrive || {}));
      logger.info("[UploadManager] OneDrive adapter enabled", { machineId: MACHINE_ID });
    }

    // Google Drive
    const gdEnabled = process.env.UPLOAD_GDRIVE_ENABLED === "true"
      || targets?.gdrive?.enabled === true;
    if (gdEnabled) {
      adapters.push(new GoogleDriveAdapter(targets.gdrive || {}));
      logger.info("[UploadManager] Google Drive adapter enabled", { machineId: MACHINE_ID });
    }

    // Synology NAS
    const nasEnabled = process.env.UPLOAD_NAS_ENABLED === "true"
      || targets?.nas?.enabled === true;
    if (nasEnabled) {
      adapters.push(new SynologyAdapter(targets.nas || {}));
      logger.info("[UploadManager] Synology NAS adapter enabled", { machineId: MACHINE_ID });
    }

    return adapters;
  }
}

module.exports = UploadManager;
