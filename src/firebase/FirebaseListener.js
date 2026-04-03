// Path: src/firebase/FirebaseListener.js
// Purpose: Lắng nghe Firebase Realtime DB, phát hiện job pending và đẩy vào JobQueue
// Dependencies: firebase-admin, utils/logger, utils/machineId
// Last Updated: 2026-04-03

"use strict";

const logger = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");

/**
 * FirebaseListener
 * Subscribe onValue vào /build-queue, lọc record pending, gọi callback để xử lý.
 *
 * Cách dùng:
 *   const listener = new FirebaseListener(db, config, onJobDetected);
 *   listener.start();
 *   // ...
 *   listener.stop();
 */
class FirebaseListener {
  /**
   * @param {import("firebase-admin/database").Database} db - Firebase Realtime DB instance
   * @param {object} config - service config
   * @param {string} config.buildQueuePath - path gốc trên Firebase, default "build-queue"
   * @param {Function} onJobDetected - async callback(repoId, pushId, jobData) khi phát hiện job pending
   */
  constructor(db, config, onJobDetected) {
    this.db = db;
    this.buildQueuePath = config.buildQueuePath || "build-queue";
    this.onJobDetected = onJobDetected;
    this._unsubscribe = null;
  }

  /**
   * Bắt đầu lắng nghe Firebase
   */
  start() {
    logger.info("[FirebaseListener] Starting listener...", { machineId: MACHINE_ID, path: this.buildQueuePath });

    const ref = this.db.ref(this.buildQueuePath);

    const handleSnapshot = (snapshot) => {
      if (!snapshot.exists()) return;

      const allRepos = snapshot.val();
      if (!allRepos || typeof allRepos !== "object") return;

      // Duyệt qua tất cả repo và push trong queue
      for (const repoId of Object.keys(allRepos)) {
        const pushes = allRepos[repoId];
        if (!pushes || typeof pushes !== "object") continue;

        for (const pushId of Object.keys(pushes)) {
          const jobData = pushes[pushId];
          if (!jobData || jobData.status !== "pending") continue;

          // Gọi callback — không await ở đây, để listener không bị block
          this.onJobDetected(repoId, pushId, jobData).catch((err) => {
            logger.error("[FirebaseListener] onJobDetected threw unexpectedly", {
              machineId: MACHINE_ID,
              repoId,
              pushId,
              error: err.message,
            });
          });
        }
      }
    };

    // Subscribe onValue — Firebase SDK tự reconnect nếu mất mạng
    ref.on("value", handleSnapshot, (err) => {
      logger.error("[FirebaseListener] Firebase onValue error", {
        machineId: MACHINE_ID,
        error: err.message,
      });
    });

    // Lưu ref để unsubscribe sau
    this._ref = ref;
    this._handler = handleSnapshot;

    logger.info("[FirebaseListener] Listener started.", { machineId: MACHINE_ID });
  }

  /**
   * Dừng lắng nghe Firebase
   */
  stop() {
    if (this._ref && this._handler) {
      this._ref.off("value", this._handler);
      logger.info("[FirebaseListener] Listener stopped.", { machineId: MACHINE_ID });
    }
  }
}

module.exports = FirebaseListener;
