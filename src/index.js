// Path: src/index.js
// Purpose: Entry point — khởi động service, wire tất cả modules, xử lý graceful shutdown
// Dependencies: dotenv, firebase-admin, tất cả modules trong src/
// Last Updated: 2026-04-03

"use strict";

// Load env trước tất cả — phải là dòng đầu tiên
require("dotenv").config();

const path  = require("path");
const admin = require("firebase-admin");

const logger         = require("./utils/logger");
const { MACHINE_ID } = require("./utils/machineId");
const { ensureDir }  = require("./utils/pathUtils");

const FirebaseListener = require("./firebase/FirebaseListener");
const JobClaimer       = require("./firebase/JobClaimer");
const StatusReporter   = require("./firebase/StatusReporter");
const DbCleanup        = require("./cleanup/DbCleanup");
const JobQueue         = require("./queue/JobQueue");

const CloneManager     = require("./git/CloneManager");
const AssemblyReader   = require("./assembly/AssemblyReader");
const AdvinstBuilder   = require("./advinst/AdvinstBuilder");
const ConfigResolver   = require("./advinst/ConfigResolver");
const UploadManager    = require("./upload/UploadManager");

// ─── Load config ──────────────────────────────────────────────────────────────
const configPath    = path.resolve(__dirname, "../config/service.config.json");
const serviceConfig = require(configPath);

// Merge env vào config (env override config file)
const config = {
  buildQueuePath: process.env.FIREBASE_BUILD_QUEUE_PATH || serviceConfig.firebase.buildQueuePath,
  advinst:        serviceConfig.advinst,
  git:            serviceConfig.git,
  build: {
    ...serviceConfig.build,
    maxConcurrent: parseInt(process.env.BUILD_MAX_CONCURRENT) || serviceConfig.build.maxConcurrent,
    outputDirRoot: serviceConfig.build.outputDirRoot,
  },
  upload:  serviceConfig.upload,
  cleanup: serviceConfig.cleanup,
};

// ─── Khởi tạo thư mục cần thiết ──────────────────────────────────────────────
ensureDir(path.resolve(serviceConfig.git.workDirsRoot));
ensureDir(path.resolve(serviceConfig.build.outputDirRoot));
ensureDir(path.resolve(serviceConfig.logging.dir || "logs"));

// ─── Khởi tạo Firebase Admin SDK ─────────────────────────────────────────────
const initFirebase = () => {
  const databaseURL       = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!databaseURL)       throw new Error("FIREBASE_DATABASE_URL is required in .env");
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

// ─── Build pipeline cho 1 job ────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {string} params.repoId
 * @param {string} params.pushId
 * @param {object} params.jobData   - toàn bộ record Firebase
 * @param {object} params.reporter  - StatusReporter instance
 */
const runBuildPipeline = async ({ repoId, pushId, jobData, reporter }) => {
  const ctx = { machineId: MACHINE_ID, repoId, pushId };

  const payload = jobData.payload || {};
  const repoUrl   = payload.repoUrl   || "";
  const branch    = payload.branch    || "main";
  const commitSha = payload.commitSha || "HEAD";

  if (!repoUrl) {
    throw new Error("payload.repoUrl is missing in job data");
  }

  // ── Step 1: Clone / fetch repo ────────────────────────────────────────────
  logger.info("[Pipeline] Step 1: CloneManager", ctx);
  const cloner  = new CloneManager({ workDirsRoot: serviceConfig.git.workDirsRoot });
  const workDir = await cloner.syncRepo({ repoId, repoUrl, branch, commitSha });

  // ── Step 2: Pre-build skip check ──────────────────────────────────────────
  // Resolve config sơ bộ (không có assemblyMeta) để lấy tentative msiFileName.
  // Nếu project đặt msiFileName cố định trong .aip.json thì check này chính xác 100%.
  // Nếu filename có version từ exe thì filename tentative dùng fallback "1.0.0.0" —
  // trường hợp này check có thể không khớp, chấp nhận build thêm 1 lần.
  logger.info("[Pipeline] Step 2: Pre-build skip check", ctx);
  const uploader = new UploadManager(serviceConfig);
  const resolver = new ConfigResolver(serviceConfig);

  let tentativeMsiFileName = null;
  try {
    const tentative = await resolver.resolve({
      workDir,
      buildOutputDir: "",
      assemblyMeta: null,
    });
    tentativeMsiFileName = tentative.msiFileName;

    const allExist = await uploader.checkAllExist(tentativeMsiFileName);
    if (allExist) {
      logger.info("[Pipeline] All targets already have the MSI — marking job as skipped", {
        ...ctx, msiFileName: tentativeMsiFileName,
      });
      await reporter.setSkipped();
      return;
    }
  } catch (err) {
    // Nếu resolve hoặc check lỗi (vd: advinst.exe chưa có, adapter chưa config) → tiếp tục build
    logger.warn("[Pipeline] Pre-build check failed — proceeding with build", {
      ...ctx, error: err.message,
    });
  }

  // ── Step 3: Build MSI ─────────────────────────────────────────────────────
  logger.info("[Pipeline] Step 3: AdvinstBuilder", ctx);
  const builder    = new AdvinstBuilder(serviceConfig);
  const buildResult = await builder.build({ repoId, pushId, workDir });

  const { msiFilePath, msiFileName, version } = buildResult;

  // ── Step 4: Upload song song ───────────────────────────────────────────────
  logger.info("[Pipeline] Step 4: UploadManager", ctx);
  const { allSkipped } = await uploader.uploadAll({
    msiFilePath,
    msiFileName,
    meta: { repoId, pushId, version },
    statusReporter: reporter,
  });

  // ── Step 5: Done / Skipped ────────────────────────────────────────────────
  // allSkipped = true khi file đã có trên tất cả adapters (build xong nhưng tất cả upload bị skip)
  if (allSkipped) {
    logger.info("[Pipeline] All uploads skipped (file already existed on all targets)", ctx);
    await reporter.setSkipped();
  } else {
    await reporter.setDone({ version, msiFileName });
    logger.info("[Pipeline] Job completed successfully", { ...ctx, version, msiFileName });
  }
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
    logger.error("[Main] Firebase init failed — service cannot start", {
      machineId: MACHINE_ID, error: err.message,
    });
    process.exit(1);
  }

  // 2. Khởi tạo modules
  const claimer = new JobClaimer(db, config);
  const queue   = new JobQueue({ maxConcurrent: config.build.maxConcurrent });
  const cleanup = new DbCleanup(db, config);

  // 3. Callback khi phát hiện job pending
  const onJobDetected = async (repoId, pushId, jobData) => {
    // Thử claim — nếu thua race thì bỏ qua
    const claimed = await claimer.claim(repoId, pushId);
    if (!claimed) return;

    const reporter = new StatusReporter(db, config, repoId, pushId);
    const label    = `${repoId}/${pushId}`;

    // Đẩy vào queue — chạy khi còn slot
    queue.enqueue(async () => {
      logger.info("[Main] Processing job", { machineId: MACHINE_ID, repoId, pushId });
      try {
        await reporter.setBuilding();
        await runBuildPipeline({ repoId, pushId, jobData, reporter });
      } catch (err) {
        logger.error("[Main] Job failed", {
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
    machineId:      MACHINE_ID,
    maxConcurrent:  config.build.maxConcurrent,
    buildQueuePath: config.buildQueuePath,
  });

  // ─── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`[Main] Received ${signal} — shutting down gracefully...`, { machineId: MACHINE_ID });
    listener.stop();
    cleanup.stop();

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

  process.on("unhandledRejection", (reason) => {
    logger.error("[Main] Unhandled promise rejection", {
      machineId: MACHINE_ID,
      reason: reason?.message || String(reason),
    });
  });
};

main();
