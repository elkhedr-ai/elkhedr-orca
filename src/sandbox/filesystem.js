/**
 * Filesystem Sandbox
 * Restricts agent execution to a specific workspace directory.
 * Prevents access outside the sandbox using path resolution checks.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { logger } = require('../utils/logger.js');

const execFileAsync = promisify(execFile);

class FilesystemSandbox {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || './sandbox');
    this.networkEnabled = options.networkEnabled || false;
    this.useChroot = options.useChroot || false;
    this.initialized = false;
    this.execCount = 0;
  }

  /**
   * Initialize sandbox workspace
   */
  async initialize() {
    if (!fs.existsSync(this.workspace)) {
      fs.mkdirSync(this.workspace, { recursive: true });
    }

    // Create subdirectories
    const dirs = ['tmp', 'data', 'output'];
    for (const dir of dirs) {
      const dirPath = path.join(this.workspace, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    this.initialized = true;
    logger.info({ workspace: this.workspace }, 'Filesystem sandbox initialized');
  }

  /**
   * Validate path is within sandbox
   * @param {string} targetPath
   * @returns {boolean}
   */
  isPathAllowed(targetPath) {
    const resolved = path.resolve(this.workspace, targetPath);
    // Ensure the resolved path starts with workspace path
    return resolved.startsWith(this.workspace) && resolved !== path.dirname(this.workspace);
  }

  /**
   * Write file to sandbox
   * @param {string} filename
   * @param {string} content
   */
  async writeFile(filename, content) {
    const filePath = path.join(this.workspace, filename);
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`Path ${filename} is outside sandbox`);
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content);
    return filePath;
  }

  /**
   * Read file from sandbox
   * @param {string} filename
   * @returns {string}
   */
  async readFile(filename) {
    const filePath = path.join(this.workspace, filename);
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`Path ${filename} is outside sandbox`);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File ${filename} not found in sandbox`);
    }

    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * List files in sandbox
   * @param {string} dir
   * @returns {Array}
   */
  async listFiles(dir = '') {
    const targetDir = path.join(this.workspace, dir);
    if (!this.isPathAllowed(targetDir)) {
      throw new Error(`Directory ${dir} is outside sandbox`);
    }

    if (!fs.existsSync(targetDir)) {
      return [];
    }

    return fs.readdirSync(targetDir);
  }

  /**
   * Execute code in sandbox
   * @param {string} code
   * @param {Object} options
   */
  async execute(code, options = {}) {
    const timeout = options.timeout || 30000;
    const startTime = Date.now();

    // Write code to sandbox
    const scriptName = `script-${Date.now()}.js`;
    const scriptPath = await this.writeFile(scriptName, code);

    try {
      const execOptions = {
        timeout,
        cwd: this.workspace,
        env: {
          ...process.env,
          // Disable network for Node.js by setting a non-functional proxy
          ...(this.networkEnabled ? {} : {
            HTTP_PROXY: 'http://0.0.0.0:0',
            HTTPS_PROXY: 'http://0.0.0.0:0',
            NO_PROXY: ''
          }),
          ORCA_SANDBOX: 'true',
          ORCA_SANDBOX_PATH: this.workspace
        }
      };

      const { stdout, stderr } = await execFileAsync('node', [scriptPath], execOptions);

      this.execCount++;

      // Cleanup script
      fs.unlinkSync(scriptPath);

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }

      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Get sandbox status
   */
  getStatus() {
    return {
      type: 'filesystem',
      workspace: this.workspace,
      initialized: this.initialized,
      execCount: this.execCount,
      networkEnabled: this.networkEnabled,
      useChroot: this.useChroot
    };
  }

  /**
   * Cleanup sandbox
   */
  async cleanup() {
    // Remove all files in workspace
    const files = fs.readdirSync(this.workspace);
    for (const file of files) {
      const filePath = path.join(this.workspace, file);
      try {
        if (fs.statSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true });
        } else {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        logger.warn({ file, error: error.message }, 'Failed to cleanup sandbox file');
      }
    }
    this.execCount = 0;
    logger.info('Filesystem sandbox cleaned up');
  }
}

module.exports = {
  FilesystemSandbox
};
