// Path: src/index.js
// Purpose: Entry point — khởi động service, wire tất cả modules, xử lý graceful shutdown
// Dependencies: dotenv, firebase-admin, tất cả modules trong src/
// Last Updated: 2026-04-03

"use strict";

// Load env trước tất cả — phải là dòng đầu tiên
require("dotenv").config();

const path = require("path");
const admin = require("firebase-admin");

const logger = require("./utils/logger");
const { MACHINE_ID } = require("./utils/machineId");
const { ensureDir } = require("./utils/pathUtils");

const FirebaseListener = require("./firebase/FirebaseListener");
const JobClaimer       = require("./firebase/JobClaimer");
const StatusReporter   = require("./firebase/StatusReporter");
const DbCleanup        = require("./cleanup/DbCleanup");
const JobQueue         = require("./queue/JobQueue");

// ─── Load config ──────────────────────────────────────────────────────────────
const configPath = path.resolve(__dirname, "../config/service.config.json");
const serviceConfig = require(configPath);

// Merge env vào config (env override config file)
const config = {
  buildQueuePath: process.env.FIREBASE_BUILD_QUEUE_PATH || serviceConfig.firebase.buildQueuePath,
  advinst: serviceConfig.advinst,
  git: serviceConfig.git,
  build: {
    ...serviceConfig.build,
    maxConcurrent: parseInt(process.env.BUILD_MAX_CONCURRENT) || serviceConfig.build.maxConcurrent,
    outputDirRoot: serviceConfig.build.outputDirRoot,
  },
  upload: serviceConfig.upload,
  cleanup: serviceConfig.cleanup,
};

// ─── Khởi tạo thư mục cần thiết ──────────────────────────────────────────────
ensureDir(path.resolve(serviceConfig.git.workDirsRoot));
ensureDir(path.resolve(serviceConfig.build.outputDirRoot));
ensureDir(path.resolve(serviceConfig.logging.dir || "logs"));

// ─── Khởi tạo Firebase Admin SDK ──────────────────────────────────────────────
const initFirebase = () => {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!databaseURL) throw new Error("FIREBASE_DATABASE_URL is required in .env");
  if (!serviceAccountKey) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is required in .env");

  let credential;
  try {
    const parsed = JSON.parse(serviceAccountKey);
    credential = admin.credential.cert(parsed);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }

  admin.initializeApp({ credential, databaseURL });
  return admin.database();
};

// ─── Khởi động service ────────────────────────────────────────────────────────
const main = async () => {
  logger.info("=== MSI Build Service Starting ===", { machineId: MACHINE_ID });

  // 1. Khởi tạo Firebase
  let db;
  try {
    db = initFirebase();
    logger.info("[Main] Firebase initialized", { machineId: MACHINE_ID });
  } catch (err) {
    logger.error("[Main] Firebase init failed — service cannot start", { machineId: MACHINE_ID, error: err.message });
    process.exit(1);
  }

  // 2. Khởi tạo modules
  const claimer  = new JobClaimer(db, config);
  const queue    = new JobQueue({ maxConcurrent: config.build.maxConcurrent });
  const cleanup  = new DbCleanup(db, config);

  // 3. Callback khi phát hiện job pending
  const onJobDetected = async (repoId, pushId, jobData) => {
    // Thử claim — nếu thua race thì bỏ qua
    const claimed = await claimer.claim(repoId, pushId);
    if (!claimed) return;

    const reporter = new StatusReporter(db, config, repoId, pushId);
    const label = `${repoId}/${pushId}`;

    // Đẩy vào queue — sẽ chạy khi còn slot
    queue.enqueue(async () => {
      logger.info("[Main] Processing job", { machineId: MACHINE_ID, repoId, pushId });
      try {
        await reporter.setBuilding();

        // ─── Các bước build sẽ được implement ở các giai đoạn tiếp theo ───────
        // Giai đoạn 2: CloneManager.syncRepo(jobData.payload)
        // Giai đoạn 3: AssemblyReader + AdvinstBuilder
        // Giai đoạn 4: UploadManager

        // Placeholder — remove khi implement đầy đủ
        logger.warn("[Main] Build pipeline not yet implemented — placeholder job", {
          machineId: MACHINE_ID, repoId, pushId,
        });
        await reporter.setFailed("Build pipeline not yet implemented");

      } catch (err) {
        logger.error("[Main] Job failed with uncaught error", {
          machineId: MACHINE_ID, repoId, pushId, error: err.message,
        });
        await reporter.setFailed(err.message);
      }
    }, label);
  };

  // 4. Khởi động listener
  const listener = new FirebaseListener(db, config, onJobDetected);
  listener.start();

  // 5. Khởi động cleanup
  cleanup.start();

  logger.info("=== MSI Build Service Running ===", {
    machineId: MACHINE_ID,
    maxConcurrent: config.build.maxConcurrent,
    buildQueuePath: config.buildQueuePath,
  });

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`[Main] Received ${signal} — shutting down gracefully...`, { machineId: MACHINE_ID });
    listener.stop();
    cleanup.stop();
    // Đợi tối đa 30 giây cho các job đang chạy hoàn tất
    let waited = 0;
    while (queue.runningCount > 0 && waited < 30000) {
      logger.info(`[Main] Waiting for ${queue.runningCount} running job(s) to finish...`, { machineId: MACHINE_ID });
      await new Promise((r) => setTimeout(r, 2000));
      waited += 2000;
    }
    if (queue.runningCount > 0) {
      logger.warn(`[Main] Force shutdown with ${queue.runningCount} job(s) still running`, { machineId: MACHINE_ID });
    }
    logger.info("[Main] Service stopped.", { machineId: MACHINE_ID });
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Bắt unhandled rejection để không crash service
  process.on("unhandledRejection", (reason) => {
    logger.error("[Main] Unhandled promise rejection", {
      machineId: MACHINE_ID,
      reason: reason?.message || String(reason),
    });
  });
};

main();
