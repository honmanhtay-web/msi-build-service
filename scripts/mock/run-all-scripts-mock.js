"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const SERVER_PORT = Number(process.env.MOCK_SERVER_PORT || 4311);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const LOGS_DIR = path.join(ROOT, "scripts", "mock", "logs", RUN_ID);
const LATEST_DIR = path.join(ROOT, "scripts", "mock", "logs", "latest");

const runNode = (file, args = [], extraEnv = {}) => {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: ROOT,
      env: { ...process.env, MOCK_MODE: "true", MOCK_SERVER_URL: SERVER_URL, ...extraEnv },
      stdio: "pipe",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ code, out, err }));
  });
};

const waitForServer = (serverProc) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Mock server start timeout")), 5000);
    serverProc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Mock server exited unexpectedly: ${code}`));
    });
  });
};

(async () => {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.mkdirSync(LATEST_DIR, { recursive: true });
  const server = spawn(process.execPath, [path.join("scripts", "mock", "mock-server.js")], {
    cwd: ROOT,
    env: { ...process.env, MOCK_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(server);
    const workDir = path.join(ROOT, ".mock-workdirs", "mock-repo");
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const tests = [
      { file: "scripts/test-firebase-connection.js", args: [] },
      { file: "scripts/test-simulate-job.js", args: ["--repoId", "mock-repo", "--repoUrl", "https://github.com/example/mock-repo"] },
      { file: "scripts/test-clone.js", args: ["--repoId", "mock-repo", "--repoUrl", "https://github.com/example/mock-repo"] },
      { file: "scripts/test-advinst-build.js", args: ["--workDir", workDir, "--repoId", "mock-repo", "--pushId", "mock-push"] },
      { file: "scripts/test-upload.js", args: [] },
      { file: "scripts/install-windows-service.js", args: [] },
      { file: "scripts/uninstall-windows-service.js", args: [] },
    ];

    let failed = 0;
    console.log(`Running ${tests.length} script tests in mock mode...`);
    console.log(`Logs directory: ${LOGS_DIR}\n`);
    for (const t of tests) {
      const result = await runNode(t.file, t.args);
      const tag = result.code === 0 ? "[PASS]" : "[FAIL]";
      console.log(`${tag} node ${t.file} ${t.args.join(" ")}`.trim());
      if (result.code !== 0) failed++;

      const logName = t.file
        .replace(/^scripts\//, "")
        .replace(/[\/\\]/g, "__")
        .replace(/\.js$/, ".txt");
      const logPath = path.join(LOGS_DIR, logName);
      const latestPath = path.join(LATEST_DIR, logName);
      const logBody = [
        `command: node ${t.file} ${t.args.join(" ")}`.trim(),
        `exitCode: ${result.code}`,
        "----- stdout -----",
        result.out.trim() || "(empty)",
        "----- stderr -----",
        result.err.trim() || "(empty)",
        ""
      ].join("\n");
      fs.writeFileSync(logPath, logBody, "utf8");
      fs.writeFileSync(latestPath, logBody, "utf8");
      console.log(`log: ${logPath}`);

      if (result.out.trim()) console.log(result.out.trim());
      if (result.err.trim()) console.error(result.err.trim());
      console.log("");
    }

    if (failed > 0) {
      console.error(`Mock test suite failed: ${failed} script(s) failed.`);
      process.exit(1);
    }
    console.log("Mock test suite passed for all scripts/*.js files.");
    process.exit(0);
  } finally {
    server.kill("SIGTERM");
  }
})();
