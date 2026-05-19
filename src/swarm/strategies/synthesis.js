/**
 * Synthesis Strategy — LLM-based merge of all agent outputs.
 * Best for: Research, analysis, planning, complex tasks.
 */

/**
 * Build a synthesis prompt that asks the orchestrator to merge multiple outputs.
 *
 * @param {string} task - Original task description
 * @param {Array<{agentId: number, role: string, output: string}>} results
 * @returns {string} A prompt suitable for an LLM merge call
 */
function buildSynthesisPrompt(task, results) {
  const sections = results.map((r, i) =>
    `## Agent ${i + 1}: ${r.role}\n${r.output}`
  );

  return [
    `You are the Super Orchestrator (CEO). Your task was: "${task}"`,
    '',
    'Below are the responses from your specialist agents. Synthesize them into a single coherent output.',
    'Preserve all valuable insights. Resolve contradictions by preferring the most detailed and specific response.',
    'Structure the final output with clear sections.',
    '',
    sections.join('\n\n'),
    '',
    '---',
    'Now produce the synthesized final answer:'
  ].join('\n');
}

/**
 * Aggregate agent outputs by merging into a synthesis prompt.
 * Returns the prompt and metadata — the caller must invoke the LLM.
 *
 * @param {Array<{agentId: number, role: string, output: string}>} results
 * @param {object} options
 * @param {string} options.task - Original task description
 * @returns {{ synthesisPrompt: string, metadata: object }}
 */
function aggregate(results, options = {}) {
  if (!results || results.length === 0) {
    return { synthesisPrompt: '', metadata: { agentCount: 0 } };
  }

  if (results.length === 1) {
    return {
      synthesisPrompt: results[0].output,
      metadata: { agentCount: 1, singleOutput: true }
    };
  }

  const task = options.task || 'See agent outputs below';
  const synthesisPrompt = buildSynthesisPrompt(task, results);

  return {
    synthesisPrompt,
    metadata: {
      agentCount: results.length,
      agents: results.map(r => ({ agentId: r.agentId, role: r.role })),
      task
    }
  };
}

module.exports = { aggregate, buildSynthesisPrompt };
