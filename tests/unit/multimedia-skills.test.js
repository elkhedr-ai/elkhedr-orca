/**
 * Tests for T45: Image & Audio Processing
 * Tests vision skill, audio skill, input validation schemas.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock responses — set per-test
const mockAxiosResponses = { post: null, get: null };

const mockAxios = {
  post: async (...args) => {
    if (mockAxiosResponses.post) return mockAxiosResponses.post(...args);
    return { data: { choices: [{ message: { content: 'Mock result' } }] } };
  },
  get: async (...args) => {
    if (mockAxiosResponses.get) return mockAxiosResponses.get(...args);
    return { data: Buffer.from('mock data') };
  }
};

// Inject mocks BEFORE any skill module loads using resolved paths
const axiosPath = require.resolve('axios');
require.cache[axiosPath] = { id: axiosPath, exports: mockAxios, loaded: true, filename: axiosPath };

class MockFormData {
  constructor() { this._fields = {}; }
  append(key, value) { this._fields[key] = value; }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
}
const formPath = require.resolve('form-data');
require.cache[formPath] = { id: formPath, exports: MockFormData, loaded: true, filename: formPath };

const { imageAnalysisSchema, audioTranscribeSchema } = require('../../src/schemas/index.js');

// Helper to reload skill modules so they pick up mocks
function loadVisionSkill() {
  const modPath = require.resolve('../../skills/vision/index.js');
  delete require.cache[modPath];
  return require('../../skills/vision/index.js');
}

function loadAudioSkill() {
  const modPath = require.resolve('../../skills/audio/index.js');
  delete require.cache[modPath];
  return require('../../skills/audio/index.js');
}

describe('T45: Vision Skill', () => {
  let tempImagePath;

  beforeEach(() => {
    tempImagePath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`);
    fs.writeFileSync(tempImagePath, Buffer.from('fake-png-data'));
    mockAxiosResponses.post = null;
    mockAxiosResponses.get = null;
  });

  afterEach(() => {
    try { fs.unlinkSync(tempImagePath); } catch {}
  });

  it('should export execute and toolDefinition', () => {
    const skill = loadVisionSkill();
    assert.strictEqual(typeof skill.execute, 'function');
    assert.strictEqual(typeof skill.toolDefinition, 'object');
    assert.strictEqual(skill.toolDefinition.type, 'function');
    assert.strictEqual(skill.toolDefinition.function.name, 'vision');
  });

  it('should require prompt', async () => {
    const skill = loadVisionSkill();
    await assert.rejects(
      () => skill.execute({ image_path: tempImagePath }),
      { message: /prompt is required/ }
    );
  });

  it('should require image_path or image_url', async () => {
    const skill = loadVisionSkill();
    await assert.rejects(
      () => skill.execute({ prompt: 'describe' }),
      { message: /Either image_path or image_url/ }
    );
  });

  it('should reject path traversal', async () => {
    const skill = loadVisionSkill();
    await assert.rejects(
      () => skill.execute({ image_path: '../../../etc/passwd', prompt: 'describe' }),
      { message: /Path traversal/ }
    );
  });

  it('should reject unsupported image formats', async () => {
    const skill = loadVisionSkill();
    const badPath = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(badPath, 'not an image');
    try {
      await assert.rejects(
        () => skill.execute({ image_path: badPath, prompt: 'describe' }),
        { message: /Unsupported image format/ }
      );
    } finally {
      try { fs.unlinkSync(badPath); } catch {}
    }
  });

  it('should reject missing image file', async () => {
    const skill = loadVisionSkill();
    await assert.rejects(
      () => skill.execute({ image_path: '/nonexistent/image.png', prompt: 'describe' }),
      { message: /Image file not found/ }
    );
  });

  it('should analyze a local image via vision model', async () => {
    mockAxiosResponses.post = async (url, body) => {
      assert.ok(url.includes('/chat/completions'));
      const content = body.messages[0].content;
      assert.strictEqual(content[0].type, 'text');
      assert.strictEqual(content[1].type, 'image_url');
      assert.ok(content[1].image_url.url.startsWith('data:image/png;base64,'));
      return { data: { choices: [{ message: { content: 'A test image with a cat' } }] } };
    };

    const skill = loadVisionSkill();
    const result = await skill.execute({
      image_path: tempImagePath,
      prompt: 'Describe this image'
    });
    assert.strictEqual(result, 'A test image with a cat');
  });

  it('should analyze an image from URL', async () => {
    mockAxiosResponses.post = async (url, body) => {
      const content = body.messages[0].content;
      assert.strictEqual(content[1].image_url.url, 'https://example.com/image.jpg');
      return { data: { choices: [{ message: { content: 'A landscape photo' } }] } };
    };

    const skill = loadVisionSkill();
    const result = await skill.execute({
      image_url: 'https://example.com/image.jpg',
      prompt: 'Describe this image'
    });
    assert.strictEqual(result, 'A landscape photo');
  });

  it('should reject invalid image_url', async () => {
    const skill = loadVisionSkill();
    await assert.rejects(
      () => skill.execute({ image_url: 'not-a-url', prompt: 'describe' }),
      { message: /valid HTTP\/HTTPS URL/ }
    );
  });
});

describe('T45: Audio Skill', () => {
  let tempAudioPath;
  const origCreateReadStream = fs.createReadStream;

  beforeEach(() => {
    tempAudioPath = path.join(os.tmpdir(), `test-audio-${Date.now()}.mp3`);
    fs.writeFileSync(tempAudioPath, Buffer.from('fake-audio-data'));
    mockAxiosResponses.post = null;
    mockAxiosResponses.get = null;
    // Mock createReadStream to avoid real stream -> ENOENT on cleanup
    // MockFormData never reads the stream, so a no-op is fine
    fs.createReadStream = (filePath) => {
      const { Readable } = require('stream');
      const s = new Readable({ read() {} });
      s.push(null);
      s.path = filePath;
      return s;
    };
  });

  afterEach(() => {
    fs.createReadStream = origCreateReadStream;
    try { fs.unlinkSync(tempAudioPath); } catch {}
  });

  it('should export execute and toolDefinition', () => {
    const skill = loadAudioSkill();
    assert.strictEqual(typeof skill.execute, 'function');
    assert.strictEqual(typeof skill.toolDefinition, 'object');
    assert.strictEqual(skill.toolDefinition.type, 'function');
    assert.strictEqual(skill.toolDefinition.function.name, 'audio');
  });

  it('should require audio_path or audio_url', async () => {
    const skill = loadAudioSkill();
    await assert.rejects(
      () => skill.execute({}),
      { message: /Either audio_path or audio_url/ }
    );
  });

  it('should reject path traversal', async () => {
    const skill = loadAudioSkill();
    await assert.rejects(
      () => skill.execute({ audio_path: '../../../etc/passwd' }),
      { message: /Path traversal/ }
    );
  });

  it('should reject unsupported audio formats', async () => {
    const skill = loadAudioSkill();
    const badPath = path.join(os.tmpdir(), `test-${Date.now()}.xyz`);
    fs.writeFileSync(badPath, 'not audio');
    try {
      await assert.rejects(
        () => skill.execute({ audio_path: badPath }),
        { message: /Unsupported audio format/ }
      );
    } finally {
      try { fs.unlinkSync(badPath); } catch {}
    }
  });

  it('should reject missing audio file', async () => {
    const skill = loadAudioSkill();
    await assert.rejects(
      () => skill.execute({ audio_path: '/nonexistent/audio.mp3' }),
      { message: /Audio file not found/ }
    );
  });

  it('should transcribe a local audio file', async () => {
    mockAxiosResponses.post = async (url, body) => {
      assert.ok(url.includes('/audio/transcriptions'));
      return { data: { text: 'Hello, this is a test transcript.' } };
    };

    const skill = loadAudioSkill();
    const result = await skill.execute({ audio_path: tempAudioPath });
    assert.strictEqual(result, 'Hello, this is a test transcript.');
  });

  it('should transcribe audio from URL', async () => {
    // Mock fs for URL download path — avoid real file I/O for temp files
    const tempFiles = new Map();
    const origWriteFileSync = fs.writeFileSync;
    const origCreateReadStream = fs.createReadStream;
    const origUnlinkSync = fs.unlinkSync;

    fs.writeFileSync = (filePath, data) => {
      tempFiles.set(filePath, data);
    };
    fs.createReadStream = (filePath) => {
      if (tempFiles.has(filePath)) {
        const { Readable } = require('stream');
        const s = new Readable();
        s.push(tempFiles.get(filePath));
        s.push(null);
        s.path = filePath;
        return s;
      }
      return origCreateReadStream.call(fs, filePath);
    };
    fs.unlinkSync = (filePath) => {
      if (tempFiles.has(filePath)) {
        tempFiles.delete(filePath);
        return;
      }
      return origUnlinkSync.call(fs, filePath);
    };

    mockAxiosResponses.get = async () => ({
      data: Buffer.from('fake-audio'),
      headers: { 'content-type': 'audio/mpeg' }
    });
    mockAxiosResponses.post = async () => ({ data: { text: 'URL audio transcript' } });

    try {
      const skill = loadAudioSkill();
      const result = await skill.execute({ audio_url: 'https://example.com/audio.mp3' });
      assert.strictEqual(result, 'URL audio transcript');
    } finally {
      fs.writeFileSync = origWriteFileSync;
      fs.createReadStream = origCreateReadStream;
      fs.unlinkSync = origUnlinkSync;
    }
  });

  it('should reject invalid audio_url', async () => {
    const skill = loadAudioSkill();
    await assert.rejects(
      () => skill.execute({ audio_url: 'not-a-url' }),
      { message: /valid HTTP\/HTTPS URL/ }
    );
  });
});

describe('T45: Input Validation Schemas', () => {
  it('should validate imageAnalysisSchema with path', () => {
    const result = imageAnalysisSchema.safeParse({
      image_path: '/path/to/image.png',
      prompt: 'Describe this'
    });
    assert.ok(result.success);
  });

  it('should validate imageAnalysisSchema with URL', () => {
    const result = imageAnalysisSchema.safeParse({
      image_url: 'https://example.com/img.jpg',
      prompt: 'Describe this'
    });
    assert.ok(result.success);
  });

  it('should reject imageAnalysisSchema without image', () => {
    const result = imageAnalysisSchema.safeParse({ prompt: 'Describe this' });
    assert.ok(!result.success);
  });

  it('should reject imageAnalysisSchema without prompt', () => {
    const result = imageAnalysisSchema.safeParse({ image_path: '/path/to/img.png' });
    assert.ok(!result.success);
  });

  it('should validate audioTranscribeSchema with path', () => {
    const result = audioTranscribeSchema.safeParse({ audio_path: '/path/to/audio.mp3' });
    assert.ok(result.success);
  });

  it('should validate audioTranscribeSchema with URL and language', () => {
    const result = audioTranscribeSchema.safeParse({
      audio_url: 'https://example.com/audio.mp3',
      language: 'en'
    });
    assert.ok(result.success);
  });

  it('should reject audioTranscribeSchema without audio', () => {
    const result = audioTranscribeSchema.safeParse({});
    assert.ok(!result.success);
  });
});

describe('T45: Plugin Schema Media Category', () => {
  it('should accept media category in manifest', () => {
    const { skillManifestSchema } = require('../../src/plugins/schema.js');
    const result = skillManifestSchema.safeParse({
      name: 'test-media',
      version: '1.0.0',
      description: 'Test media skill',
      category: 'media'
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.category, 'media');
  });
});
