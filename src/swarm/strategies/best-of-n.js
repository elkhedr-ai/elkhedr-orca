/**
 * Best-of-N Strategy — Score each output and return the highest-scoring.
 * Best for: Code generation, architecture proposals, content creation.
 */

/**
 * Score an output based on quality heuristics.
 * In production, this should use an LLM-as-judge call.
 *
 * @param {string} output - Agent output text
 * @param {object} options
 * @param {string} options.task - Original task description (for context)
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreOutput(output, options = {}) {
  const reasons = [];
  let score = 0;

  if (!output || output.trim().length === 0) {
    return { score: 0, reasons: ['Empty output'] };
  }

  const text = output.trim();

  // Length signals substance
  if (text.length > 500) { score += 2; reasons.push('Substantial length'); }
  else if (text.length > 100) { score += 1; reasons.push('Adequate length'); }
  else { score -= 1; reasons.push('Too brief'); }

  // Code blocks indicate actionable output
  const codeBlocks = (text.match(/```/g) || []).length / 2;
  if (codeBlocks >= 3) { score += 3; reasons.push('Rich code examples'); }
  else if (codeBlocks >= 1) { score += 1; reasons.push('Has code blocks'); }

  // Structure signals quality
  if (text.includes('##') || text.includes('---')) { score += 1; reasons.push('Well-structured'); }
  if (text.includes('1.') || text.includes('- ')) { score += 1; reasons.push('Uses lists'); }

  // Actionable output signals
  if (/steps|implementation|solution|approach|plan/i.test(text)) { score += 1; reasons.push('Action-oriented'); }

  // Confidence indicators
  if (/definitely|certainly|absolutely|strongly/i.test(text)) { score += 1; reasons.push('High confidence'); }

  return { score, reasons };
}

/**
 * Aggregate agent outputs by scoring each and returning the best.
 * @param {Array<{agentId: number, role: string, output: string}>} results
 * @param {object} options
 * @param {string} options.task - Original task description
 * @returns {{ result: string, scores: Array, winner: object }}
 */
function aggregate(results, options = {}) {
  if (!results || results.length === 0) {
    return { result: '', scores: [], winner: null };
  }

  const scored = results.map(r => ({
    agentId: r.agentId,
    role: r.role,
    output: r.output,
    ...scoreOutput(r.output, options)
  }));

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  return {
    result: winner.output,
    scores: scored.map(s => ({ agentId: s.agentId, role: s.role, score: s.score, reasons: s.reasons })),
    winner: { agentId: winner.agentId, role: winner.role, score: winner.score }
  };
}

/**
 * LLM-as-judge scoring: use a judge model to rate outputs.
 * This is an async placeholder — integrate with callOpenRouter in production.
 */
async function judgeOutputs(results, task, judgeFn) {
  if (!judgeFn) {
    // Fallback to heuristic scoring
    return aggregate(results, { task });
  }

  const scored = await Promise.all(results.map(async r => {
    const score = await judgeFn(r.output, task);
    return { ...r, score };
  }));

  scored.sort((a, b) => b.score - a.score);
  return {
    result: scored[0].output,
    scores: scored.map(s => ({ agentId: s.agentId, role: s.role, score: s.score })),
    winner: { agentId: scored[0].agentId, role: scored[0].role, score: scored[0].score }
  };
}

module.exports = { aggregate, scoreOutput, judgeOutputs };
