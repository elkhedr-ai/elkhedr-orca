/**
 * Voting Strategy — Majority-consensus aggregation.
 * Best for: Classification, selection, yes/no, code review approval.
 */

/**
 * Extract a vote value from an agent's output text.
 * Tries JSON, yes/no, and numeric patterns.
 */
function extractVote(output) {
  const trimmed = output.trim();

  // Try JSON with a vote field
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.vote !== undefined) return String(parsed.vote);
    if (parsed.choice !== undefined) return String(parsed.choice);
    if (parsed.selection !== undefined) return String(parsed.selection);
  } catch { /* not JSON */ }

  // Try structured patterns
  const voteMatch = trimmed.match(/^Vote:\s*(.+)$/im);
  if (voteMatch) return voteMatch[1].trim();

  const choiceMatch = trimmed.match(/^(?:Choice|Selection|Answer):\s*(.+)$/im);
  if (choiceMatch) return choiceMatch[1].trim();

  // Yes / No / Uncertain detection
  const yesMatch = trimmed.match(/^(yes|y|approve|approved|agree|true|pass)$/i);
  if (yesMatch) return yesMatch[1].toLowerCase();

  const noMatch = trimmed.match(/^(no|n|reject|rejected|disagree|false|fail)$/i);
  if (noMatch) return noMatch[1].toLowerCase();

  // Numeric score
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) return numMatch[1];

  // Fallback: return first line as vote
  return trimmed.split('\n')[0].trim();
}

/**
 * Aggregate agent outputs using majority voting.
 * @param {Array<{agentId: number, role: string, output: string}>} results
 * @returns {{ result: string, votes: Object, winner: string, tieBroken: boolean }}
 */
function aggregate(results) {
  if (!results || results.length === 0) {
    return { result: '', votes: {}, winner: null, tieBroken: false };
  }

  if (results.length === 1) {
    return {
      result: results[0].output,
      votes: { [extractVote(results[0].output)]: 1 },
      winner: extractVote(results[0].output),
      tieBroken: false
    };
  }

  const tally = {};
  const agentVotes = results.map(r => {
    const vote = extractVote(r.output);
    tally[vote] = (tally[vote] || 0) + 1;
    return { agentId: r.agentId, role: r.role, vote, output: r.output };
  });

  // Find max vote count
  const maxCount = Math.max(...Object.values(tally));
  const winners = Object.entries(tally)
    .filter(([, count]) => count === maxCount)
    .map(([vote]) => vote);

  let winner = winners[0];
  let tieBroken = false;

  if (winners.length > 1) {
    // Tie — return all tied options; caller must use synthesis or CEO tiebreak
    winner = null; // Signals tie
    tieBroken = false;
  }

  // Find the winning result output
  const winningResult = agentVotes.find(v => v.vote === winner)?.output || results[0].output;

  return {
    result: winner === null
      ? `Tie between: ${winners.join(', ')}`
      : winningResult,
    votes: tally,
    winner,
    tieBroken,
    agentVotes
  };
}

module.exports = { aggregate, extractVote };
