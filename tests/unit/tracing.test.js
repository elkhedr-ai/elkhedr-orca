/**
 * Unit tests for tracing system
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  generateTraceId,
  generateSpanId,
  getTraceContext,
  getTraceId,
  withTrace,
  withChildTrace,
  addTraceMetadata,
  getTraceChain,
  formatTraceForLog
} = require('../../src/utils/tracing.js');

describe('Trace ID Generation', () => {
  it('should generate unique trace IDs', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    assert.notStrictEqual(id1, id2);
    assert.ok(id1.startsWith('trace_'));
    assert.ok(id2.startsWith('trace_'));
  });

  it('should generate span IDs', () => {
    const span = generateSpanId();
    assert.strictEqual(span.length, 8); // 4 bytes = 8 hex chars
    assert.ok(/^[a-f0-9]+$/.test(span));
  });
});

describe('Trace Context', () => {
  it('should return null when no trace context exists', () => {
    assert.strictEqual(getTraceContext(), null);
    assert.strictEqual(getTraceId(), null);
  });

  it('should create trace context with withTrace', async () => {
    await withTrace(async (traceId) => {
      const context = getTraceContext();
      assert.ok(context);
      assert.strictEqual(context.traceId, traceId);
      assert.ok(context.spanId);
      assert.strictEqual(context.parentTraceId, null);
      assert.strictEqual(context.operation, 'unknown');
    });
  });

  it('should propagate trace context through async operations', async () => {
    await withTrace(async () => {
      const context1 = getTraceContext();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const context2 = getTraceContext();
      assert.strictEqual(context1.traceId, context2.traceId);
      assert.strictEqual(context1.spanId, context2.spanId);
    });
  });

  it('should accept custom trace ID', async () => {
    const customId = 'trace_custom_123';
    await withTrace(async (traceId) => {
      assert.strictEqual(traceId, customId);
      assert.strictEqual(getTraceId(), customId);
    }, { traceId: customId });
  });

  it('should accept operation name', async () => {
    await withTrace(async () => {
      const context = getTraceContext();
      assert.strictEqual(context.operation, 'test-operation');
    }, { operation: 'test-operation' });
  });

  it('should accept metadata', async () => {
    await withTrace(async () => {
      addTraceMetadata('key', 'value');
      const context = getTraceContext();
      assert.strictEqual(context.metadata.key, 'value');
    }, { metadata: { initial: true } });
  });
});

describe('Child Traces', () => {
  it('should create child traces with parent reference', async () => {
    await withTrace(async (parentId) => {
      await withChildTrace(async (childId) => {
        const context = getTraceContext();
        assert.strictEqual(context.parentTraceId, parentId);
        assert.notStrictEqual(childId, parentId);
      });
    });
  });

  it('should maintain separate contexts for sibling traces', async () => {
    const ids = [];
    
    await withTrace(async () => {
      const parentId = getTraceId();
      
      await Promise.all([
        withChildTrace(async () => {
          ids.push(getTraceId());
        }),
        withChildTrace(async () => {
          ids.push(getTraceId());
        })
      ]);
      
      // Parent context should still be intact
      assert.strictEqual(getTraceId(), parentId);
    });
    
    // Two different child IDs should have been generated
    assert.strictEqual(ids.length, 2);
    assert.notStrictEqual(ids[0], ids[1]);
  });
});

describe('Trace Chain', () => {
  it('should return trace chain', async () => {
    await withTrace(async () => {
      const chain = getTraceChain();
      assert.ok(Array.isArray(chain));
      assert.strictEqual(chain.length, 1);
      assert.ok(chain[0].startsWith('trace_'));
    });
  });
});

describe('Format for Log', () => {
  it('should return empty object when no trace', () => {
    const formatted = formatTraceForLog();
    assert.deepStrictEqual(formatted, {});
  });

  it('should format trace for logging', async () => {
    await withTrace(async () => {
      const formatted = formatTraceForLog();
      assert.ok(formatted.traceId);
      assert.ok(formatted.spanId);
      assert.ok(formatted.operation);
    }, { operation: 'test-op' });
  });
});

describe('Trace Isolation', () => {
  it('should isolate parallel traces', async () => {
    const results = await Promise.all([
      withTrace(async () => {
        await new Promise(r => setTimeout(r, 20));
        return getTraceId();
      }),
      withTrace(async () => {
        await new Promise(r => setTimeout(r, 10));
        return getTraceId();
      })
    ]);
    
    assert.notStrictEqual(results[0], results[1]);
  });

  it('should not leak context after trace ends', async () => {
    await withTrace(async () => {
      assert.ok(getTraceContext());
    });
    assert.strictEqual(getTraceContext(), null);
  });
});
