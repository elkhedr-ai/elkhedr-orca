/**
 * Skill Marketplace - Install skills from URLs or local paths
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');
const { registry } = require('./registry.js');
const { loadSkillFromDirectory } = require('./loader.js');
const { validatePermissions, getElevatedPermissions } = require('./permissions.js');

const execAsync = promisify(exec);

// Default installation directory
const DEFAULT_INSTALL_DIR = path.join(__dirname, '../../skills');

/**
 * Parse skill source URL or path
 * Supports:
 * - GitHub: https://github.com/user/repo/tree/main/skills/skill-name
 * - GitHub Raw: https://raw.githubusercontent.com/user/repo/main/skills/skill-name/
 * - Local: /absolute/path/to/skill or ./relative/path
 */
function parseSource(source) {
  // GitHub repository URL
  const githubRepoMatch = source.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (githubRepoMatch) {
    const [, user, repo] = githubRepoMatch;
    // Extract path within repo if present
    const pathMatch = source.match(/github\.com\/[^\/]+\/[^\/]+\/(?:tree|blob)\/[^\/]+\/(.*)/);
    const subPath = pathMatch ? pathMatch[1] : '';
    
    return {
      type: 'github',
      user,
      repo,
      subPath,
      rawUrl: `https://raw.githubusercontent.com/${user}/${repo}/main/${subPath}`
    };
  }
  
  // GitHub raw content URL
  const rawMatch = source.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.*)/);
  if (rawMatch) {
    const [, user, repo, branch, subPath] = rawMatch;
    return {
      type: 'github-raw',
      user,
      repo,
      branch,
      subPath,
      rawUrl: source
    };
  }
  
  // Local path
  if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
    return {
      type: 'local',
      path: path.resolve(source)
    };
  }
  
  // Try as local path anyway
  return {
    type: 'local',
    path: path.resolve(source)
  };
}

/**
 * Download skill from GitHub
 */
async function downloadFromGitHub(sourceInfo, targetDir) {
  logger.info({ source: sourceInfo }, 'Downloading skill from GitHub');
  
  const { user, repo, subPath } = sourceInfo;
  
  // Use GitHub API to get repository contents
  const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/${subPath}`;
  
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Elkhedr-Orca'
      },
      timeout: 30000
    });
    
    if (!Array.isArray(response.data)) {
      throw new ValidationError('GitHub source must be a directory, not a file');
    }
    
    // Create target directory
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Download each file
    for (const file of response.data) {
      if (file.type === 'file') {
        const fileResponse = await axios.get(file.download_url, {
          responseType: 'text',
          timeout: 30000
        });
        fs.writeFileSync(path.join(targetDir, file.name), fileResponse.data);
        logger.debug({ file: file.name }, 'Downloaded file');
      }
    }
    
    logger.info({ targetDir }, 'Skill downloaded from GitHub');
    return targetDir;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new ValidationError(`GitHub repository or path not found: ${user}/${repo}/${subPath}`);
    }
    throw error;
  }
}

/**
 * Copy skill from local path
 */
async function copyFromLocal(sourcePath, targetDir) {
  logger.info({ source: sourcePath, target: targetDir }, 'Copying skill from local path');
  
  if (!fs.existsSync(sourcePath)) {
    throw new ValidationError(`Local path not found: ${sourcePath}`);
  }
  
  if (!fs.statSync(sourcePath).isDirectory()) {
    throw new ValidationError(`Local path must be a directory: ${sourcePath}`);
  }
  
  // Check required files
  const manifestPath = path.join(sourcePath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new ValidationError(`Skill missing manifest.json at ${sourcePath}`);
  }
  
  // Copy directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  const files = fs.readdirSync(sourcePath);
  for (const file of files) {
    const src = path.join(sourcePath, file);
    const dest = path.join(targetDir, file);
    
    if (fs.statSync(src).isDirectory()) {
      await copyDirectory(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  
  logger.info({ targetDir }, 'Skill copied from local path');
  return targetDir;
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    
    if (fs.statSync(srcPath).isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Check for dependency conflicts
 */
function checkDependencies(manifest) {
  const conflicts = [];
  
  for (const dep of manifest.dependencies || []) {
    if (registry.has(dep)) {
      const existing = registry.getManifest(dep);
      conflicts.push({
        name: dep,
        existingVersion: existing.version,
        requiredVersion: '*'
      });
    }
  }
  
  return conflicts;
}

/**
 * Install a skill from source
 * @param {string} source - URL or local path
 * @param {Object} options - Installation options
 * @returns {Object} Installation result
 */
async function installSkill(source, options = {}) {
  const installDir = options.installDir || DEFAULT_INSTALL_DIR;
  
  logger.info({ source, installDir }, 'Installing skill');
  
  // Parse source
  const sourceInfo = parseSource(source);
  
  // Determine target directory name
  let targetName = options.name;
  if (!targetName) {
    if (sourceInfo.type === 'github') {
      targetName = path.basename(sourceInfo.subPath) || sourceInfo.repo;
    } else if (sourceInfo.type === 'local') {
      targetName = path.basename(sourceInfo.path);
    }
  }
  
  const targetDir = path.join(installDir, targetName);
  
  // Check if already exists
  if (fs.existsSync(targetDir)) {
    if (!options.force) {
      throw new ValidationError(
        `Skill "${targetName}" already exists at ${targetDir}. Use --force to overwrite.`,
        { hint: 'Use --force flag to overwrite existing skill' }
      );
    }
    logger.warn({ targetDir }, 'Overwriting existing skill');
    
    // Unregister old skill if present
    try {
      const oldManifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8'));
      if (registry.has(oldManifest.name)) {
        registry.unregister(oldManifest.name);
      }
    } catch {
      // Old manifest doesn't exist or is invalid, ignore
    }
    
    // Remove old directory
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  
  // Download/copy skill
  if (sourceInfo.type === 'github' || sourceInfo.type === 'github-raw') {
    await downloadFromGitHub(sourceInfo, targetDir);
  } else {
    await copyFromLocal(sourceInfo.path, targetDir);
  }
  
  // Validate downloaded skill
  const manifestPath = path.join(targetDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    // Cleanup
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new ValidationError('Installed skill missing manifest.json');
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // Validate declared permissions
  try {
    validatePermissions(manifest.permissions || []);
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new ValidationError(
      `Invalid permissions in skill manifest: ${error.message}`,
      { hint: 'Check manifest.json permissions array' }
    );
  }
  
  // Warn about elevated permissions
  const elevated = getElevatedPermissions(manifest.permissions || []);
  if (elevated.length > 0) {
    logger.warn({
      skill: manifest.name,
      elevated
    }, 'Skill requires elevated permissions - will need explicit approval before execution');
  }
  
  // Check dependencies
  const conflicts = checkDependencies(manifest);
  if (conflicts.length > 0 && !options.ignoreConflicts) {
    // Cleanup
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new ValidationError(
      `Dependency conflicts detected: ${conflicts.map(c => c.name).join(', ')}`,
      { conflicts, hint: 'Use --ignore-conflicts to proceed anyway' }
    );
  }
  
  // Load the skill into registry
  loadSkillFromDirectory(targetDir);
  
  logger.info({ 
    name: manifest.name, 
    version: manifest.version,
    targetDir 
  }, 'Skill installed successfully');
  
  return {
    success: true,
    name: manifest.name,
    version: manifest.version,
    path: targetDir,
    permissions: manifest.permissions,
    conflicts: conflicts.length > 0 ? conflicts : undefined
  };
}

/**
 * Uninstall a skill
 */
async function uninstallSkill(name, options = {}) {
  const installDir = options.installDir || DEFAULT_INSTALL_DIR;
  
  // Find the skill directory by looking for manifest with matching name
  let targetDir = null;
  
  if (fs.existsSync(installDir)) {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const manifestPath = path.join(installDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest.name === name) {
            targetDir = path.join(installDir, entry.name);
            break;
          }
        } catch {
          // Invalid manifest, skip
        }
      }
    }
  }
  
  // Fallback to direct path if not found by manifest name
  if (!targetDir) {
    targetDir = path.join(installDir, name);
  }
  
  logger.info({ name, targetDir }, 'Uninstalling skill');
  
  if (!fs.existsSync(targetDir)) {
    throw new ValidationError(`Skill "${name}" not found at ${targetDir}`);
  }
  
  // Unregister from registry
  if (registry.has(name)) {
    registry.unregister(name);
  }
  
  // Remove directory
  fs.rmSync(targetDir, { recursive: true, force: true });
  
  logger.info({ name }, 'Skill uninstalled');
  
  return { success: true, name };
}

/**
 * List installed skills
 */
function listInstalledSkills(options = {}) {
  const installDir = options.installDir || DEFAULT_INSTALL_DIR;
  
  if (!fs.existsSync(installDir)) {
    return [];
  }
  
  const entries = fs.readdirSync(installDir, { withFileTypes: true });
  const skills = [];
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const manifestPath = path.join(installDir, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        skills.push({
          ...manifest,
          directory: entry.name,
          loaded: registry.has(manifest.name)
        });
      } catch {
        // Invalid manifest, skip
      }
    }
  }
  
  return skills;
}

module.exports = {
  installSkill,
  uninstallSkill,
  listInstalledSkills,
  parseSource,
  DEFAULT_INSTALL_DIR
};
