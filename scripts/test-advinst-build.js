// Path: scripts/test-advinst-build.js
// Purpose: Test AdvinstBuilder độc lập — nhận workDir đã có sẵn, build MSI và in kết quả
// Dependencies: dotenv, src/advinst/AdvinstBuilder
// Last Updated: 2026-04-03
//
// Cách dùng:
//   node scripts/test-advinst-build.js --workDir C:\path\to\repo --repoId my-repo --pushId test-001
//   node scripts/test-advinst-build.js --workDir .work-dirs\my-repo --repoId my-repo --pushId test-001

"use strict";

require("dotenv").config();
const path = require("path");
const fs   = require("fs");

const AdvinstBuilder = require("../src/advinst/AdvinstBuilder");

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
  const args    = parseArgs();
  const workDir = args.workDir ? path.resolve(args.workDir) : "";
  const repoId  = args.repoId  || "test-repo";
  const pushId  = args.pushId  || `test-${Date.now()}`;

  if (!workDir) FAIL("--workDir is required. Run test-clone.js first to get a workDir.");
  if (!fs.existsSync(workDir)) FAIL(`workDir does not exist: ${workDir}`);

  INFO(`Testing AdvinstBuilder`);
  INFO(`workDir=${workDir}`);
  INFO(`repoId=${repoId} pushId=${pushId}\n`);

  const serviceConfig = require("../config/service.config.json");

  // Kiểm tra advinst.exe trước
  const { ConfigResolver } = require("../src/advinst/ConfigResolver");
  const resolver = new ConfigResolver(serviceConfig);
  let advinstExePath;
  try {
    advinstExePath = resolver.detectAdvinstExe(workDir);
    OK(`advinst.exe found: ${advinstExePath}`);
  } catch (err) {
    FAIL(`advinst.exe not found: ${err.message}`);
  }

  // Chạy build
  const builder = new AdvinstBuilder(serviceConfig);
  const t0 = Date.now();

  let result;
  try {
    result = await builder.build({ repoId, pushId, workDir });
  } catch (err) {
    FAIL(`AdvinstBuilder.build failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  OK(`Build completed in ${elapsed}s`);
  OK(`version:     ${result.version}`);
  OK(`msiFileName: ${result.msiFileName}`);
  OK(`msiFilePath: ${result.msiFilePath}`);

  if (!fs.existsSync(result.msiFilePath)) FAIL(`MSI file not found at: ${result.msiFilePath}`);
  const sizeMB = (fs.statSync(result.msiFilePath).size / 1024 / 1024).toFixed(2);
  OK(`MSI size: ${sizeMB} MB`);

  if (result.assemblyMeta) {
    INFO(`\nAssembly metadata:`);
    INFO(`  productName:    ${result.assemblyMeta.productName}`);
    INFO(`  fileVersion:    ${result.assemblyMeta.fileVersion}`);
    INFO(`  productVersion: ${result.assemblyMeta.productVersion}`);
    INFO(`  sha256:         ${result.assemblyMeta.sha256}`);
  }

  console.log("\n\x1b[32mAdvinstBuilder test passed.\x1b[0m");
  process.exit(0);
})();
