const { getDatabaseInstance } = require('../db');
const cache = require('../cache');

const SESSION_CACHE_TTL = 600; // 10 min

/**
 * Get session stats by session ID.
 * @param {string} sessionId
 * @param {number|null} userId - If provided, verifies ownership
 * @returns {Promise<Object|null>} Object with level, sandbox, currentAgent or null if not found.
 */
async function getSession(sessionId, userId = null) {
  if (userId === null) {
    // Try cache first
    const cached = await cache.remember(
      'session', sessionId,
      async () => {
        const db = await getDatabaseInstance();
        const row = await db.getSessionStats(sessionId, null);
        if (!row) return null;
        return {
          level: row.level,
          sandbox: !!row.sandbox,
          currentAgent: row.currentAgent
        };
      },
      SESSION_CACHE_TTL
    );
    return cached;
  }

  // With userId verification, skip cache
  const db = await getDatabaseInstance();
  const row = await db.getSessionStats(sessionId, userId);
  if (!row) return null;
  return {
    level: row.level,
    sandbox: !!row.sandbox,
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
  // Invalidate cache
  await cache.del(cache.buildKey('session', sessionId));
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
