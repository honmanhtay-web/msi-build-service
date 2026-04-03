// Path: src/git/CloneManager.js
// Purpose: Clone repo lần đầu (shallow) hoặc fetch incremental lần sau — cache tại .work-dirs/
// Dependencies: child_process, fs, path, utils/logger, utils/machineId, utils/pathUtils
// Last Updated: 2026-04-03

"use strict";

const { spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const logger    = require("../utils/logger");
const { MACHINE_ID } = require("../utils/machineId");
const { isDir, ensureDir } = require("../utils/pathUtils");

/**
 * CloneManager
 *
 * Chiến lược:
 *   - Lần đầu: shallow clone (--depth=1 --filter=blob:none) → checkout
 *   - Lần sau: cập nhật remote URL (có token mới) → fetch --depth=1 → reset --hard
 *   - Nếu fetch/reset fail → xóa cache → clone lại (1 lần retry duy nhất)
 *   - Nếu clone lại vẫn fail → throw để job được đánh dấu failed
 *
 * Auth:
 *   - Inject GIT_TOKEN vào URL: https://{user}:{token}@github.com/org/repo.git
 *   - Cập nhật remote origin URL mỗi lần fetch để token luôn mới
 *   - Không lưu credential vào global git config
 */
class CloneManager {
  /**
   * @param {object} options
   * @param {string} options.workDirsRoot - thư mục gốc chứa clone cache, default ".work-dirs"
   */
  constructor(options = {}) {
    this.workDirsRoot = path.resolve(
      process.env.GIT_WORK_DIRS_ROOT || options.workDirsRoot || ".work-dirs"
    );
  }

  /**
   * Sync repo về local (clone hoặc fetch) rồi checkout đúng commit.
   * @param {object} params
   * @param {string} params.repoId    - định danh repo (dùng làm tên thư mục cache)
   * @param {string} params.repoUrl   - URL gốc (không có token)
   * @param {string} params.branch    - branch cần checkout
   * @param {string} params.commitSha - commit SHA để reset --hard
   * @returns {Promise<string>} absolute path tới workDir đã checkout
   */
  async syncRepo({ repoId, repoUrl, branch, commitSha }) {
    const ctx = { machineId: MACHINE_ID, repoId, branch, commitSha };
    ensureDir(this.workDirsRoot);

    const workDir  = path.join(this.workDirsRoot, repoId);
    const authUrl  = this._injectAuth(repoUrl);

    logger.info("[CloneManager] syncRepo start", ctx);

    const isExisting = this._isGitRepo(workDir);

    if (isExisting) {
      // ✅ FIX: Cập nhật remote URL với token mới trước khi fetch
      this._setRemoteUrl(workDir, authUrl, ctx);

      // Thử incremental fetch
      const fetchOk = this._tryFetch(workDir, branch, ctx);
      if (!fetchOk) {
        logger.warn("[CloneManager] Fetch failed — wiping cache and re-cloning", ctx);
        this._wipeDir(workDir);
        this._doClone(authUrl, workDir, branch, ctx);
      }
    } else {
      // Lần đầu
      this._doClone(authUrl, workDir, branch, ctx);
    }

    // Reset về đúng commitSha
    this._resetHard(workDir, commitSha, ctx);

    logger.info("[CloneManager] syncRepo done", { ...ctx, workDir });
    return workDir;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Kiểm tra thư mục đã có git repo hợp lệ chưa
   */
  _isGitRepo(dir) {
    if (!isDir(dir)) return false;
    const result = spawnSync("git", ["-C", dir, "rev-parse", "--git-dir"], {
      stdio: "pipe", encoding: "utf8",
    });
    return result.status === 0;
  }

  /**
   * Cập nhật remote origin URL — đảm bảo token luôn mới với mỗi lần sync
   * ✅ FIX: Thêm method này để giải quyết vấn đề token expire khi fetch incremental
   */
  _setRemoteUrl(workDir, authUrl, ctx) {
    try {
      this._exec(["git", "-C", workDir, "remote", "set-url", "origin", authUrl], {
        ctx,
        label: "git remote set-url",
      });
    } catch (err) {
      // Không throw — nếu fail thì fetch vẫn sẽ dùng URL cũ
      logger.warn("[CloneManager] Could not update remote URL", { ...ctx, error: err.message });
    }
  }

  /**
   * Shallow clone với sparse-checkout để bỏ qua binary lớn
   */
  _doClone(authUrl, workDir, branch, ctx) {
    logger.info("[CloneManager] Cloning repo (shallow)...", ctx);

    // Tạo thư mục trước
    ensureDir(workDir);

    // Clone shallow, không checkout ngay — chờ sparse-checkout setup
    this._exec([
      "git", "clone",
      "--depth=1",
      "--filter=blob:none",
      "--no-checkout",
      "--branch", branch,
      authUrl,
      workDir,
    ], { cwd: this.workDirsRoot, ctx, label: "git clone" });

    // Sparse-checkout: lấy tất cả (không giới hạn path cụ thể)
    this._exec(["git", "-C", workDir, "sparse-checkout", "init", "--cone"],
      { ctx, label: "sparse-checkout init" });

    this._exec(["git", "-C", workDir, "sparse-checkout", "set", "."],
      { ctx, label: "sparse-checkout set" });

    logger.info("[CloneManager] Clone done", ctx);
  }

  /**
   * Incremental fetch
   * @returns {boolean} true nếu fetch thành công
   */
  _tryFetch(workDir, branch, ctx) {
    logger.info("[CloneManager] Fetching incremental...", ctx);
    try {
      this._exec(
        ["git", "-C", workDir, "fetch", "origin", `${branch}`, "--depth=1", "--no-tags"],
        { ctx, label: "git fetch" }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reset --hard về commitSha để đảm bảo đúng commit
   */
  _resetHard(workDir, commitSha, ctx) {
    logger.info("[CloneManager] Resetting to commit...", { ...ctx, commitSha });
    // Checkout trước (nếu sparse-checkout chưa checkout)
    this._exec(["git", "-C", workDir, "checkout", "--force"],
      { ctx, label: "git checkout" });

    this._exec(["git", "-C", workDir, "reset", "--hard", commitSha],
      { ctx, label: "git reset --hard" });
  }

  /**
   * Xóa toàn bộ workDir để clone lại từ đầu
   */
  _wipeDir(workDir) {
    logger.warn("[CloneManager] Wiping workDir", { machineId: MACHINE_ID, workDir });
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  /**
   * Inject GIT_TOKEN vào URL
   * Input:  https://github.com/org/repo
   * Output: https://user:token@github.com/org/repo
   */
  _injectAuth(repoUrl) {
    const token    = process.env.GIT_TOKEN    || "";
    const username = process.env.GIT_USERNAME || "oauth2";

    if (!token) {
      logger.warn("[CloneManager] GIT_TOKEN not set — attempting unauthenticated clone", {
        machineId: MACHINE_ID,
      });
      return repoUrl;
    }

    return repoUrl.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(username)}:${encodeURIComponent(token)}@`);
  }

  /**
   * Chạy lệnh đồng bộ — throw nếu exit code != 0
   */
  _exec(args, { cwd = undefined, ctx = {}, label = "" } = {}) {
    const [cmd, ...rest] = args;
    const result = spawnSync(cmd, rest, {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env },
    });

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    if (result.status !== 0) {
      const safeStderr = this._redactToken(stderr);
      const msg = `[CloneManager] '${label}' failed (exit ${result.status}): ${safeStderr}`;
      logger.error(msg, ctx);
      throw new Error(msg);
    }

    if (stdout) {
      logger.debug(`[CloneManager] ${label}: ${this._redactToken(stdout)}`, ctx);
    }
  }

  /**
   * Ẩn token trong string log để không lộ credential
   */
  _redactToken(str) {
    const token = process.env.GIT_TOKEN;
    if (!token || !str) return str;
    return str.split(token).join("***");
  }
}

module.exports = CloneManager;
