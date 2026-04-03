// Path: src/upload/adapters/SynologyAdapter.js
// Purpose: Upload file MSI lên Synology NAS qua DSM File Station Web API
// Dependencies: axios, form-data, fs, path, BaseAdapter
// Last Updated: 2026-04-03

"use strict";

const fs       = require("fs");
const path     = require("path");
const axios    = require("axios");
const FormData = require("form-data");

const BaseAdapter = require("./BaseAdapter");

/**
 * SynologyAdapter
 *
 * Dùng Synology DSM File Station API:
 *   - POST /webapi/auth.cgi → lấy session token (SID)
 *   - GET  /webapi/entry.cgi?api=SYNO.FileStation.List → checkExists
 *   - POST /webapi/entry.cgi?api=SYNO.FileStation.Upload → upload
 *   - POST /webapi/auth.cgi?method=logout → logout
 *
 * Env vars (prefix UPLOAD_NAS_):
 *   UPLOAD_NAS_ENABLED       - "true" để bật
 *   UPLOAD_NAS_BASE_URL      - URL cơ sở DSM, ví dụ "http://192.168.1.100:5000"
 *   UPLOAD_NAS_USERNAME      - username đăng nhập DSM
 *   UPLOAD_NAS_PASSWORD      - password
 *   UPLOAD_NAS_SHARE_FOLDER  - đường dẫn thư mục share, ví dụ "/MSI-Releases"
 */
class SynologyAdapter extends BaseAdapter {
  constructor(config = {}) {
    super();
    this.baseUrl     = (process.env.UPLOAD_NAS_BASE_URL     || config.baseUrl     || "").replace(/\/$/, "");
    this.username    = process.env.UPLOAD_NAS_USERNAME       || config.username    || "";
    this.password    = process.env.UPLOAD_NAS_PASSWORD       || config.password    || "";
    this.shareFolder = process.env.UPLOAD_NAS_SHARE_FOLDER   || config.shareFolder || "/MSI-Releases";
  }

  getName() { return "nas"; }

  async checkExists(msiFileName) {
    const sid = await this._login();
    try {
      const resp = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api:       "SYNO.FileStation.List",
          version:   "2",
          method:    "getinfo",
          path:      `${this.shareFolder}/${msiFileName}`,
          _sid:      sid,
        },
        timeout: 15000,
      });

      const data = resp.data;
      if (data?.success) {
        this._log("info", `File already exists on NAS: ${this.shareFolder}/${msiFileName}`);
        return true;
      }
      // error_code 408 = file not found
      return false;
    } catch {
      return false;
    } finally {
      await this._logout(sid);
    }
  }

  async upload(msiFilePath, meta = {}) {
    return this._wrap("Synology NAS upload", async () => {
      const msiFileName = path.basename(msiFilePath);
      const fileSize    = fs.statSync(msiFilePath).size;
      const sid         = await this._login();

      this._log("info", `Uploading ${msiFileName} → NAS:${this.shareFolder}/${msiFileName} (${fileSize} bytes)`);

      try {
        const form = new FormData();
        form.append("api",         "SYNO.FileStation.Upload");
        form.append("version",     "3");
        form.append("method",      "upload");
        form.append("path",        this.shareFolder);
        form.append("create_parents", "true");
        form.append("overwrite",   "true");
        form.append("_sid",        sid);
        form.append("file",        fs.createReadStream(msiFilePath), {
          filename:    msiFileName,
          contentType: "application/octet-stream",
        });

        const resp = await axios.post(
          `${this.baseUrl}/webapi/entry.cgi`,
          form,
          {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength:    Infinity,
            timeout: 300000, // 5 phút cho file lớn
          }
        );

        if (!resp.data?.success) {
          throw new Error(`Synology upload API returned error: ${JSON.stringify(resp.data?.error)}`);
        }

        const url = `${this.baseUrl}/sharing/${this.shareFolder}/${msiFileName}`;
        return { url, size: fileSize, uploadedAt: Date.now() };

      } finally {
        await this._logout(sid);
      }
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _login() {
    const resp = await axios.get(`${this.baseUrl}/webapi/auth.cgi`, {
      params: {
        api:      "SYNO.API.Auth",
        version:  "7",
        method:   "login",
        account:  this.username,
        passwd:   this.password,
        session:  "msi-build-service",
        format:   "sid",
      },
      timeout: 15000,
    });

    if (!resp.data?.success) {
      throw new Error(`[SynologyAdapter] Login failed: code=${resp.data?.error?.code}`);
    }

    return resp.data.data.sid;
  }

  async _logout(sid) {
    try {
      await axios.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api:     "SYNO.API.Auth",
          version: "7",
          method:  "logout",
          session: "msi-build-service",
          _sid:    sid,
        },
        timeout: 5000,
      });
    } catch {
      // Logout fail không cần throw — token sẽ tự expire
    }
  }
}

module.exports = SynologyAdapter;
