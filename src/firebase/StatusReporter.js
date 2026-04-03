// Path: src/firebase/StatusReporter.js
// Purpose: Cập nhật status, result và upload state của job lên Firebase — là cổng duy nhất ghi vào DB
// Dependencies: firebase-admin, utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * StatusReporter
 * Tất cả việc ghi trạng thái lên Firebase đều phải đi qua class này.
 * Không module nào khác được phép gọi Firebase ref trực tiếp.
 *
 * Cách dùng:
 *   const reporter = new StatusReporter(db, config, repoId, pushId);
 *   await reporter.setBuilding();
 *   await reporter.updateUpload("s3", { status: "done", url: "https://...", doneAt: Date.now() });
 *   await reporter.setDone({ version: "1.2.3", msiFileName: "Setup.msi" });
 */
class StatusReporter {
  /**
   * @param {import("firebase-admin/database").Database} db
   * @param {object} config
   * @param {string} config.buildQueuePath
   * @param {string} repoId
   * @param {string} pushId
   */
  constructor(db, config, repoId, pushId) {
    this.db = db;
    this.buildQueuePath = config.buildQueuePath || "build-queue";
    this.repoId = repoId;
    this.pushId = pushId;
    this._baseRef = db.ref(`${this.buildQueuePath}/${repoId}/${pushId}`);
  }

  /** Job đang trong quá trình build */
  async setBuilding() {
    await this._update({ status: "building", "result/startAt": Date.now() });
    logger.info("[StatusReporter] Status → building", { machineId: MACHINE_ID, repoId: this.repoId, pushId: this.pushId });
  }

  /**
   * Job hoàn thành thành công
   * @param {object} result
   * @param {string} result.version     - ví dụ "1.2.3.4"
   * @param {string} result.msiFileName - ví dụ "Setup-X.v1.2.3.4.msi"
   */
  async setDone(result = {}) {
    await this._update({
      status: "done",
      "result/version": result.version || "",
      "result/msiFileName": result.msiFileName || "",
      "result/endAt": Date.now(),
      "result/errorMessage": "",
    });
    logger.info("[StatusReporter] Status → done", { machineId: MACHINE_ID, repoId: this.repoId, pushId: this.pushId, ...result });
  }

  /**
   * Job thất bại
   * @param {string} errorMessage
   */
  async setFailed(errorMessage = "") {
    await this._update({
      status: "failed",
      "result/endAt": Date.now(),
      "result/errorMessage": errorMessage,
    });
    logger.error("[StatusReporter] Status → failed", { machineId: MACHINE_ID, repoId: this.repoId, pushId: this.pushId, errorMessage });
  }

  /**
   * Job bị bỏ qua vì file đã tồn tại trên tất cả targets
   */
  async setSkipped() {
    await this._update({ status: "skipped", "result/endAt": Date.now() });
    logger.info("[StatusReporter] Status → skipped", { machineId: MACHINE_ID, repoId: this.repoId, pushId: this.pushId });
  }

  /**
   * Cập nhật kết quả upload của 1 target ngay khi xong — không đợi các target khác
   * @param {string} targetName - "s3" | "onedrive" | "gdrive" | "nas"
   * @param {object} uploadResult
   * @param {string} uploadResult.status   - "done" | "failed" | "skipped"
   * @param {string} [uploadResult.url]    - URL file sau khi upload
   * @param {string} [uploadResult.error]  - thông báo lỗi nếu failed
   * @param {number} [uploadResult.doneAt] - timestamp ms
   */
  async updateUpload(targetName, uploadResult = {}) {
    const update = {};
    update[`result/uploads/${targetName}/status`]  = uploadResult.status || "failed";
    update[`result/uploads/${targetName}/url`]     = uploadResult.url || "";
    update[`result/uploads/${targetName}/error`]   = uploadResult.error || "";
    update[`result/uploads/${targetName}/doneAt`]  = uploadResult.doneAt || Date.now();
    await this._update(update);
    logger.info(`[StatusReporter] Upload[${targetName}] → ${uploadResult.status}`, {
      machineId: MACHINE_ID, repoId: this.repoId, pushId: this.pushId, targetName, ...uploadResult,
    });
  }

  /**
   * Ghi update lên Firebase ref — helper nội bộ
   * @param {object} updateObj - flat object với key là path tương đối
   */
  async _update(updateObj) {
    try {
      await this._baseRef.update(updateObj);
    } catch (err) {
      logger.error("[StatusReporter] Firebase update failed", {
        machineId: MACHINE_ID,
        repoId: this.repoId,
        pushId: this.pushId,
        error: err.message,
        updateObj,
      });
      // Không throw — lỗi ghi Firebase không nên làm crash toàn bộ job
    }
  }
}

module.exports = StatusReporter;
