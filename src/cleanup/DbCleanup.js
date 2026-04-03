// Path: src/cleanup/DbCleanup.js
// Purpose: Dọn dẹp dữ liệu cũ trên Firebase theo TTL rules — chạy định kỳ mỗi 60 phút
// Dependencies: firebase-admin, utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * TTL Rules (đọc từ config/env):
 *
 * done / skipped  → xóa sau CLEANUP_DONE_DAYS ngày    (default: 7)
 * failed          → xóa sau CLEANUP_FAILED_DAYS ngày  (default: 7)
 * pending         → xóa sau CLEANUP_PENDING_DAYS ngày (default: 30) — stale job
 * claimed/building→ reset về "pending" sau CLEANUP_STUCK_HOURS giờ (default: 2) — crash recovery
 */
class DbCleanup {
  /**
   * @param {import("firebase-admin/database").Database} db
   * @param {object} config
   * @param {string} config.buildQueuePath
   * @param {object} config.cleanup
   */
  constructor(db, config) {
    this.db = db;
    this.buildQueuePath = config.buildQueuePath || "build-queue";
    this.cleanup = config.cleanup || {};
    this._intervalId = null;
  }

  /** Lấy TTL config với fallback về env rồi default */
  get ttl() {
    const c = this.cleanup.ttl || {};
    return {
      doneDays:     parseInt(process.env.CLEANUP_DONE_DAYS)     || c.doneDays     || 7,
      failedDays:   parseInt(process.env.CLEANUP_FAILED_DAYS)   || c.failedDays   || 7,
      pendingDays:  parseInt(process.env.CLEANUP_PENDING_DAYS)  || c.pendingDays  || 30,
      stuckHours:   parseInt(process.env.CLEANUP_STUCK_HOURS)   || c.stuckHours   || 2,
    };
  }

  get intervalMs() {
    const minutes = parseInt(process.env.CLEANUP_INTERVAL_MINUTES)
      || this.cleanup.intervalMinutes
      || 60;
    return minutes * 60 * 1000;
  }

  /** Bắt đầu chạy cleanup định kỳ */
  start() {
    logger.info("[DbCleanup] Cleanup scheduler started", {
      machineId: MACHINE_ID,
      intervalMinutes: this.intervalMs / 60000,
      ttl: this.ttl,
    });
    // Chạy ngay lần đầu sau 5 giây (để service kịp khởi động)
    setTimeout(() => this.runOnce(), 5000);
    // Sau đó chạy định kỳ
    this._intervalId = setInterval(() => this.runOnce(), this.intervalMs);
  }

  /** Dừng cleanup scheduler */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      logger.info("[DbCleanup] Cleanup scheduler stopped", { machineId: MACHINE_ID });
    }
  }

  /** Chạy 1 lần cleanup toàn bộ queue */
  async runOnce() {
    logger.info("[DbCleanup] Running cleanup...", { machineId: MACHINE_ID });
    const stats = { deleted: 0, reset: 0, skipped: 0 };

    try {
      const snapshot = await this.db.ref(this.buildQueuePath).get();
      if (!snapshot.exists()) return;

      const allRepos = snapshot.val();
      if (!allRepos || typeof allRepos !== "object") return;

      const now = Date.now();
      const ttl = this.ttl;

      for (const repoId of Object.keys(allRepos)) {
        const pushes = allRepos[repoId];
        if (!pushes || typeof pushes !== "object") continue;

        for (const pushId of Object.keys(pushes)) {
          const job = pushes[pushId];
          if (!job) continue;

          const action = this._decideAction(job, now, ttl);

          if (action === "delete") {
            await this._deleteJob(repoId, pushId);
            stats.deleted++;
          } else if (action === "reset") {
            await this._resetJob(repoId, pushId);
            stats.reset++;
          } else {
            stats.skipped++;
          }
        }
      }
    } catch (err) {
      logger.error("[DbCleanup] Cleanup error", { machineId: MACHINE_ID, error: err.message });
    }

    logger.info("[DbCleanup] Cleanup done", { machineId: MACHINE_ID, ...stats });
  }

  /**
   * Quyết định hành động với 1 job record
   * @returns {"delete"|"reset"|"keep"}
   */
  _decideAction(job, now, ttl) {
    const status = job.status;
    const createdAt = job.createdAt || 0;
    const claimedAt = job.claimedAt || 0;

    if (status === "done" || status === "skipped") {
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
      return ageDays >= ttl.doneDays ? "delete" : "keep";
    }

    if (status === "failed") {
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
      return ageDays >= ttl.failedDays ? "delete" : "keep";
    }

    if (status === "pending") {
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
      return ageDays >= ttl.pendingDays ? "delete" : "keep";
    }

    if (status === "claimed" || status === "building") {
      const ageHours = (now - claimedAt) / (1000 * 60 * 60);
      return ageHours >= ttl.stuckHours ? "reset" : "keep";
    }

    return "keep";
  }

  /** Xóa 1 job record — dùng transaction để tránh conflict */
  async _deleteJob(repoId, pushId) {
    const ref = this.db.ref(`${this.buildQueuePath}/${repoId}/${pushId}`);
    try {
      await ref.transaction((current) => {
        if (!current) return; // đã bị xóa rồi
        const status = current.status;
        // Chỉ xóa nếu vẫn là trạng thái cần xóa (không xóa pending mới phát sinh)
        if (["done", "skipped", "failed"].includes(status)) return null;
        if (status === "pending") return null;
        return; // abort nếu đã chuyển sang claimed/building
      });
      logger.debug("[DbCleanup] Deleted job", { machineId: MACHINE_ID, repoId, pushId });
    } catch (err) {
      logger.warn("[DbCleanup] Delete job failed", { machineId: MACHINE_ID, repoId, pushId, error: err.message });
    }
  }

  /** Reset job stuck về pending — crash recovery */
  async _resetJob(repoId, pushId) {
    const ref = this.db.ref(`${this.buildQueuePath}/${repoId}/${pushId}`);
    try {
      await ref.transaction((current) => {
        if (!current) return;
        if (current.status !== "claimed" && current.status !== "building") return; // abort
        return {
          ...current,
          status: "pending",
          claimedBy: "",
          claimedAt: 0,
        };
      });
      logger.info("[DbCleanup] Reset stuck job → pending", { machineId: MACHINE_ID, repoId, pushId });
    } catch (err) {
      logger.warn("[DbCleanup] Reset job failed", { machineId: MACHINE_ID, repoId, pushId, error: err.message });
    }
  }
}

module.exports = DbCleanup;
