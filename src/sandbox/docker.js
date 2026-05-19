/**
 * Docker Sandbox
 * Runs agent code in isolated Docker containers.
 * Provides true process, filesystem, and network isolation.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');

class DockerSandbox {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || './sandbox');
    this.networkEnabled = options.networkEnabled || false;
    this.cpuLimit = options.cpuLimit || '1.0';
    this.memoryLimit = options.memoryLimit || '512m';
    this.image = options.image || 'node:20-alpine';
    this.initialized = false;
    this.execCount = 0;
    this.containers = new Set();
  }

  /**
   * Check if Docker is available
   */
  async checkDocker() {
    return new Promise((resolve) => {
      const docker = spawn('docker', ['--version']);
      docker.on('error', () => resolve(false));
      docker.on('exit', (code) => resolve(code === 0));
    });
  }

  /**
   * Initialize Docker sandbox
   */
  async initialize() {
    const dockerAvailable = await this.checkDocker();
    if (!dockerAvailable) {
      throw new Error('Docker is not available. Install Docker or use filesystem sandbox.');
    }

    // Ensure workspace exists
    if (!fs.existsSync(this.workspace)) {
      fs.mkdirSync(this.workspace, { recursive: true });
    }

    // Pull image if not present
    await this._pullImage();

    this.initialized = true;
    logger.info({ image: this.image }, 'Docker sandbox initialized');
  }

  /**
   * Pull Docker image
   */
  async _pullImage() {
    return new Promise((resolve, reject) => {
      logger.info({ image: this.image }, 'Pulling Docker image...');
      const pull = spawn('docker', ['pull', this.image]);

      pull.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to pull Docker image ${this.image}`));
        }
      });

      pull.on('error', reject);
    });
  }

  /**
   * Execute code in Docker container
   * @param {string} code
   * @param {Object} options
   */
  async execute(code, options = {}) {
    const timeout = options.timeout || 30000;
    const startTime = Date.now();
    const containerName = `orca-sandbox-${Date.now()}`;

    // Write code to workspace
    const scriptName = `script-${Date.now()}.js`;
    const scriptPath = path.join(this.workspace, scriptName);
    fs.writeFileSync(scriptPath, code);

    const args = [
      'run',
      '--rm',
      '--name', containerName,
      '--cpus', this.cpuLimit,
      '--memory', this.memoryLimit,
      ...(this.networkEnabled ? [] : ['--network', 'none']),
      '--read-only',
      '--tmpfs', '/tmp:noexec,nosuid,size=100m',
      '-v', `${this.workspace}:/workspace:ro`,
      '-w', '/workspace',
      this.image,
      'node', `/workspace/${scriptName}`
    ];

    return new Promise((resolve) => {
      const docker = spawn('docker', args, {
        timeout
      });

      let stdout = '';
      let stderr = '';

      docker.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      docker.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      docker.on('exit', (code) => {
        this.containers.delete(containerName);
        this.execCount++;

        // Cleanup script
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
          duration: Date.now() - startTime
        });
      });

      docker.on('error', (error) => {
        this.containers.delete(containerName);

        // Cleanup
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim() || error.message,
          exitCode: 1,
          duration: Date.now() - startTime
        });
      });
    });
  }

  /**
   * Stop all running containers
   */
  async stopAllContainers() {
    for (const containerName of this.containers) {
      try {
        await new Promise((resolve) => {
          const stop = spawn('docker', ['stop', containerName]);
          stop.on('exit', resolve);
          stop.on('error', resolve);
        });
      } catch (error) {
        logger.warn({ container: containerName, error: error.message }, 'Failed to stop container');
      }
    }
    this.containers.clear();
  }

  /**
   * Get sandbox status
   */
  getStatus() {
    return {
      type: 'docker',
      image: this.image,
      initialized: this.initialized,
      execCount: this.execCount,
      activeContainers: this.containers.size,
      networkEnabled: this.networkEnabled,
      cpuLimit: this.cpuLimit,
      memoryLimit: this.memoryLimit
    };
  }

  /**
   * Cleanup sandbox
   */
  async cleanup() {
    await this.stopAllContainers();

    // Remove workspace files
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
    logger.info('Docker sandbox cleaned up');
  }
}

module.exports = {
  DockerSandbox
};
