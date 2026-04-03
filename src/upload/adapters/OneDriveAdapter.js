// Path: src/upload/adapters/OneDriveAdapter.js
// Purpose: Upload file MSI lên Microsoft OneDrive qua Microsoft Graph API (OAuth2 client credentials)
// Dependencies: @microsoft/microsoft-graph-client, @azure/identity, fs, path, BaseAdapter
// Last Updated: 2026-04-03

"use strict";

const fs   = require("fs");
const path = require("path");

const { ClientSecretCredential } = require("@azure/identity");
const BaseAdapter = require("./BaseAdapter");

/**
 * OneDriveAdapter
 *
 * Dùng Azure AD App Registration với client credentials flow (không cần user login).
 * Cần cấp quyền Files.ReadWrite.All (Application permission) trong Azure AD.
 *
 * Env vars (prefix UPLOAD_ONEDRIVE_):
 *   UPLOAD_ONEDRIVE_ENABLED        - "true" để bật
 *   UPLOAD_ONEDRIVE_CLIENT_ID      - Azure App Client ID
 *   UPLOAD_ONEDRIVE_CLIENT_SECRET  - Azure App Client Secret
 *   UPLOAD_ONEDRIVE_TENANT_ID      - Azure Tenant ID
 *   UPLOAD_ONEDRIVE_FOLDER_PATH    - đường dẫn thư mục trên OneDrive, ví dụ "/MSI-Releases"
 *   UPLOAD_ONEDRIVE_DRIVE_ID       - Drive ID (optional, default: dùng drive mặc định của app)
 */
class OneDriveAdapter extends BaseAdapter {
  constructor(config = {}) {
    super();
    this.clientId     = process.env.UPLOAD_ONEDRIVE_CLIENT_ID     || config.clientId     || "";
    this.clientSecret = process.env.UPLOAD_ONEDRIVE_CLIENT_SECRET || config.clientSecret || "";
    this.tenantId     = process.env.UPLOAD_ONEDRIVE_TENANT_ID     || config.tenantId     || "";
    this.folderPath   = process.env.UPLOAD_ONEDRIVE_FOLDER_PATH   || config.folderPath   || "/MSI-Releases";
    this.driveId      = process.env.UPLOAD_ONEDRIVE_DRIVE_ID      || config.driveId      || null;

    this._credential = new ClientSecretCredential(
      this.tenantId, this.clientId, this.clientSecret
    );
    this._graphBase  = "https://graph.microsoft.com/v1.0";
  }

  getName() { return "onedrive"; }

  async checkExists(msiFileName) {
    try {
      const token = await this._getToken();
      const itemPath = `${this.folderPath}/${msiFileName}`;
      const url = this._buildItemUrl(itemPath);

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (resp.ok) {
        this._log("info", `File already exists on OneDrive: ${itemPath}`);
        return true;
      }
      if (resp.status === 404) return false;
      throw new Error(`checkExists HTTP ${resp.status}: ${await resp.text()}`);
    } catch (err) {
      if (err.message.includes("404")) return false;
      throw new Error(`[OneDriveAdapter] checkExists error: ${err.message}`);
    }
  }

  async upload(msiFilePath, meta = {}) {
    return this._wrap("OneDrive upload", async () => {
      const msiFileName = path.basename(msiFilePath);
      const fileBuffer  = fs.readFileSync(msiFilePath);
      const fileSize    = fileBuffer.length;
      const token       = await this._getToken();

      this._log("info", `Uploading ${msiFileName} → OneDrive:${this.folderPath}/${msiFileName} (${fileSize} bytes)`);

      let url;
      if (fileSize <= 4 * 1024 * 1024) {
        // File nhỏ ≤ 4MB: PUT trực tiếp
        url = await this._putSmall(token, msiFileName, fileBuffer);
      } else {
        // File lớn: tạo upload session (resumable)
        url = await this._uploadLarge(token, msiFileName, msiFilePath, fileSize);
      }

      return { url, size: fileSize, uploadedAt: Date.now() };
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _getToken() {
    const tokenResp = await this._credential.getToken("https://graph.microsoft.com/.default");
    return tokenResp.token;
  }

  _buildItemUrl(itemPath) {
    const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
    if (this.driveId) {
      return `${this._graphBase}/drives/${this.driveId}/root:${encoded}`;
    }
    return `${this._graphBase}/me/drive/root:${encoded}`;
  }

  /** Upload file nhỏ ≤ 4MB bằng PUT */
  async _putSmall(token, msiFileName, fileBuffer) {
    const itemPath = `${this.folderPath}/${msiFileName}`;
    const url      = `${this._buildItemUrl(itemPath)}:/content`;

    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer,
    });

    if (!resp.ok) {
      throw new Error(`OneDrive PUT failed ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return data.webUrl || "";
  }

  /** Upload file lớn bằng upload session (resumable) */
  async _uploadLarge(token, msiFileName, msiFilePath, fileSize) {
    const itemPath    = `${this.folderPath}/${msiFileName}`;
    const sessionUrl  = `${this._buildItemUrl(itemPath)}:/createUploadSession`;

    // Tạo upload session
    const sessionResp = await fetch(sessionUrl, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    });

    if (!sessionResp.ok) {
      throw new Error(`OneDrive createUploadSession failed ${sessionResp.status}: ${await sessionResp.text()}`);
    }

    const { uploadUrl } = await sessionResp.json();

    // Upload theo từng chunk 10MB
    const CHUNK_SIZE = 10 * 1024 * 1024;
    const fd = fs.openSync(msiFilePath, "r");
    let offset = 0;
    let webUrl = "";

    try {
      while (offset < fileSize) {
        const end    = Math.min(offset + CHUNK_SIZE, fileSize) - 1;
        const length = end - offset + 1;
        const chunk  = Buffer.allocUnsafe(length);
        fs.readSync(fd, chunk, 0, length, offset);

        const chunkResp = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Length": String(length),
            "Content-Range":  `bytes ${offset}-${end}/${fileSize}`,
            "Content-Type":   "application/octet-stream",
          },
          body: chunk,
        });

        if (chunkResp.status === 200 || chunkResp.status === 201) {
          const data = await chunkResp.json();
          webUrl = data.webUrl || "";
        } else if (chunkResp.status !== 202) {
          throw new Error(`OneDrive chunk upload failed at byte ${offset}: HTTP ${chunkResp.status}`);
        }

        offset = end + 1;
        this._log("debug", `Uploaded chunk ${offset}/${fileSize} bytes`);
      }
    } finally {
      fs.closeSync(fd);
    }

    return webUrl;
  }
}

module.exports = OneDriveAdapter;
