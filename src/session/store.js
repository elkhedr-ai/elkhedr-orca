const { getDatabaseInstance } = require('../db');

/**
 * Get session stats by session ID.
 * @param {string} sessionId
 * @param {number|null} userId - If provided, verifies ownership
 * @returns {Promise<Object|null>} Object with level, sandbox, currentAgent or null if not found.
 */
async function getSession(sessionId, userId = null) {
  const db = await getDatabaseInstance();
  const row = await db.getSessionStats(sessionId, userId);
  if (!row) return null;
  return {
    level: row.level,
    sandbox: !!row.sandbox, // convert 0/1 to boolean
    currentAgent: row.currentAgent
  };
}

/**
 * Create or update session stats.
 * @param {string} sessionId
 * @param {Object} stats - {level, sandbox, currentAgent}
 * @param {number|null} userId - Optional user_id to associate with session
 */
async function upsertSession(sessionId, stats, userId = null) {
  const db = await getDatabaseInstance();
  await db.upsertSessionStats(sessionId, {
    level: stats.level,
    sandbox: stats.sandbox ? 1 : 0,
    currentAgent: stats.currentAgent,
    userId: userId
  });
}

/**
 * Clean up expired sessions (older than maxAgeInDays)
 * @param {number} maxAgeInDays - Maximum age in days for sessions to keep
 * @returns {Promise<number>} Number of sessions removed
 */
async function cleanupExpiredSessions(maxAgeInDays = 30) {
  const db = await getDatabaseInstance();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeInDays);
  const cutoffISO = cutoffDate.toISOString().replace('T', ' ').substring(0, 19);

  const result = await db.adapter.run(
    `DELETE FROM session_stats WHERE updated_at < ?;`,
    [cutoffISO]
  );

  return result.changes;
}

module.exports = { getSession, upsertSession, cleanupExpiredSessions };
