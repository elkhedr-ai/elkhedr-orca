/**
 * Skill Registry - Manages loaded skill plugins
 */

const { skillManifestSchema } = require('./schema.js');
const { ValidationError } = require('../utils/errors.js');
const { logger } = require('../utils/logger.js');

class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
  }

  /**
   * Register a skill
   * @param {Object} manifest - Skill manifest
   * @param {Object} implementation - Skill implementation with execute function
   */
  register(manifest, implementation) {
    // Validate manifest
    const validated = skillManifestSchema.parse(manifest);
    
    if (this.skills.has(validated.name)) {
      throw new ValidationError(`Skill "${validated.name}" is already registered`, {
        existingVersion: this.manifests.get(validated.name).version,
        newVersion: validated.version
      });
    }

    // Validate implementation
    if (!implementation || typeof implementation.execute !== 'function') {
      throw new ValidationError(`Skill "${validated.name}" must export an execute function`);
    }

    this.skills.set(validated.name, implementation);
    this.manifests.set(validated.name, validated);
    
    logger.info({ 
      skill: validated.name, 
      version: validated.version,
      permissions: validated.permissions 
    }, 'Skill registered');
  }

  /**
   * Unregister a skill
   */
  unregister(name) {
    if (!this.skills.has(name)) {
      throw new ValidationError(`Skill "${name}" not found`);
    }
    
    this.skills.delete(name);
    this.manifests.delete(name);
    
    logger.info({ skill: name }, 'Skill unregistered');
  }

  /**
   * Get a skill implementation
   */
  get(name) {
    return this.skills.get(name);
  }

  /**
   * Get a skill manifest
   */
  getManifest(name) {
    return this.manifests.get(name);
  }

  /**
   * Check if skill exists
   */
  has(name) {
    return this.skills.has(name);
  }

  /**
   * List all registered skills
   */
  list() {
    return Array.from(this.manifests.values()).map(manifest => ({
      ...manifest,
      loaded: true
    }));
  }

  /**
   * Get tool definitions for all skills (for OpenRouter function calling)
   */
  getToolDefinitions() {
    const tools = [];
    
    for (const [name, implementation] of this.skills) {
      if (implementation.toolDefinition) {
        tools.push(implementation.toolDefinition);
      }
    }
    
    return tools;
  }

  /**
   * Execute a skill by name
   */
  async execute(name, args) {
    const skill = this.get(name);
    if (!skill) {
      throw new ValidationError(`Skill "${name}" not found`);
    }

    const manifest = this.getManifest(name);
    logger.info({ skill: name, args }, 'Executing skill');
    
    return await skill.execute(args);
  }

  /**
   * Get registry statistics
   */
  stats() {
    return {
      total: this.skills.size,
      skills: Array.from(this.manifests.keys())
    };
  }

  /**
   * Reset registry (useful for testing)
   */
  reset() {
    this.skills.clear();
    this.manifests.clear();
  }
}

// Singleton instance
const registry = new SkillRegistry();

module.exports = {
  SkillRegistry,
  registry
};
