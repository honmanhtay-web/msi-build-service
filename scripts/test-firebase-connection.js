// Path: scripts/test-firebase-connection.js
// Purpose: Kiểm tra kết nối Firebase và quyền đọc/ghi build-queue
// Dependencies: dotenv, firebase-admin
// Last Updated: 2026-04-03

"use strict";

require("dotenv").config();
const admin = require("firebase-admin");

const OK   = (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
const FAIL = (msg) => { console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`); process.exit(1); };
const INFO = (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);

(async () => {
  INFO("Testing Firebase connection...\n");

  // 1. Kiểm tra env vars bắt buộc
  const databaseURL       = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const buildQueuePath    = process.env.FIREBASE_BUILD_QUEUE_PATH || "build-queue";

  if (!databaseURL)       FAIL("FIREBASE_DATABASE_URL is not set in .env");
  if (!serviceAccountKey) FAIL("FIREBASE_SERVICE_ACCOUNT_KEY is not set in .env");
  OK("Env vars present");

  // 2. Parse service account key
  let parsed;
  try {
    parsed = JSON.parse(serviceAccountKey);
  } catch {
    FAIL("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  OK(`Service account parsed: project_id=${parsed.project_id}`);

  // 3. Init Firebase
  let db;
  try {
    admin.initializeApp({
      credential:   admin.credential.cert(parsed),
      databaseURL,
    });
    db = admin.database();
    OK("Firebase Admin SDK initialized");
  } catch (err) {
    FAIL(`Firebase init failed: ${err.message}`);
  }

  // 4. Kiểm tra đọc build-queue
  try {
    const snap = await db.ref(buildQueuePath).limitToFirst(1).get();
    OK(`Build queue accessible at /${buildQueuePath} (exists=${snap.exists()})`);
  } catch (err) {
    FAIL(`Cannot read /${buildQueuePath}: ${err.message}`);
  }

  // 5. Kiểm tra ghi (write test record rồi xóa ngay)
  const testRef = db.ref(`${buildQueuePath}/__connection-test__`);
  try {
    await testRef.set({ _test: true, ts: Date.now() });
    OK("Write test: success");
    await testRef.remove();
    OK("Delete test: success");
  } catch (err) {
    FAIL(`Write/delete test failed: ${err.message}`);
  }

  console.log("\n\x1b[32mAll checks passed — Firebase is ready.\x1b[0m");
  process.exit(0);
})();
