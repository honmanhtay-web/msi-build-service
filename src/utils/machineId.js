// Path: src/utils/machineId.js
// Purpose: Tạo unique ID định danh cho mỗi service instance — dùng để claim job trên Firebase
// Dependencies: os
// Last Updated: 2026-04-03

"use strict";

const os = require("os");

/**
 * Trả về machine ID theo thứ tự ưu tiên:
 * 1. SERVICE_MACHINE_ID env var (do người dùng đặt, ưu tiên nhất)
 * 2. hostname:pid (tự động, đảm bảo unique per process trên cùng máy)
 *
 * Tại sao gồm cả pid:
 * - Cho phép chạy nhiều instance trên cùng máy (testing, staging)
 * - Giúp detect crash: nếu claimedBy có pid không còn tồn tại → job bị stuck
 *
 * @returns {string} - ví dụ: "build-machine-01" hoặc "DESKTOP-ABC123:12345"
 */
const getMachineId = () => {
  if (process.env.SERVICE_MACHINE_ID) {
    return process.env.SERVICE_MACHINE_ID.trim();
  }
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-_]/g, "-");
  const pid = process.pid;
  return `${hostname}:${pid}`;
};

// Cache lại để không tính lại mỗi lần gọi
const MACHINE_ID = getMachineId();

module.exports = { getMachineId, MACHINE_ID };
