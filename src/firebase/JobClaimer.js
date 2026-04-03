// Path: src/firebase/JobClaimer.js
// Purpose: Claim job trên Firebase bằng transaction — đảm bảo chỉ 1 service instance xử lý 1 job
// Dependencies: firebase-admin, utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * JobClaimer
 * Dùng Firebase runTransaction để claim job một cách atomic.
 * Nếu 2 service cùng cố claim 1 job → chỉ 1 thắng, 1 thua (transaction abort).
 *
 * Cách dùng:
 *   const claimer = new JobClaimer(db, config);
 *   const claimed = await claimer.claim(repoId, pushId);
 *   if (claimed) { ... tiến hành build ... }
 */
class JobClaimer {
  /**
   * @param {import("firebase-admin/database").Database} db
   * @param {object} config
   * @param {string} config.buildQueuePath
   */
  constructor(db, config) {
    this.db = db;
    this.buildQueuePath = config.buildQueuePath || "build-queue";
  }

  /**
   * Thử claim job. Dùng Firebase transaction để đảm bảo atomic.
   * @param {string} repoId
   * @param {string} pushId
   * @returns {Promise<boolean>} true nếu claim thành công, false nếu thua race
   */
  async claim(repoId, pushId) {
    const ref = this.db.ref(`${this.buildQueuePath}/${repoId}/${pushId}`);
    const now = Date.now();

    try {
      const result = await ref.transaction((currentData) => {
        // Nếu record không tồn tại → abort
        if (currentData === null) {
          logger.warn("[JobClaimer] Transaction abort: record not found", {
            machineId: MACHINE_ID, repoId, pushId,
          });
          return; // undefined = abort
        }

        // Nếu không còn pending → đã bị claim bởi instance khác → abort
        if (currentData.status !== "pending") {
          return; // abort
        }

        // Claim thành công → cập nhật record
        return {
          ...currentData,
          status: "claimed",
          claimedBy: MACHINE_ID,
          claimedAt: now,
        };
      });

      // result.committed = true nếu transaction commit (claim thành công)
      if (result.committed) {
        logger.info("[JobClaimer] Job claimed successfully", {
          machineId: MACHINE_ID, repoId, pushId,
        });
        return true;
      } else {
        logger.warn("[JobClaimer] Job claim skipped (race condition or already claimed)", {
          machineId: MACHINE_ID, repoId, pushId,
        });
        return false;
      }
    } catch (err) {
      logger.error("[JobClaimer] Transaction error", {
        machineId: MACHINE_ID, repoId, pushId, error: err.message,
      });
      return false;
    }
  }
}

module.exports = JobClaimer;
