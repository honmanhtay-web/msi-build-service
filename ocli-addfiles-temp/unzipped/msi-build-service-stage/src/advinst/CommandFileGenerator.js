// Path: src/advinst/CommandFileGenerator.js
// Purpose: Sinh nội dung file command .txt cho advinst.exe — pure function, không có side effect
// Dependencies: (none — pure function)
// Last Updated: 2026-04-03

"use strict";

/**
 * CommandFileGenerator
 *
 * Sinh nội dung file command text để truyền vào advinst.exe qua flag /execute.
 * Pure function — không ghi file, không gọi process, dễ unit test.
 *
 * Format command file (Advanced Installer CLI):
 *   /AddPackage "...\app.aip"
 *   /SetVersion "1.2.3.4"
 *   /SetProductName "App Name"
 *   /SetOutputLocation "C:\...\output"
 *   /Build
 *
 * Cách dùng:
 *   const gen = new CommandFileGenerator();
 *   const content = gen.generate(resolvedConfig);
 *   fs.writeFileSync("build-cmd.txt", content, "utf8");
 */
class CommandFileGenerator {
  /**
   * Sinh nội dung file command
   * @param {object} config - output của ConfigResolver.resolve()
   * @param {string} config.aipFilePath     - path tới file .aip (đã clone ra buildTmpDir)
   * @param {string} config.productVersion  - version string, ví dụ "1.2.3.4"
   * @param {string} config.outputDir       - thư mục output MSI
   * @param {string} config.setupTitle      - tiêu đề product
   * @param {string} config.appName         - tên app (ProductName)
   * @param {Array}  config.extraCommands   - mảng string lệnh bổ sung (tuỳ project)
   * @returns {string} nội dung file command, mỗi lệnh 1 dòng
   */
  generate(config) {
    const {
      aipFilePath,
      productVersion,
      outputDir,
      setupTitle,
      appName,
      extraCommands = [],
    } = config;

    const lines = [];

    // 1. Mở project
    lines.push(`/AddPackage "${this._normPath(aipFilePath)}"`);

    // 2. Set version
    if (productVersion) {
      lines.push(`/SetVersion "${productVersion}"`);
    }

    // 3. Set ProductName (tiêu đề hiển thị)
    if (appName) {
      lines.push(`/SetProductName "${appName}"`);
    }

    // 4. Set SetupTitle (wizard title)
    if (setupTitle && setupTitle !== appName) {
      lines.push(`/SetSetupTitle "${setupTitle}"`);
    }

    // 5. Set output location
    if (outputDir) {
      lines.push(`/SetOutputLocation "${this._normPath(outputDir)}"`);
    }

    // 6. Lệnh bổ sung từ .aip.json
    for (const cmd of extraCommands) {
      if (cmd && typeof cmd === "string") {
        lines.push(cmd.trim());
      }
    }

    // 7. Trigger build
    lines.push("/Build");

    return lines.join("\r\n") + "\r\n";
  }

  /**
   * Chuẩn hóa path về Windows backslash
   * advinst.exe yêu cầu backslash trong command file
   * @param {string} p
   * @returns {string}
   */
  _normPath(p) {
    if (!p) return "";
    return p.replace(/\//g, "\\");
  }
}

module.exports = CommandFileGenerator;
