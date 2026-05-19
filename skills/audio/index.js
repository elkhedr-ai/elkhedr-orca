const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { logger } = require('../../src/utils/logger.js');

const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.mp4'];

function getConfigValue(key, fallback) {
  try {
    const { getConfig } = require('../../src/config/index.js');
    const value = getConfig()[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch {
    return process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key];
  }
}

function validateAudioPath(audioPath) {
  if (!audioPath || typeof audioPath !== 'string') {
    throw new Error('audio_path is required and must be a string');
  }
  if (audioPath.includes('..')) {
    throw new Error('Path traversal not allowed');
  }
  const resolved = path.resolve(audioPath);
  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
  return resolved;
}

/**
 * Transcribe audio using OpenRouter's Whisper-compatible endpoint
 */
async function execute(args) {
  const { audio_path, audio_url, language } = args;

  if (!audio_path && !audio_url) {
    throw new Error('Either audio_path or audio_url is required');
  }

  const apiKey = getConfigValue('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const baseUrl = getConfigValue('ORCA_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');

  if (audio_path) {
    const resolvedPath = validateAudioPath(audio_path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Audio file not found: ${resolvedPath}`);
    }

    logger.info({ path: resolvedPath }, 'Transcribing local audio file');

    const form = new FormData();
    form.append('file', fs.createReadStream(resolvedPath));
    form.append('model', 'openai/whisper-large-v3');
    if (language) {
      form.append('language', language);
    }

    try {
      const response = await axios.post(
        `${baseUrl}/audio/transcriptions`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${apiKey}`,
            'X-Title': 'Elkhedr Orca Audio',
            'HTTP-Referer': 'https://github.com/ekagent/elkhedr-orca'
          },
          timeout: 120000
        }
      );

      const text = response.data?.text;
      if (text) {
        logger.info({ length: text.length }, 'Audio transcription complete');
        return text;
      }
      throw new Error('No transcription text returned');
    } catch (error) {
      logger.error({ error: error.message }, 'Audio transcription failed');
      throw new Error(`Transcription failed: ${error.message}`);
    }
  } else {
    // URL-based transcription — download first, then transcribe
    if (!audio_url.startsWith('http://') && !audio_url.startsWith('https://')) {
      throw new Error('audio_url must be a valid HTTP/HTTPS URL');
    }

    logger.info({ url: audio_url }, 'Downloading audio from URL');

    try {
      const downloadResponse = await axios.get(audio_url, {
        responseType: 'arraybuffer',
        timeout: 60000
      });

      const ext = path.extname(new URL(audio_url).pathname).toLowerCase() || '.mp3';
      const tempPath = path.join(require('os').tmpdir(), `orca-audio-${Date.now()}${ext}`);
      fs.writeFileSync(tempPath, downloadResponse.data);

      try {
        const form = new FormData();
        form.append('file', fs.createReadStream(tempPath));
        form.append('model', 'openai/whisper-large-v3');
        if (language) {
          form.append('language', language);
        }

        const response = await axios.post(
          `${baseUrl}/audio/transcriptions`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              'Authorization': `Bearer ${apiKey}`,
              'X-Title': 'Elkhedr Orca Audio',
              'HTTP-Referer': 'https://github.com/ekagent/elkhedr-orca'
            },
            timeout: 120000
          }
        );

        const text = response.data?.text;
        if (text) {
          logger.info({ length: text.length }, 'Audio transcription complete');
          return text;
        }
        throw new Error('No transcription text returned');
      } finally {
        // Clean up temp file
        try { fs.unlinkSync(tempPath); } catch {}
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Audio URL transcription failed');
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
}

const toolDefinition = {
  type: "function",
  function: {
    name: "audio",
    description: "Transcribe audio files to text. Supports local files (mp3, wav, m4a, ogg, flac) and URLs. Returns the transcript text.",
    parameters: {
      type: "object",
      properties: {
        audio_path: {
          type: "string",
          description: "Local file path to the audio file (e.g., /path/to/audio.mp3)"
        },
        audio_url: {
          type: "string",
          description: "URL of the audio file to transcribe (http/https)"
        },
        language: {
          type: "string",
          description: "Optional language hint (e.g., 'en', 'es', 'fr') for better accuracy"
        }
      },
      required: []
    }
  }
};

module.exports = { execute, toolDefinition };
