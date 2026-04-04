"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const data = require("./mock-data.json");
const PORT = Number(process.env.MOCK_SERVER_PORT || 4311);
const STATE = { uploaded: new Set() };

const send = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
};

const readBody = (req) => {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
};

const ensureMockRepo = (repoId) => {
  const root = path.resolve(__dirname, "..", "..", ".mock-workdirs");
  const dir = path.join(root, repoId || "mock-repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# mock repo\n", "utf8");
  fs.writeFileSync(path.join(dir, "index.js"), "console.log('mock app');\n", "utf8");
  return dir;
};

const ensureMockMsi = (pushId) => {
  const outDir = path.resolve(__dirname, "..", "..", ".mock-artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const file = `${pushId || "mock-push"}-${data.build.msiFileName}`;
  const filePath = path.join(outDir, file);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.alloc(512 * 1024, 7));
  }
  return { file, filePath };
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, name: "mock-server" });
    }

    if (req.method === "POST" && req.url === "/firebase/connection-test") {
      return send(res, 200, { ok: true, path: "build-queue", projectId: "mock-project" });
    }

    if (req.method === "POST" && req.url === "/simulate-job") {
      const body = await readBody(req);
      const commitSha = body.commitSha || data.repo.commitSha;
      const pushId = `mock-${String(commitSha).slice(0, 7)}`;
      return send(res, 200, {
        repoId: body.repoId || data.repo.repoId,
        pushId,
        status: "done",
        result: {
          version: data.build.version,
          msiFileName: data.build.msiFileName,
          uploads: {
            s3: { status: "done", url: data.uploads.s3 },
            onedrive: { status: "done", url: data.uploads.onedrive },
            gdrive: { status: "done", url: data.uploads.gdrive },
            nas: { status: "done", url: data.uploads.nas }
          }
        }
      });
    }

    if (req.method === "POST" && req.url === "/clone") {
      const body = await readBody(req);
      const workDir = ensureMockRepo(body.repoId);
      return send(res, 200, { workDir, head: body.commitSha || data.repo.commitSha });
    }

    if (req.method === "POST" && req.url === "/build") {
      const body = await readBody(req);
      const out = ensureMockMsi(body.pushId);
      return send(res, 200, {
        version: data.build.version,
        msiFileName: out.file,
        msiFilePath: out.filePath,
        assemblyMeta: {
          productName: "Mock App",
          fileVersion: data.build.version,
          productVersion: data.build.version,
          sha256: "mock-sha256"
        }
      });
    }

    if (req.method === "POST" && req.url === "/upload/check-exists") {
      const body = await readBody(req);
      return send(res, 200, { exists: STATE.uploaded.has(`${body.adapter}:${body.fileName}`) });
    }

    if (req.method === "POST" && req.url === "/upload") {
      const body = await readBody(req);
      const key = `${body.adapter}:${body.fileName}`;
      STATE.uploaded.add(key);
      const base = data.uploads[body.adapter] || "https://mock-upload.local/artifacts";
      return send(res, 200, {
        url: `${base.replace(/\/$/, "")}/${body.fileName}`,
        size: body.size || 0
      });
    }

    if (req.method === "POST" && req.url === "/service/install") return send(res, 200, { ok: true });
    if (req.method === "POST" && req.url === "/service/uninstall") return send(res, 200, { ok: true });

    return send(res, 404, { error: "Not found" });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-server] listening on http://127.0.0.1:${PORT}`);
});
