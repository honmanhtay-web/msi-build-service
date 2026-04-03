// Path: src/queue/JobQueue.js
// Purpose: Giới hạn số job build chạy đồng thời trên 1 service instance — tránh quá tải advinst.exe
// Dependencies: utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * JobQueue
 * Simple in-process queue với concurrency control.
 * Không dùng thư viện ngoài — giữ đơn giản, dễ debug.
 *
 * Cách dùng:
 *   const queue = new JobQueue({ maxConcurrent: 2 });
 *   queue.enqueue(async () => { ... build job ... });
 */
class JobQueue {
  /**
   * @param {object} options
   * @param {number} options.maxConcurrent - số job chạy đồng thời tối đa (default: 2)
   */
  constructor(options = {}) {
    this.maxConcurrent = parseInt(process.env.BUILD_MAX_CONCURRENT)
      || options.maxConcurrent
      || 2;
    this._running = 0;       // số job đang chạy hiện tại
    this._pending = [];      // hàng đợi: [{ jobFn, label }]
  }

  /**
   * Thêm job vào queue. Job sẽ chạy ngay nếu còn slot, hoặc đợi nếu đã đầy.
   * @param {Function} jobFn - async function thực thi job
   * @param {string} label   - tên job để log
   */
  enqueue(jobFn, label = "unknown") {
    logger.debug("[JobQueue] Enqueued job", {
      machineId: MACHINE_ID, label, running: this._running, pending: this._pending.length,
    });
    this._pending.push({ jobFn, label });
    this._tick();
  }

  /** Số job đang chạy */
  get runningCount() { return this._running; }

  /** Số job đang chờ */
  get pendingCount() { return this._pending.length; }

  /** Kiểm tra queue có đang idle không */
  get isIdle() { return this._running === 0 && this._pending.length === 0; }

  /** Chạy job tiếp theo nếu còn slot */
  _tick() {
    while (this._running < this.maxConcurrent && this._pending.length > 0) {
      const { jobFn, label } = this._pending.shift();
      this._running++;

      logger.info("[JobQueue] Job started", {
        machineId: MACHINE_ID, label, running: this._running, remaining: this._pending.length,
      });

      Promise.resolve()
        .then(() => jobFn())
        .catch((err) => {
          logger.error("[JobQueue] Job threw error", {
            machineId: MACHINE_ID, label, error: err.message,
          });
        })
        .finally(() => {
          this._running--;
          logger.info("[JobQueue] Job finished", {
            machineId: MACHINE_ID, label, running: this._running, remaining: this._pending.length,
          });
          this._tick(); // Kéo job tiếp theo vào
        });
    }
  }
}

module.exports = JobQueue;
