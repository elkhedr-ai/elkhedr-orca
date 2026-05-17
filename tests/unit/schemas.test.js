/**
 * Unit tests for Zod schemas
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  promptSchema,
  agentSchema,
  executeTerminalSchema,
  webSearchSchema,
  fetchUrlSchema
} = require('../../src/schemas/index.js');

describe('Prompt Schema', () => {
  it('should validate a normal prompt', () => {
    const result = promptSchema.parse('Hello world');
    assert.strictEqual(result, 'Hello world');
  });

  it('should reject empty prompt', () => {
    assert.throws(() => promptSchema.parse(''), { message: /cannot be empty/ });
  });

  it('should reject prompt with script tags', () => {
    assert.throws(() => promptSchema.parse('test <script>alert(1)</script>'), { message: /injection/ });
  });

  it('should reject prompt with php tags', () => {
    assert.throws(() => promptSchema.parse('test <?php echo 1; ?>'), { message: /injection/ });
  });
});

describe('Agent Schema', () => {
  it('should validate correct agent config', () => {
    const agent = {
      id: 1,
      role: 'Test Agent',
      model: 'test/model',
      department: 'Engineering',
      fallbackModel: 'fallback/model'
    };
    const result = agentSchema.parse(agent);
    assert.strictEqual(result.role, 'Test Agent');
  });

  it('should reject invalid department', () => {
    assert.throws(() => agentSchema.parse({
      id: 1,
      role: 'Test',
      model: 'test',
      department: 'Invalid',
      fallbackModel: 'fallback'
    }));
  });
});

describe('Tool Parameter Schemas', () => {
  it('should validate terminal command', () => {
    const result = executeTerminalSchema.parse({ command: 'ls -la' });
    assert.strictEqual(result.command, 'ls -la');
  });

  it('should reject dangerous commands', () => {
    assert.throws(() => executeTerminalSchema.parse({ command: 'rm -rf /' }), { message: /Dangerous/ });
  });

  it('should validate search query', () => {
    const result = webSearchSchema.parse({ query: 'hello world' });
    assert.strictEqual(result.query, 'hello world');
  });

  it('should validate URL', () => {
    const result = fetchUrlSchema.parse({ url: 'https://example.com' });
    assert.strictEqual(result.url, 'https://example.com');
  });

  it('should reject invalid URL', () => {
    assert.throws(() => fetchUrlSchema.parse({ url: 'not-a-url' }), { message: /Invalid URL/ });
  });
});
