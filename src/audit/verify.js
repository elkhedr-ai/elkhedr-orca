/**
 * Audit Log Verification
 * Command-line and programmatic verification of audit log integrity
 */

const { verifyAuditLog, getAuditLogs } = require('./logger');

/**
 * Verify the entire audit log chain
 * Prints results to console for CLI usage
 */
async function verifyAndReport() {
  console.log('Verifying audit log integrity...\n');

  const result = await verifyAuditLog();

  if (result.valid) {
    console.log('✓ Audit log integrity verified');
    console.log(`✓ All ${result.lastValidId} entries are valid`);
    console.log('✓ Hash chain is intact - no tampering detected');
  } else {
    console.error('✗ Audit log integrity check FAILED');
    console.error(`✗ Found ${result.errors.length} errors:`);
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }

  return result;
}

/**
 * Get summary of recent audit activity
 * @param {number} days - Number of days to summarize
 */
async function getActivitySummary(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logs = await getAuditLogs({
    startDate: startDate.toISOString(),
    limit: 1000
  });

  const summary = {
    totalEvents: logs.length,
    byType: {},
    byStatus: {},
    byAction: {},
    failedEvents: logs.filter(l => l.status === 'failure').length,
    period: `${days} days`
  };

  for (const log of logs) {
    summary.byType[log.eventType] = (summary.byType[log.eventType] || 0) + 1;
    summary.byStatus[log.status] = (summary.byStatus[log.status] || 0) + 1;
    summary.byAction[log.action] = (summary.byAction[log.action] || 0) + 1;
  }

  return summary;
}

/**
 * Check for suspicious activity patterns
 * @param {number} threshold - Number of failed attempts to flag
 */
async function detectAnomalies(threshold = 5) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // Last 24 hours

  const logs = await getAuditLogs({
    startDate: startDate.toISOString(),
    status: 'failure',
    limit: 1000
  });

  // Group by user and action
  const grouped = {};
  for (const log of logs) {
    const key = `${log.userId || 'anonymous'}-${log.action}`;
    if (!grouped[key]) {
      grouped[key] = {
        userId: log.userId,
        action: log.action,
        count: 0,
        events: []
      };
    }
    grouped[key].count++;
    grouped[key].events.push(log);
  }

  const anomalies = Object.values(grouped)
    .filter(g => g.count >= threshold)
    .map(g => ({
      userId: g.userId,
      action: g.action,
      failedAttempts: g.count,
      timeSpan: `${g.events[0].createdAt} to ${g.events[g.events.length - 1].createdAt}`
    }));

  return anomalies;
}

module.exports = {
  verifyAndReport,
  getActivitySummary,
  detectAnomalies
};
