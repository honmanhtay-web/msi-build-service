// Path: scripts/test-clone.js
// Purpose: Test CloneManager độc lập — clone/fetch repo và in kết quả
// Dependencies: dotenv, src/git/CloneManager
// Last Updated: 2026-04-03
//
// Cách dùng:
//   node scripts/test-clone.js --repoId my-repo --repoUrl https://github.com/org/repo
//   node scripts/test-clone.js --repoId my-repo --repoUrl https://github.com/org/repo --branch dev --commitSha abc123

"use strict";

require("dotenv").config();
const path = require("path");
const fs   = require("fs");

const CloneManager = require("../src/git/CloneManager");

const OK   = (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
const FAIL = (msg) => { console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`); process.exit(1); };
const INFO = (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    result[args[i].replace(/^--/, "")] = args[i + 1] || "";
  }
  return result;
};

(async () => {
  const args      = parseArgs();
  const repoId    = args.repoId    || "test-clone-repo";
  const repoUrl   = args.repoUrl   || "";
  const branch    = args.branch    || "main";
  const commitSha = args.commitSha || "HEAD";

  if (!repoUrl) FAIL("--repoUrl is required");

  INFO(`Testing CloneManager`);
  INFO(`repoId=${repoId} repoUrl=${repoUrl} branch=${branch} commitSha=${commitSha}\n`);

  const serviceConfig = require("../config/service.config.json");
  const workDirsRoot  = serviceConfig.git?.workDirsRoot || ".work-dirs";

  const cloner = new CloneManager({ workDirsRoot });

  const t0 = Date.now();
  let workDir;
  try {
    workDir = await cloner.syncRepo({ repoId, repoUrl, branch, commitSha });
  } catch (err) {
    FAIL(`CloneManager.syncRepo failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  OK(`Clone/fetch done in ${elapsed}s`);
  OK(`workDir: ${workDir}`);

  // Kiểm tra thư mục tồn tại
  if (!fs.existsSync(workDir)) FAIL(`workDir does not exist: ${workDir}`);
  OK("workDir exists");

  // Kiểm tra .git folder
  if (!fs.existsSync(path.join(workDir, ".git"))) FAIL(".git not found in workDir");
  OK(".git directory present");

  // Đếm số file
  const countFiles = (dir) => {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === ".git") continue;
      if (e.isDirectory()) count += countFiles(path.join(dir, e.name));
      else count++;
    }
    return count;
  };

  const fileCount = countFiles(workDir);
  OK(`Files in workDir (excluding .git): ${fileCount}`);

  // Kiểm tra HEAD commit
  const { spawnSync } = require("child_process");
  const headResult = spawnSync("git", ["-C", workDir, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (headResult.status === 0) {
    OK(`HEAD commit: ${headResult.stdout.trim()}`);
  }

  console.log("\n\x1b[32mCloneManager test passed.\x1b[0m");
  process.exit(0);
})();
