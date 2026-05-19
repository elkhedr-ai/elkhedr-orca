const { getSession, upsertSession } = require('./store');

/**
 * Get session stats, creating a default if none exists.
 * @param {string} sessionId - If not provided, a new UUID will be generated.
 * @param {number|null} userId - Optional user_id for ownership verification
 * @returns {Promise<Object>} Session stats object.
 */
async function getOrCreateSession(sessionId, userId = null) {
  if (!sessionId) {
    // Generate a new session ID if none provided
    const { randomUUID } = require('crypto');
    sessionId = randomUUID();
  }

  let stats = await getSession(sessionId, userId);
  if (!stats) {
    // Create default session stats
    stats = { level: 'Auto', sandbox: false, currentAgent: null };
    await upsertSession(sessionId, stats, userId);
    return { sessionId, ...stats };
  }

  return { sessionId, ...stats };
}

/**
 * Update session stats.
 * @param {string} sessionId
 * @param {Object} updates - Partial stats to update (level, sandbox, currentAgent)
 * @param {number|null} userId - Optional user_id for ownership verification
 */
async function updateSession(sessionId, updates, userId = null) {
  const current = await getSession(sessionId, userId);
  if (!current) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const newStats = { ...current, ...updates };
  await upsertSession(sessionId, newStats, userId);
}

module.exports = { getOrCreateSession, updateSession };
