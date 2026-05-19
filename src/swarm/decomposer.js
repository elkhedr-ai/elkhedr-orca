/**
 * Task Decomposer
 * Breaks a complex task into subtasks and assigns agents to each.
 * Uses the CEO orchestrator model for intelligent decomposition.
 */

const path = require('path');
const fs = require('fs');

const agentsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'agents.json'), 'utf8')
);

/**
 * Select relevant agents for a subtask based on its topic.
 * Maps task keywords to agent roles by department.
 *
 * @param {string} subtaskDescription
 * @param {string} department - Optional filter by department
 * @returns {Array<{agentId: number, role: string, model: string}>}
 */
function selectAgentsForSubtask(subtaskDescription, department = null) {
  const lowerDesc = subtaskDescription.toLowerCase();

  // Keyword-to-department mapping
  const topicToDept = {
    'code|implement|build|develop|program|api|backend|frontend|database|test|debug': 'Engineering',
    'design|ui|ux|visual|art|animation|creative|brand': 'Creative',
    'market|seo|campaign|content|social|blog|email|advertise': 'Marketing',
    'sales|pricing|revenue|customer|lead|deal|contract': 'Sales',
    'operate|deploy|infra|devops|monitor|support|process|workflow': 'Operations'
  };

  let matchedDept = department;
  if (!matchedDept) {
    for (const [keywords, dept] of Object.entries(topicToDept)) {
      const pattern = new RegExp(keywords);
      if (pattern.test(lowerDesc)) {
        matchedDept = dept;
        break;
      }
    }
  }

  // Filter agents by department or return cross-functional mix
  let candidates = agentsData.agents;
  if (matchedDept) {
    candidates = candidates.filter(a => a.department === matchedDept);
  }

  // If too many, pick the most relevant ones (up to 3 per subtask)
  if (candidates.length > 3) {
    // Prioritize agents whose role keywords match the subtask
    const keywords = lowerDesc.split(/\s+/).filter(w => w.length > 3);
    const scored = candidates.map(a => {
      const roleLower = a.role.toLowerCase();
      const score = keywords.filter(k => roleLower.includes(k)).length;
      return { ...a, score };
    });
    scored.sort((a, b) => b.score - a.score);
    candidates = scored.slice(0, 3);
  }

  return candidates.map(a => ({ agentId: a.id, role: a.role, model: a.model }));
}

/**
 * Build a decomposition prompt for the CEO model.
 * @param {string} task - Original user task
 * @returns {string} Decomposition prompt
 */
function buildDecompositionPrompt(task) {
  const departments = ['Engineering', 'Creative', 'Marketing', 'Sales', 'Operations'];

  return [
    `You are the Super Orchestrator (CEO). Decompose this task into subtasks:\n\n"${task}"`,
    '',
    'For each subtask, specify:',
    '- subtask: Brief description (one line)',
    '- department: One of ' + departments.join(', '),
    '- agents_needed: Number of agents needed (1-3)',
    '',
    'Respond in JSON format:',
    '{"subtasks": [{"subtask": "...", "department": "...", "agents_needed": 1}]}',
    '',
    'Decompose into 1-4 subtasks maximum. Keep each specific and actionable.'
  ].join('\n');
}

/**
 * Parse the CEO's decomposition response into structured subtasks.
 * @param {string} ceoResponse - JSON response from CEO model
 * @returns {Array<{subtask: string, department: string, agents_needed: number}>}
 */
function parseDecomposition(ceoResponse) {
  try {
    // Try direct JSON parse
    return JSON.parse(ceoResponse).subtasks;
  } catch {
    // Try extracting JSON from markdown
    const jsonMatch = ceoResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()).subtasks;
      } catch { /* fall through */ }
    }

    // Last resort: line-by-line parsing
    const lines = ceoResponse.split('\n').filter(l => l.includes('subtask') || l.includes(':'));
    if (lines.length > 0) {
      return lines.map(line => ({
        subtask: line.replace(/^[^:]*:\s*/, '').trim(),
        department: 'Engineering',
        agents_needed: 1
      }));
    }

    // Fallback: treat entire task as one subtask
    return [{ subtask: ceoResponse.substring(0, 200), department: 'Engineering', agents_needed: 2 }];
  }
}

/**
 * Decompose a task into swarm-ready subtask plans.
 * @param {string} task - The user's task
 * @param {Function} decomposeFn - Optional: async function(task) => CEO response string
 * @returns {Promise<Array<{subtask: string, agents: Array, department: string}>>}
 */
async function decompose(task, decomposeFn = null) {
  let subtasks;

  if (decomposeFn) {
    const ceoResponse = await decomposeFn(task);
    subtasks = parseDecomposition(ceoResponse);
  } else {
    // Default decomposition for testing or when CEO is unavailable
    subtasks = [
      { subtask: task, department: null, agents_needed: 3 }
    ];
  }

  // Assign agents to each subtask
  const plans = subtasks.map(s => ({
    subtask: s.subtask,
    department: s.department || null,
    agents: selectAgentsForSubtask(s.subtask, s.department)
  }));

  return plans;
}

module.exports = { decompose, selectAgentsForSubtask, buildDecompositionPrompt, parseDecomposition };
