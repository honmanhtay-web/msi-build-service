// Path: scripts/test-simulate-job.js
// Purpose: Tạo job test trên Firebase rồi theo dõi trạng thái đến khi done/failed/skipped
// Dependencies: dotenv, firebase-admin, process.argv
// Last Updated: 2026-04-03
//
// Cách dùng:
//   node scripts/test-simulate-job.js --repoId my-repo --repoUrl https://github.com/org/repo
//   node scripts/test-simulate-job.js --repoId my-repo --repoUrl https://github.com/org/repo --branch dev --commitSha abc123

"use strict";

require("dotenv").config();
const admin = require("firebase-admin");

const OK   = (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
const FAIL = (msg) => { console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`); process.exit(1); };
const INFO = (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
const WARN = (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);

// Parse CLI args --key value
const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    result[key] = args[i + 1] || "";
  }
  return result;
};

// Tạo pushId theo format chuẩn
const makePushId = (commitSha = "test000") => {
  const now = new Date();
  const d = now.toISOString().replace(/[-:T]/g, "").slice(0, 15);
  return `${d.slice(0, 8)}-${d.slice(8, 14)}-${commitSha.slice(0, 7)}`;
};

// Poll Firebase đợi status thay đổi khỏi pending/claimed/building
const waitForCompletion = (db, buildQueuePath, repoId, pushId, timeoutMs = 600000) => {
  return new Promise((resolve, reject) => {
    const TERMINAL = ["done", "failed", "skipped"];
    const ref = db.ref(`${buildQueuePath}/${repoId}/${pushId}`);
    let settled = false;
    let lastStatus = "";

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ref.off("value");
        reject(new Error(`Timeout after ${timeoutMs / 1000}s — job still running`));
      }
    }, timeoutMs);

    ref.on("value", (snap) => {
      if (settled) return;
      if (!snap.exists()) return;

      const data   = snap.val();
      const status = data?.status || "unknown";

      if (status !== lastStatus) {
        INFO(`Job status: ${status}`);
        lastStatus = status;
      }

      if (TERMINAL.includes(status)) {
        settled = true;
        clearTimeout(timer);
        ref.off("value");
        resolve(data);
      }
    }, (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
};

(async () => {
  const args = parseArgs();

  const repoId    = args.repoId    || "test-repo";
  const repoUrl   = args.repoUrl   || "";
  const branch    = args.branch    || "main";
  const commitSha = args.commitSha || "HEAD";

  if (!repoUrl) FAIL("--repoUrl is required. Example: --repoUrl https://github.com/org/repo");

  const buildQueuePath = process.env.FIREBASE_BUILD_QUEUE_PATH || "build-queue";
  const pushId         = makePushId(commitSha);

  INFO(`Simulating job: repoId=${repoId} pushId=${pushId}`);
  INFO(`Repo: ${repoUrl} @ ${branch} (${commitSha})\n`);

  // Init Firebase
  const databaseURL       = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!databaseURL || !serviceAccountKey) FAIL("FIREBASE_DATABASE_URL and FIREBASE_SERVICE_ACCOUNT_KEY must be set in .env");

  let parsed;
  try { parsed = JSON.parse(serviceAccountKey); } catch { FAIL("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON"); }

  admin.initializeApp({ credential: admin.credential.cert(parsed), databaseURL });
  const db = admin.database();

  // Ghi job vào Firebase
  const jobRef = db.ref(`${buildQueuePath}/${repoId}/${pushId}`);
  const jobData = {
    status:    "pending",
    claimedBy: "",
    claimedAt: 0,
    createdAt: Date.now(),
    payload: {
      repoUrl,
      branch,
      commitSha,
      triggeredAt: Date.now(),
    },
    result: {
      version:      "",
      msiFileName:  "",
      startAt:      0,
      endAt:        0,
      errorMessage: "",
      uploads: {
        s3:       { status: "pending", url: "", error: "", doneAt: 0 },
        onedrive: { status: "pending", url: "", error: "", doneAt: 0 },
        gdrive:   { status: "pending", url: "", error: "", doneAt: 0 },
        nas:      { status: "pending", url: "", error: "", doneAt: 0 },
      },
    },
  };

  await jobRef.set(jobData);
  OK(`Job created at /${buildQueuePath}/${repoId}/${pushId}`);
  INFO("Waiting for a build service to pick up the job... (Ctrl+C to abort)\n");

  // Poll đợi kết quả
  let finalData;
  try {
    finalData = await waitForCompletion(db, buildQueuePath, repoId, pushId);
  } catch (err) {
    FAIL(`${err.message}`);
  }

  const status = finalData?.status;
  const result = finalData?.result || {};

  console.log("");
  if (status === "done") {
    OK(`Job done! version=${result.version} msi=${result.msiFileName}`);
    // In upload results
    const uploads = result.uploads || {};
    for (const [target, u] of Object.entries(uploads)) {
      if (u.status === "done")    OK(`  Upload[${target}]: done → ${u.url}`);
      else if (u.status === "skipped") WARN(`  Upload[${target}]: skipped (file already exists)`);
      else if (u.status === "failed")  WARN(`  Upload[${target}]: failed — ${u.error}`);
    }
  } else if (status === "skipped") {
    WARN("Job skipped — MSI already exists on all storage targets");
  } else {
    FAIL(`Job failed: ${result.errorMessage || "unknown error"}`);
  }

  process.exit(0);
})();
