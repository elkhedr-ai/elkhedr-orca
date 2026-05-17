# Circuit Breaker Pattern

## Overview

Orca implements the Circuit Breaker pattern to prevent cascading failures when the OpenRouter API experiences issues. This resilience mechanism automatically stops sending requests to a failing service, allowing it time to recover while providing fast-fail responses to users.

## How It Works

The circuit breaker operates in three states:

### 1. CLOSED (Normal Operation)
- All requests pass through to the OpenRouter API
- Failures are tracked but don't block requests
- System operates normally

### 2. OPEN (Service Failing)
- Circuit "trips" after reaching failure threshold (default: 5 failures)
- All requests are immediately rejected without calling the API
- Error message indicates service is temporarily unavailable
- Automatic recovery attempt after reset timeout (default: 30 seconds)

### 3. HALF_OPEN (Testing Recovery)
- After reset timeout, circuit allows test requests through
- If requests succeed (default: 2 consecutive successes), circuit closes
- If requests fail, circuit reopens immediately
- Prevents premature recovery from transient issues

## Configuration

The circuit breaker is configured in `src/core.js` with the following defaults:

```javascript
const openRouterCircuitBreaker = createCircuitBreaker('OpenRouter', {
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 2,      // Close after 2 consecutive successes in HALF_OPEN
  timeout: 60000,           // 60 second request timeout
  resetTimeout: 30000       // Try recovery after 30 seconds
});
```

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failureThreshold` | 5 | Number of failures before opening circuit |
| `successThreshold` | 2 | Number of successes needed to close circuit |
| `timeout` | 60000ms | Maximum time to wait for API response |
| `resetTimeout` | 30000ms | Time to wait before attempting recovery |

## Monitoring

### CLI Health Check

Use the `/health` command in the Orca TUI to check circuit breaker status:

```bash
orca
> /health
```

This displays:
- Current circuit state (CLOSED/OPEN/HALF_OPEN)
- Health status (HEALTHY/DEGRADED)
- Failure count vs threshold
- Time since last failure
- Time until next retry attempt (when OPEN)

### Programmatic Access

```javascript
const { getCircuitBreakerStatus } = require('./src/core.js');

const status = getCircuitBreakerStatus();
console.log(status);
// {
//   name: 'OpenRouter',
//   state: 'CLOSED',
//   failureCount: 0,
//   successCount: 0,
//   failureThreshold: 5,
//   successThreshold: 2,
//   lastFailureTime: null,
//   nextAttempt: null,
//   isHealthy: true
// }
```

## Manual Control

### Reset Circuit Breaker

Force the circuit breaker back to CLOSED state:

```javascript
const { resetCircuitBreaker } = require('./src/core.js');
resetCircuitBreaker();
```

Or via CLI:
```bash
> /health
# Select "Reset Circuit Breaker" option
```

### Force Open

For testing or maintenance:

```javascript
const { getCircuitBreakerStatus } = require('./src/core.js');
const breaker = getCircuitBreakerStatus();
breaker.forceOpen();
```

## Error Handling

When the circuit is OPEN, API calls throw an `APIError`:

```javascript
try {
  await orchestrate(prompt);
} catch (error) {
  if (error.code === 'API_ERROR' && error.message.includes('Circuit breaker is OPEN')) {
    console.log('Service temporarily unavailable');
    console.log(`Retry in ${error.details.retryAfter} seconds`);
  }
}
```

## Logging

Circuit breaker events are logged with structured logging:

```javascript
// Failure recorded
[WARN] Circuit breaker recorded failure
  state: "CLOSED"
  failureCount: 3
  threshold: 5

// Circuit opened
[ERROR] Circuit breaker OPEN - failure threshold exceeded
  state: "OPEN"
  failureCount: 5
  nextAttempt: "2024-01-15T10:30:00.000Z"

// Recovery attempt
[INFO] Circuit breaker transitioning to HALF_OPEN
  state: "HALF_OPEN"

// Recovery successful
[INFO] Circuit breaker CLOSED - service recovered
  state: "CLOSED"
```

## Best Practices

### 1. Monitor Circuit State
- Check `/health` regularly during high-load periods
- Set up alerts for circuit OPEN events in production
- Track failure patterns to identify systemic issues

### 2. Tune Thresholds
- Increase `failureThreshold` for flaky networks
- Decrease `resetTimeout` for faster recovery attempts
- Adjust `successThreshold` based on confidence needs

### 3. Graceful Degradation
- Implement fallback responses when circuit is OPEN
- Cache previous results for read-heavy operations
- Queue non-urgent requests for later retry

### 4. Testing
- Simulate failures to verify circuit behavior
- Test recovery scenarios in staging
- Verify timeout values match SLA requirements

## Integration with Retry Logic

The circuit breaker works in conjunction with the retry mechanism:

1. **First Layer**: Retry logic attempts up to 3 retries with exponential backoff
2. **Second Layer**: Circuit breaker tracks overall failure rate across all retries
3. **Result**: Fast-fail when service is consistently down, retry for transient errors

```
Request → Circuit Breaker → Retry Logic → OpenRouter API
            ↓ (if OPEN)
         Fast Fail
```

## Troubleshooting

### Circuit Keeps Opening
- **Cause**: OpenRouter API is experiencing issues
- **Solution**: Check OpenRouter status page, wait for recovery
- **Workaround**: Increase `failureThreshold` temporarily

### Circuit Won't Close
- **Cause**: Service still failing during HALF_OPEN tests
- **Solution**: Wait longer, check API key validity
- **Workaround**: Manual reset via `/health` command

### False Positives
- **Cause**: Network issues or timeout too aggressive
- **Solution**: Increase `timeout` value
- **Prevention**: Monitor network latency patterns

## Performance Impact

- **Overhead**: Minimal (~1ms per request)
- **Memory**: ~1KB per circuit breaker instance
- **Benefits**: 
  - Prevents wasted API calls during outages
  - Reduces user wait time (fast-fail vs timeout)
  - Protects against cascading failures

## Future Enhancements

Planned improvements for the circuit breaker:

- [ ] Multiple circuit breakers per model/provider
- [ ] Adaptive thresholds based on historical data
- [ ] Metrics export to Prometheus
- [ ] Dashboard visualization of circuit state over time
- [ ] Webhook notifications for state changes
- [ ] Per-agent circuit breaker configuration

## References

- [Martin Fowler - Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Microsoft - Circuit Breaker Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- Task T2 in `ORCA_PRODUCTION_ROADMAP.csv`