/**
 * Conflict Resolution Module
 * Detects and resolves conflicts between agent outputs.
 */

/**
 * Detect conflicts between agent outputs.
 * @param {Array<{agentId: number, role: string, output: string}>} results
 * @returns {Array<{type: string, agents: number[], description: string}>}
 */
function detectConflicts(results) {
  const conflicts = [];

  if (!results || results.length < 2) return conflicts;

  // Check for contradictory boolean/yes-no answers
  const yesNoPattern = /^(yes|y|approve|true|no|n|reject|false)$/i;
  const binaryVotes = results
    .map(r => {
      const match = r.output.trim().match(yesNoPattern);
      return match ? { agentId: r.agentId, role: r.role, vote: match[1].toLowerCase() } : null;
    })
    .filter(Boolean);

  const yesVotes = binaryVotes.filter(v => /^(yes|y|approve|true)$/i.test(v.vote));
  const noVotes = binaryVotes.filter(v => /^(no|n|reject|false)$/i.test(v.vote));

  if (yesVotes.length > 0 && noVotes.length > 0) {
    conflicts.push({
      type: 'binary_contradiction',
      agents: [...yesVotes.map(v => v.agentId), ...noVotes.map(v => v.agentId)],
      description: `${yesVotes.length} agent(s) approve, ${noVotes.length} reject`
    });
  }

  // Check for different numerical estimates
  const numberPattern = /(\d+(?:\.\d+)?)\s*(?:hours?|days?|weeks?|months?|\$|USD|EUR|%)/i;
  const estimates = results
    .map(r => {
      const match = r.output.match(numberPattern);
      return match ? { agentId: r.agentId, role: r.role, value: parseFloat(match[1]), unit: match[2] } : null;
    })
    .filter(Boolean);

  if (estimates.length >= 2) {
    const values = estimates.map(e => e.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    if (maxVal / minVal > 2) {
      conflicts.push({
        type: 'estimate_divergence',
        agents: estimates.map(e => e.agentId),
        description: `Estimates vary from ${minVal} to ${maxVal} ${estimates[0].unit} (${(maxVal / minVal).toFixed(1)}x range)`
      });
    }
  }

  // Check for contradictory facts (mutually exclusive claims)
  const factPatterns = [
    { neg: /(cannot|should not|must not|don't|doesn't)/i, pos: /(can|should|must|doe?s)\s/i },
    { neg: /(not recommended|bad practice|anti-pattern)/i, pos: /(recommended|best practice|pattern)/i }
  ];

  for (const pattern of factPatterns) {
    const posAgents = results.filter(r => pattern.pos.test(r.output)).map(r => r.agentId);
    const negAgents = results.filter(r => pattern.neg.test(r.output)).map(r => r.agentId);
    if (posAgents.length > 0 && negAgents.length > 0) {
      conflicts.push({
        type: 'factual_contradiction',
        agents: [...posAgents, ...negAgents],
        description: `${posAgents.length} agent(s) assert, ${negAgents.length} agent(s) deny`
      });
      break; // One contradiction type is enough to flag
    }
  }

  return conflicts;
}

/**
 * Build a conflict resolution prompt for the CEO model.
 * @param {string} task - Original task
 * @param {Array} results - Agent outputs
 * @param {Array} conflicts - Detected conflicts
 * @returns {string} CEO prompt
 */
function buildResolutionPrompt(task, results, conflicts) {
  if (conflicts.length === 0) return null;

  const sections = results.map((r, i) =>
    `## Agent ${i + 1} (${r.role})\n${r.output}`
  ).join('\n\n');

  const conflictDescriptions = conflicts.map((c, i) =>
    `${i + 1}. ${c.description} (${c.type}) — agents: ${c.agents.join(', ')}`
  ).join('\n');

  return [
    `You are the Super Orchestrator resolving conflicts. Original task: "${task}"`,
    '',
    'The following conflicts were detected between specialist agents:',
    conflictDescriptions,
    '',
    'Agent outputs:',
    sections,
    '',
    'Resolve each conflict:',
    '- For contradictions: decide which agent is correct and explain why',
    '- For estimate divergence: provide a consolidated estimate with range',
    '- Preserve non-conflicting information from all agents',
    '',
    'Provide the final resolved output:'
  ].join('\n');
}

module.exports = { detectConflicts, buildResolutionPrompt };
