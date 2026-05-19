/**
 * TLS Configuration Helper
 * Sets up TLS 1.3 for API server and other secure connections.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');

const TLS_MIN_VERSION = 'TLSv1.3';
const TLS_MAX_VERSION = 'TLSv1.3';

/**
 * Get TLS options for HTTPS server
 * @returns {Object} TLS options for Node.js https.createServer()
 */
function getTlsOptions() {
  const certPath = process.env.ORCA_TLS_CERT_PATH;
  const keyPath = process.env.ORCA_TLS_KEY_PATH;

  if (!certPath || !keyPath) {
    logger.warn('TLS certificate or key path not configured. HTTPS will not be available.');
    return null;
  }

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    logger.warn('TLS certificate or key file not found. HTTPS will not be available.');
    return null;
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: TLS_MIN_VERSION,
    maxVersion: TLS_MAX_VERSION,
    // Strong cipher suites for TLS 1.3
    cipherSuites: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256',
    // Perfect forward secrecy
    honorCipherOrder: true,
    // Additional security options
    requestCert: false,
    rejectUnauthorized: true
  };
}

/**
 * Check if TLS is properly configured
 * @returns {boolean}
 */
function isTlsConfigured() {
  return !!process.env.ORCA_TLS_CERT_PATH && !!process.env.ORCA_TLS_KEY_PATH;
}

/**
 * Generate self-signed certificate for development
 * @param {string} outputDir - Directory to save cert files
 * @returns {Object} { certPath, keyPath }
 */
function generateSelfSignedCert(outputDir = './certs') {
  const { execSync } = require('child_process');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const certPath = path.join(outputDir, 'server.crt');
  const keyPath = path.join(outputDir, 'server.key');

  try {
    // Generate private key
    execSync(`openssl genrsa -out ${keyPath} 2048`, { stdio: 'ignore' });

    // Generate self-signed certificate
    execSync(
      `openssl req -new -x509 -key ${keyPath} -out ${certPath} -days 365 ` +
      `-subj "/C=US/ST=State/L=City/O=Orca/CN=localhost"`,
      { stdio: 'ignore' }
    );

    logger.info({ certPath, keyPath }, 'Self-signed certificate generated');
    return { certPath, keyPath };
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to generate self-signed certificate');
    throw new Error('Certificate generation failed. Ensure OpenSSL is installed.');
  }
}

/**
 * Enforce TLS redirect middleware
 * Returns middleware function for HTTP servers to redirect to HTTPS
 * @returns {Function}
 */
function enforceTlsRedirect() {
  return (req, res, next) => {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (!isSecure) {
      const httpsUrl = `https://${req.headers.host}${req.url}`;
      res.writeHead(301, { Location: httpsUrl });
      res.end();
      return;
    }
    next();
  };
}

/**
 * Security headers for HTTPS responses
 * @returns {Object} Header key-value pairs
 */
function getSecurityHeaders() {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'"
  };
}

module.exports = {
  getTlsOptions,
  isTlsConfigured,
  generateSelfSignedCert,
  enforceTlsRedirect,
  getSecurityHeaders,
  TLS_MIN_VERSION,
  TLS_MAX_VERSION
};
