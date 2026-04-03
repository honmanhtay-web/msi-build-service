// Path: src/upload/adapters/S3Adapter.js
// Purpose: Upload file MSI lên AWS S3 hoặc S3-compatible storage
// Dependencies: @aws-sdk/client-s3, @aws-sdk/lib-storage, fs, path, BaseAdapter
// Last Updated: 2026-04-03

"use strict";

const fs   = require("fs");
const path = require("path");

const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const BaseAdapter = require("./BaseAdapter");

/**
 * S3Adapter
 *
 * Env vars (prefix UPLOAD_S3_):
 *   UPLOAD_S3_ENABLED            - "true" để bật
 *   UPLOAD_S3_BUCKET             - tên bucket
 *   UPLOAD_S3_REGION             - region, ví dụ "ap-southeast-1"
 *   UPLOAD_S3_ACCESS_KEY_ID      - AWS access key
 *   UPLOAD_S3_SECRET_ACCESS_KEY  - AWS secret key
 *   UPLOAD_S3_KEY_PREFIX         - prefix thư mục trong bucket (optional), ví dụ "releases/"
 *   UPLOAD_S3_ENDPOINT           - custom endpoint nếu dùng S3-compatible (optional)
 */
class S3Adapter extends BaseAdapter {
  constructor(config = {}) {
    super();
    this.bucket    = process.env.UPLOAD_S3_BUCKET    || config.bucket    || "";
    this.region    = process.env.UPLOAD_S3_REGION    || config.region    || "ap-southeast-1";
    this.keyPrefix = process.env.UPLOAD_S3_KEY_PREFIX || config.keyPrefix || "";
    this.endpoint  = process.env.UPLOAD_S3_ENDPOINT  || config.endpoint  || undefined;

    this._client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: {
        accessKeyId:     process.env.UPLOAD_S3_ACCESS_KEY_ID     || config.accessKeyId     || "",
        secretAccessKey: process.env.UPLOAD_S3_SECRET_ACCESS_KEY || config.secretAccessKey || "",
      },
      forcePathStyle: !!this.endpoint, // cần cho MinIO/Ceph
    });
  }

  getName() { return "s3"; }

  /**
   * Kiểm tra file đã có trong bucket chưa bằng HeadObject
   */
  async checkExists(msiFileName) {
    const key = this._buildKey(msiFileName);
    try {
      await this._client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      this._log("info", `File already exists: s3://${this.bucket}/${key}`);
      return true;
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
      // Lỗi khác (auth, network) → throw để báo lên UploadManager
      throw new Error(`[S3Adapter] checkExists error: ${err.message}`);
    }
  }

  /**
   * Upload file lên S3 với multipart (hỗ trợ file lớn)
   */
  async upload(msiFilePath, meta = {}) {
    return this._wrap("S3 upload", async () => {
      const msiFileName = path.basename(msiFilePath);
      const key         = this._buildKey(msiFileName);
      const fileSize    = fs.statSync(msiFilePath).size;

      this._log("info", `Uploading ${msiFileName} → s3://${this.bucket}/${key} (${fileSize} bytes)`);

      const upload = new Upload({
        client: this._client,
        params: {
          Bucket:      this.bucket,
          Key:         key,
          Body:        fs.createReadStream(msiFilePath),
          ContentType: "application/octet-stream",
          Metadata: {
            repoId:  meta.repoId  || "",
            pushId:  meta.pushId  || "",
            version: meta.version || "",
          },
        },
        queueSize: 4,       // parallel part uploads
        partSize:  5 * 1024 * 1024, // 5MB per part
      });

      await upload.done();

      const url = this.endpoint
        ? `${this.endpoint}/${this.bucket}/${key}`
        : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

      return { url, size: fileSize, uploadedAt: Date.now() };
    });
  }

  _buildKey(msiFileName) {
    const prefix = this.keyPrefix.endsWith("/") || !this.keyPrefix
      ? this.keyPrefix
      : this.keyPrefix + "/";
    return `${prefix}${msiFileName}`;
  }
}

module.exports = S3Adapter;
