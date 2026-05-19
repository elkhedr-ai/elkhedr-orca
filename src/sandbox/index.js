/**
 * Sandbox Interface
 * Provides unified API for running agent code in isolated environments.
 * Supports multiple backend types: none, filesystem, docker, chroot.
 */

const { logger } = require('../utils/logger.js');
const { FilesystemSandbox } = require('./filesystem.js');
const { DockerSandbox } = require('./docker.js');

class SandboxManager {
  constructor(options = {}) {
    this.type = options.type || process.env.ORCA_SANDBOX_TYPE || 'none';
    this.workspace = options.workspace || process.env.ORCA_SANDBOX_WORKSPACE || './sandbox';
    this.networkEnabled = options.networkEnabled !== undefined
      ? options.networkEnabled
      : process.env.ORCA_SANDBOX_NETWORK_ENABLED === 'true';
    this.cpuLimit = options.cpuLimit || process.env.ORCA_SANDBOX_CPU_LIMIT || '1.0';
    this.memoryLimit = options.memoryLimit || process.env.ORCA_SANDBOX_MEMORY_LIMIT || '512m';
    this.backend = null;
    this.initialized = false;
  }

  /**
   * Initialize the sandbox backend
   */
  async initialize() {
    if (this.initialized) return;

    switch (this.type) {
      case 'docker':
        this.backend = new DockerSandbox({
          workspace: this.workspace,
          networkEnabled: this.networkEnabled,
          cpuLimit: this.cpuLimit,
          memoryLimit: this.memoryLimit,
          image: process.env.ORCA_DOCKER_IMAGE || 'node:20-alpine'
        });
        break;

      case 'filesystem':
        this.backend = new FilesystemSandbox({
          workspace: this.workspace,
          networkEnabled: this.networkEnabled
        });
        break;

      case 'chroot':
        // chroot is filesystem with extra restrictions
        this.backend = new FilesystemSandbox({
          workspace: this.workspace,
          networkEnabled: this.networkEnabled,
          useChroot: true
        });
        break;

      case 'none':
      default:
        logger.warn('Sandbox disabled. Agent code will run without isolation!');
        this.backend = null;
        break;
    }

    if (this.backend) {
      await this.backend.initialize();
    }

    this.initialized = true;
    logger.info({ type: this.type }, 'Sandbox initialized');
  }

  /**
   * Execute code in sandbox
   * @param {string} code - Code to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} { stdout, stderr, exitCode, duration }
   */
  async execute(code, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.backend) {
      // No sandbox - execute directly (DANGEROUS)
      logger.warn('Executing code without sandbox isolation');
      return this._executeUnsafe(code, options);
    }

    return this.backend.execute(code, options);
  }

  /**
   * Execute a skill in sandbox
   * @param {string} skillName - Name of skill
   * @param {Object} params - Skill parameters
   * @returns {Promise<Object>}
   */
  async executeSkill(skillName, params = {}) {
    // Wrap skill execution in sandbox
    const code = `
      const skill = require('${skillName}');
      const result = await skill.execute(${JSON.stringify(params)});
      console.log(JSON.stringify(result));
    `;

    return this.execute(code, { timeout: 30000 });
  }

  /**
   * Unsafe direct execution (fallback when sandbox is disabled)
   */
  async _executeUnsafe(code, options = {}) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const timeout = options.timeout || 30000;
    const startTime = Date.now();

    try {
      // Write code to temp file and execute
      const fs = require('fs');
      const path = require('path');
      const tmpFile = path.join(require('os').tmpdir(), `orca-unsafe-${Date.now()}.js`);
      fs.writeFileSync(tmpFile, code);

      const { stdout, stderr } = await execAsync(`node ${tmpFile}`, { timeout });

      fs.unlinkSync(tmpFile);

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        duration: Date.now() - startTime
      };
    } catch (error) {
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
      type: this.type,
      initialized: this.initialized,
      backend: this.backend ? this.backend.getStatus() : null,
      networkEnabled: this.networkEnabled,
      cpuLimit: this.cpuLimit,
      memoryLimit: this.memoryLimit
    };
  }

  /**
   * Cleanup sandbox resources
   */
  async cleanup() {
    if (this.backend) {
      await this.backend.cleanup();
    }
    this.initialized = false;
  }
}

// Singleton instance
let instance = null;

function getSandboxManager(options) {
  if (!instance) {
    instance = new SandboxManager(options);
  }
  return instance;
}

module.exports = {
  SandboxManager,
  getSandboxManager
};
