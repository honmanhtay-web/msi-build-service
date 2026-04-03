// Path: src/upload/adapters/GoogleDriveAdapter.js
// Purpose: Upload file MSI lên Google Drive qua Service Account (googleapis)
// Dependencies: googleapis, fs, path, BaseAdapter
// Last Updated: 2026-04-03

"use strict";

const fs   = require("fs");
const path = require("path");

const { google } = require("googleapis");
const BaseAdapter = require("./BaseAdapter");

/**
 * GoogleDriveAdapter
 *
 * Dùng Service Account JWT auth — không cần user OAuth.
 * Cần cấp quyền service account vào thư mục Google Drive mục tiêu.
 *
 * Env vars (prefix UPLOAD_GDRIVE_):
 *   UPLOAD_GDRIVE_ENABLED              - "true" để bật
 *   UPLOAD_GDRIVE_SERVICE_ACCOUNT_KEY  - JSON string của service account key
 *   UPLOAD_GDRIVE_FOLDER_ID            - ID thư mục Google Drive đích
 */
class GoogleDriveAdapter extends BaseAdapter {
  constructor(config = {}) {
    super();
    this.folderId = process.env.UPLOAD_GDRIVE_FOLDER_ID || config.folderId || "";

    const keyJson = process.env.UPLOAD_GDRIVE_SERVICE_ACCOUNT_KEY || config.serviceAccountKey || "{}";
    let keyObj;
    try {
      keyObj = JSON.parse(keyJson);
    } catch {
      keyObj = {};
    }

    this._auth = new google.auth.GoogleAuth({
      credentials: keyObj,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    this._drive = google.drive({ version: "v3", auth: this._auth });
  }

  getName() { return "gdrive"; }

  async checkExists(msiFileName) {
    try {
      const resp = await this._drive.files.list({
        q: `name='${msiFileName}' and '${this.folderId}' in parents and trashed=false`,
        fields: "files(id,name,webViewLink)",
        pageSize: 1,
      });

      const files = resp.data.files || [];
      if (files.length > 0) {
        this._log("info", `File already exists on Google Drive: ${msiFileName} (id=${files[0].id})`);
        return true;
      }
      return false;
    } catch (err) {
      throw new Error(`[GoogleDriveAdapter] checkExists error: ${err.message}`);
    }
  }

  async upload(msiFilePath, meta = {}) {
    return this._wrap("Google Drive upload", async () => {
      const msiFileName = path.basename(msiFilePath);
      const fileSize    = fs.statSync(msiFilePath).size;

      this._log("info", `Uploading ${msiFileName} → GDrive folder:${this.folderId} (${fileSize} bytes)`);

      const resp = await this._drive.files.create({
        requestBody: {
          name:    msiFileName,
          parents: [this.folderId],
        },
        media: {
          mimeType: "application/octet-stream",
          body:     fs.createReadStream(msiFilePath),
        },
        fields: "id,webViewLink,size",
      });

      const file = resp.data;
      this._log("info", `Google Drive upload done: fileId=${file.id}`);

      return {
        url:        file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        size:       fileSize,
        uploadedAt: Date.now(),
      };
    });
  }
}

module.exports = GoogleDriveAdapter;
