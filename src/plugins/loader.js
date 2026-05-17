/**
 * Skill Plugin Loader
 * 
 * Dynamically loads skills from the skills/ directory.
 * Each skill should be a folder with:
 *   - manifest.json: Skill metadata
 *   - index.js: Implementation with execute() export
 */

const fs = require('fs');
const path = require('path');
const { registry } = require('./registry.js');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');

const DEFAULT_SKILLS_DIR = path.join(__dirname, '../../skills');

/**
 * Load a single skill from directory
 * @param {string} skillPath - Path to skill directory
 */
function loadSkillFromDirectory(skillPath) {
  const manifestPath = path.join(skillPath, 'manifest.json');
  const indexPath = path.join(skillPath, 'index.js');
  
  // Check required files
  if (!fs.existsSync(manifestPath)) {
    throw new ValidationError(`Skill at ${skillPath} missing manifest.json`);
  }
  
  if (!fs.existsSync(indexPath)) {
    throw new ValidationError(`Skill at ${skillPath} missing index.js`);
  }
  
  // Load manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // Load implementation (clear cache for hot reload)
  delete require.cache[require.resolve(indexPath)];
  const implementation = require(indexPath);
  
  // Register
  registry.register(manifest, implementation);
  
  logger.info({ 
    skill: manifest.name, 
    path: skillPath 
  }, 'Skill loaded from directory');
}

/**
 * Scan and load all skills from directory
 * @param {string} skillsDir - Directory to scan (default: skills/)
 */
function loadSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  logger.info({ skillsDir }, 'Loading skills...');
  
  if (!fs.existsSync(skillsDir)) {
    logger.warn({ skillsDir }, 'Skills directory not found, creating...');
    fs.mkdirSync(skillsDir, { recursive: true });
    return;
  }
  
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  
  let loaded = 0;
  let failed = 0;
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const skillPath = path.join(skillsDir, entry.name);
    
    try {
      loadSkillFromDirectory(skillPath);
      loaded++;
    } catch (error) {
      failed++;
      logger.error({ 
        skill: entry.name, 
        error: error.message 
      }, 'Failed to load skill');
    }
  }
  
  logger.info({ 
    loaded, 
    failed, 
    total: loaded + failed 
  }, 'Skill loading complete');
}

/**
 * Watch skills directory for changes (hot reload)
 * @param {string} skillsDir - Directory to watch
 */
function watchSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) {
    logger.warn('Cannot watch skills directory - does not exist');
    return;
  }
  
  logger.info({ skillsDir }, 'Watching skills directory for changes...');
  
  const watcher = fs.watch(skillsDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    const fullPath = path.join(skillsDir, filename);
    
    // Debounce
    if (watcher._timeout) {
      clearTimeout(watcher._timeout);
    }
    
    watcher._timeout = setTimeout(() => {
      logger.info({ file: filename, event: eventType }, 'Skill file changed');
      
      // Find the skill directory
      const relativePath = path.relative(skillsDir, fullPath);
      const skillName = relativePath.split(path.sep)[0];
      const skillPath = path.join(skillsDir, skillName);
      
      if (fs.existsSync(skillPath) && fs.statSync(skillPath).isDirectory()) {
        try {
          // Unregister old version if exists
          const manifestPath = path.join(skillPath, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (registry.has(manifest.name)) {
              registry.unregister(manifest.name);
            }
          }
          
          // Reload
          loadSkillFromDirectory(skillPath);
          logger.info({ skill: skillName }, 'Skill hot-reloaded');
        } catch (error) {
          logger.error({ skill: skillName, error: error.message }, 'Failed to hot-reload skill');
        }
      }
    }, 500);
  });
  
  return watcher;
}

module.exports = {
  loadSkills,
  loadSkillFromDirectory,
  watchSkills,
  DEFAULT_SKILLS_DIR
};
