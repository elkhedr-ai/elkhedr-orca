/**
 * Custom Agent Manager
 * Allows users to create, manage, export, and import custom agents.
 * Supports agent templates for common roles.
 */

const path = require('path');
const fs = require('fs');

const agentsDataPath = path.join(__dirname, '..', 'agents.json');
const CUSTOM_AGENTS_PATH = path.join(__dirname, 'custom-agents.json');

/**
 * Built-in agent templates for common roles.
 * Users can use these as starting points.
 */
const AGENT_TEMPLATES = [
  {
    id: 'template-code-reviewer',
    name: 'Code Reviewer',
    role: 'Code Reviewer',
    model: 'qwen/qwen3-coder',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Engineering',
    prompt: 'You are a thorough code reviewer. Review the provided code for bugs, security issues, performance problems, and best practices. Provide actionable feedback with line-specific comments.',
    tools: ['terminal', 'url-fetch'],
    tags: ['code', 'review', 'qa'],
    category: 'Engineering'
  },
  {
    id: 'template-tech-writer',
    name: 'Technical Writer',
    role: 'Technical Writer',
    model: 'google/gemma-4-31b-it',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Creative',
    prompt: 'You are a technical writer. Create clear, well-structured documentation for the given topic. Include code examples, diagrams descriptions, and best practices where appropriate.',
    tools: ['url-fetch'],
    tags: ['docs', 'writing', 'documentation'],
    category: 'Documentation'
  },
  {
    id: 'template-data-analyst',
    name: 'Data Analyst',
    role: 'Data Analyst',
    model: 'mistralai/codestral-2508',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Engineering',
    prompt: 'You are a data analyst. Analyze the provided data, identify patterns and trends, and present insights with clear visualizations descriptions. Use statistical methods where appropriate.',
    tools: ['terminal', 'url-fetch'],
    tags: ['data', 'analysis', 'statistics'],
    category: 'Data'
  },
  {
    id: 'template-devops-engineer',
    name: 'DevOps Engineer',
    role: 'DevOps Engineer',
    model: 'qwen/qwen3-coder',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Operations',
    prompt: 'You are a DevOps engineer. Help with infrastructure as code, CI/CD pipelines, containerization, monitoring, and deployment strategies. Provide specific commands and configurations.',
    tools: ['terminal'],
    tags: ['devops', 'infrastructure', 'deployment'],
    category: 'Operations'
  },
  {
    id: 'template-security-auditor',
    name: 'Security Auditor',
    role: 'Security Auditor',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    fallbackModel: 'qwen/qwen3-coder',
    department: 'Engineering',
    prompt: 'You are a security auditor. Analyze systems, code, and configurations for security vulnerabilities. Provide CVSS scores, remediation steps, and prioritize findings by severity.',
    tools: ['url-fetch'],
    tags: ['security', 'audit', 'vulnerability'],
    category: 'Engineering'
  },
  {
    id: 'template-product-manager',
    name: 'Product Manager',
    role: 'Product Manager',
    model: 'google/gemma-4-31b-it',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Marketing',
    prompt: 'You are a product manager. Help with product strategy, feature prioritization, user stories, market analysis, and roadmap planning. Use frameworks like RICE scoring where appropriate.',
    tools: [],
    tags: ['product', 'strategy', 'management'],
    category: 'Management'
  },
  {
    id: 'template-qa-tester',
    name: 'QA Tester',
    role: 'QA Tester',
    model: 'qwen/qwen3-coder',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Engineering',
    prompt: 'You are a QA tester. Create test plans, test cases, and bug reports. Identify edge cases and potential failure modes. Suggest automated testing strategies.',
    tools: ['terminal'],
    tags: ['testing', 'qa', 'quality'],
    category: 'Engineering'
  },
  {
    id: 'template-copywriter',
    name: 'Copywriter',
    role: 'Copywriter',
    model: 'google/gemma-4-31b-it',
    fallbackModel: 'google/gemma-4-26b-a4b-it',
    department: 'Creative',
    prompt: 'You are a professional copywriter. Write compelling, persuasive copy for marketing materials, landing pages, emails, and social media. Adapt tone and style to the target audience.',
    tools: [],
    tags: ['copywriting', 'marketing', 'content'],
    category: 'Marketing'
  }
];

class CustomAgentManager {
  constructor() {
    this.customAgents = this._loadCustomAgents();
  }

  // ---- Internal ----

  _loadCustomAgents() {
    try {
      if (fs.existsSync(CUSTOM_AGENTS_PATH)) {
        return JSON.parse(fs.readFileSync(CUSTOM_AGENTS_PATH, 'utf8'));
      }
    } catch { /* file corrupt */ }
    return { agents: [], nextId: 1001 };
  }

  _saveCustomAgents() {
    fs.writeFileSync(CUSTOM_AGENTS_PATH, JSON.stringify(this.customAgents, null, 2));
  }

  _assignId() {
    const id = this.customAgents.nextId;
    this.customAgents.nextId++;
    return id;
  }

  _toBuiltinFormat(customAgent) {
    return {
      id: customAgent.id,
      role: customAgent.role,
      model: customAgent.model,
      department: customAgent.department || 'Engineering',
      fallbackModel: customAgent.fallbackModel || 'google/gemma-4-26b-a4b-it',
      isCustom: true,
      prompt: customAgent.prompt !== undefined ? customAgent.prompt : null,
      tools: customAgent.tools || [],
      tags: customAgent.tags || [],
      createdBy: customAgent.createdBy || null,
      createdAt: customAgent.createdAt || new Date().toISOString()
    };
  }

  // ---- CRUD ----

  /**
   * Create a new custom agent.
   * @param {object} config - { name, role, model, fallbackModel, department, prompt, tools, tags, createdBy }
   * @returns {object} The created agent
   */
  createAgent(config) {
    const agent = {
      id: this._assignId(),
      name: config.name || config.role,
      role: config.role,
      model: config.model || 'google/gemma-4-26b-a4b-it',
      fallbackModel: config.fallbackModel || 'google/gemma-4-26b-a4b-it',
      department: config.department || 'Engineering',
      prompt: config.prompt || '',
      tools: config.tools || [],
      tags: config.tags || [],
      createdBy: config.createdBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.customAgents.agents.push(agent);
    this._saveCustomAgents();
    return this._toBuiltinFormat(agent);
  }

  /**
   * Update an existing custom agent.
   * @param {number} id - Agent ID
   * @param {object} updates - Partial agent config to update
   * @returns {object|null} Updated agent or null if not found
   */
  updateAgent(id, updates) {
    const idx = this.customAgents.agents.findIndex(a => a.id === id);
    if (idx === -1) return null;

    const agent = this.customAgents.agents[idx];
    const allowedFields = ['name', 'role', 'model', 'fallbackModel', 'department', 'prompt', 'tools', 'tags'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        agent[field] = updates[field];
      }
    }
    agent.updatedAt = new Date().toISOString();

    this._saveCustomAgents();
    return this._toBuiltinFormat(agent);
  }

  /**
   * Delete a custom agent by ID.
   * @param {number} id
   * @returns {boolean} Whether the agent was deleted
   */
  deleteAgent(id) {
    const idx = this.customAgents.agents.findIndex(a => a.id === id);
    if (idx === -1) return false;

    this.customAgents.agents.splice(idx, 1);
    this._saveCustomAgents();
    return true;
  }

  /**
   * Get a custom agent by ID.
   * @param {number} id
   * @returns {object|null}
   */
  getAgent(id) {
    const agent = this.customAgents.agents.find(a => a.id === id);
    return agent ? this._toBuiltinFormat(agent) : null;
  }

  /**
   * List all custom agents.
   * @param {object} filters - { department, category, tag }
   * @returns {Array}
   */
  listAgents(filters = {}) {
    let agents = this.customAgents.agents.map(a => this._toBuiltinFormat(a));

    if (filters.department) {
      agents = agents.filter(a => a.department === filters.department);
    }
    if (filters.tag) {
      agents = agents.filter(a => a.tags.includes(filters.tag));
    }

    return agents;
  }

  // ---- Templates ----

  /**
   * Get all available agent templates.
   * @returns {Array}
   */
  getTemplates() {
    return AGENT_TEMPLATES;
  }

  /**
   * Create an agent from a template.
   * @param {string} templateId - Template ID from AGENT_TEMPLATES
   * @param {object} overrides - Optional field overrides (e.g., { model: 'different-model' })
   * @returns {object|null} Created agent or null if template not found
   */
  createFromTemplate(templateId, overrides = {}) {
    const template = AGENT_TEMPLATES.find(t => t.id === templateId);
    if (!template) return null;

    const config = {
      name: template.name,
      role: template.role,
      model: template.model,
      fallbackModel: template.fallbackModel,
      department: template.department,
      prompt: template.prompt,
      tools: template.tools,
      tags: [...template.tags],
      ...overrides
    };

    return this.createAgent(config);
  }

  // ---- Export / Import ----

  /**
   * Export a custom agent as a portable JSON definition.
   * @param {number} id
   * @returns {object|null} Portable agent definition
   */
  exportAgent(id) {
    const agent = this.customAgents.agents.find(a => a.id === id);
    if (!agent) return null;

    return {
      formatVersion: '1.0',
      type: 'elkhedr-orca-agent',
      agent: {
        name: agent.name,
        role: agent.role,
        model: agent.model,
        fallbackModel: agent.fallbackModel,
        department: agent.department,
        prompt: agent.prompt,
        tools: agent.tools,
        tags: agent.tags
      },
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import a custom agent from a portable JSON definition.
   * @param {object} definition - Portable agent definition (from exportAgent or file)
   * @returns {object} Created agent
   */
  importAgent(definition) {
    if (!definition || definition.type !== 'elkhedr-orca-agent') {
      throw new Error('Invalid agent definition format');
    }

    const agent = definition.agent;
    if (!agent.role || !agent.model) {
      throw new Error('Agent definition must include role and model');
    }

    return this.createAgent({
      name: agent.name || agent.role,
      role: agent.role,
      model: agent.model,
      fallbackModel: agent.fallbackModel || agent.model,
      department: agent.department,
      prompt: agent.prompt || '',
      tools: agent.tools || [],
      tags: agent.tags || []
    });
  }

  /**
   * Import an agent from a JSON file.
   * @param {string} filePath - Absolute path to JSON file
   * @returns {object} Created agent
   */
  importFromFile(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return this.importAgent(data);
  }

  // ---- Persist to agents.json ----

  /**
   * Sync custom agents into the main agents.json file.
   * Custom agents are appended with IDs starting at 1001.
   */
  syncToMainRegistry() {
    const agentsData = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));

    // Remove previously synced custom agents
    agentsData.agents = agentsData.agents.filter(a => !a.isCustom);

    // Add current custom agents
    for (const agent of this.customAgents.agents) {
      agentsData.agents.push(this._toBuiltinFormat(agent));
    }

    fs.writeFileSync(agentsDataPath, JSON.stringify(agentsData, null, 2));
    return agentsData.agents.length;
  }
}

// Singleton
let _instance = null;
function getCustomAgentManager() {
  if (!_instance) {
    _instance = new CustomAgentManager();
  }
  return _instance;
}

module.exports = {
  CustomAgentManager,
  getCustomAgentManager,
  AGENT_TEMPLATES,
  CUSTOM_AGENTS_PATH
};
