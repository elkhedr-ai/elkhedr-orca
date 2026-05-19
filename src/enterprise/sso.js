/**
 * SSO/SAML 2.0 Integration
 * Enterprise single sign-on with SAML 2.0 and OIDC providers.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger.js');

/**
 * Supported SSO providers
 */
const SSO_PROVIDERS = {
  SAML2: 'saml2',
  OIDC: 'oidc',
  AZURE_AD: 'azure_ad',
  OKTA: 'okta',
  GOOGLE: 'google_workspace',
  ONELOGIN: 'onelogin'
};

/**
 * Generate SAML metadata XML for a service provider
 */
function generateSPMetadata(config) {
  const entityId = config.entityId || `https://${config.domain || 'orca.elkhedr.com'}/saml/metadata`;
  const acsUrl = config.acsUrl || `https://${config.domain || 'orca.elkhedr.com'}/saml/acs`;
  const sloUrl = config.sloUrl || `https://${config.domain || 'orca.elkhedr.com'}/saml/slo`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>${config.signingCert || 'PLACEHOLDER_CERT'}</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${sloUrl}"/>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}

/**
 * Validate SSO configuration
 */
function validateSSOConfig(provider, config) {
  const errors = [];

  if (!provider || !SSO_PROVIDERS[provider.toUpperCase()]) {
    errors.push(`Unsupported SSO provider: ${provider}`);
  }

  switch (provider) {
    case SSO_PROVIDERS.SAML2:
      if (!config.entryPoint) errors.push('SAML entryPoint is required');
      if (!config.issuer) errors.push('SAML issuer is required');
      if (!config.cert) errors.push('SAML certificate is required');
      break;

    case SSO_PROVIDERS.OIDC:
    case SSO_PROVIDERS.AZURE_AD:
    case SSO_PROVIDERS.OKTA:
    case SSO_PROVIDERS.GOOGLE:
      if (!config.clientId) errors.push('OIDC clientId is required');
      if (!config.clientSecret) errors.push('OIDC clientSecret is required');
      if (!config.issuer) errors.push('OIDC issuer is required');
      break;

    case SSO_PROVIDERS.ONELOGIN:
      if (!config.clientId) errors.push('OneLogin clientId is required');
      if (!config.clientSecret) errors.push('OneLogin clientSecret is required');
      if (!config.subdomain) errors.push('OneLogin subdomain is required');
      break;
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build OIDC authorization URL
 */
function buildOIDCAuthorizationUrl(config, state, nonce) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: config.scope || 'openid profile email',
    redirect_uri: config.redirectUri,
    state,
    nonce
  });

  const issuer = config.issuer?.replace(/\/$/, '');
  return `${issuer}/authorize?${params.toString()}`;
}

/**
 * Exchange OIDC code for tokens
 */
async function exchangeOIDCCode(config, code) {
  const issuer = config.issuer?.replace(/\/$/, '');
  const tokenEndpoint = `${issuer}/token`;

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error_description || response.statusText}`);
  }

  return response.json();
}

/**
 * Verify and decode an OIDC ID token (simplified — production should use JWKS)
 */
function decodeIDToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.preferred_username,
      emailVerified: payload.email_verified,
      expiresAt: payload.exp,
      issuer: payload.iss,
      audience: payload.aud
    };
  } catch (error) {
    throw new Error(`Failed to decode ID token: ${error.message}`);
  }
}

/**
 * Generate a secure state parameter for OAuth flows
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a nonce for OIDC flows
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  SSO_PROVIDERS,
  generateSPMetadata,
  validateSSOConfig,
  buildOIDCAuthorizationUrl,
  exchangeOIDCCode,
  decodeIDToken,
  generateState,
  generateNonce
};
