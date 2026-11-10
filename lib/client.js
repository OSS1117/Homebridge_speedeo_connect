'use strict';

const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require('amazon-cognito-identity-js');
const { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } = require('@aws-sdk/client-cognito-identity');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { SignatureV4 } = require('@smithy/signature-v4');
const { HttpRequest } = require('@smithy/protocol-http');
const { Sha256 } = require('@aws-crypto/sha256-js');

const REGION = 'us-west-2';
const POOL = 'us-west-2_lbiduhSwD';
const HOST = 'api.pentair.cloud';

class CloudError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function deadline(task) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CloudError('AUTH_TIMEOUT')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}

class PentairClient {
  constructor(email, password, { transport = fetch } = {}) {
    this.transport = transport;
    // Private memory storage: Cognito must never persist account tokens to disk.
    const memory = new Map();
    const storage = {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); return value; },
      removeItem: key => memory.delete(key), clear: () => memory.clear(),
    };
    this.pool = new CognitoUserPool({
      UserPoolId: POOL, ClientId: '3de110o697faq7avdchtf07h4v', Storage: storage,
    });
    this.user = new CognitoUser({ Username: email, Pool: this.pool, Storage: storage });
    this.user.setAuthenticationFlowType('USER_SRP_AUTH');
    this.details = new AuthenticationDetails({ Username: email, Password: password });
    this.identity = new CognitoIdentityClient({
      region: REGION, maxAttempts: 1,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 10000, requestTimeout: 15000 }),
    });
    this.session = null;
    this.credentials = null;
    this.authTask = null;
  }

  async authenticate() {
    const now = Date.now() / 1000;
    if (this.session && this.session.isValid() &&
        this.session.getIdToken().getExpiration() > now + 120 &&
        this.credentials && this.credentials.expiry > now + 120) return;
    if (!this.authTask) {
      this.authTask = this.refreshAuth().finally(() => { this.authTask = null; });
    }
    await this.authTask;
  }

  async refreshAuth() {
    try {
      const now = Date.now() / 1000;
      if (!this.session) {
        this.session = await deadline(new Promise((resolve, reject) => {
          const unsupported = () => reject(new CloudError('AUTH_CHALLENGE_UNSUPPORTED'));
          this.user.authenticateUser(this.details, {
            onSuccess: resolve, onFailure: reject, mfaRequired: unsupported,
            totpRequired: unsupported, newPasswordRequired: unsupported,
            customChallenge: unsupported, selectMFAType: unsupported,
            mfaSetup: unsupported,
          });
        }));
      } else if (!this.session.isValid() || this.session.getIdToken().getExpiration() <= now + 120) {
        this.session = await deadline(new Promise((resolve, reject) => {
          this.user.refreshSession(this.session.getRefreshToken(), (err, session) => err ? reject(err) : resolve(session));
        }));
      }
      const Logins = { [`cognito-idp.${REGION}.amazonaws.com/${POOL}`]: this.session.getIdToken().getJwtToken() };
      const identity = await this.identity.send(new GetIdCommand({
        IdentityPoolId: 'us-west-2:6f950f85-af44-43d9-b690-a431f753e9aa', Logins,
      }));
      const result = await this.identity.send(new GetCredentialsForIdentityCommand({ IdentityId: identity.IdentityId, Logins }));
      const c = result.Credentials;
      if (!c?.AccessKeyId || !c.SecretKey || !c.SessionToken || !c.Expiration) throw new CloudError('AUTH_CREDENTIALS');
      this.credentials = {
        accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretKey,
        sessionToken: c.SessionToken, expiry: c.Expiration.getTime() / 1000,
      };
    } catch (error) {
      this.session = null;
      this.credentials = null;
      // Never expose SDK messages, usernames, signed URLs or response bodies in Homebridge logs.
      throw new CloudError(error instanceof CloudError ? error.code : 'AUTH_FAILED');
    }
  }

  async request(method, path, payload) {
    await this.authenticate();
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const signer = new SignatureV4({ credentials: this.credentials, region: REGION, service: 'execute-api', sha256: Sha256 });
    const signed = await signer.sign(new HttpRequest({
      protocol: 'https:', hostname: HOST, path, method, body,
      headers: { host: HOST, 'x-amz-id-token': this.session.getIdToken().getJwtToken(), 'content-type': 'application/json' },
    }));
    try {
      const response = await this.transport(`https://${HOST}${path}`, {
        method, headers: signed.headers, body, signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { this.session = null; this.credentials = null; }
        throw new CloudError(`HTTP_${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw error instanceof CloudError ? error : new CloudError('NETWORK_OR_RESPONSE');
    }
  }

  async devices() {
    const raw = await this.request('GET', '/device/device-service/user/devices');
    const items = Array.isArray(raw) ? raw : raw?.data;
    if (!Array.isArray(items)) throw new CloudError('DEVICE_LIST_FORMAT');
    return items;
  }

  async device(id) {
    const raw = await this.request('GET', `/device/device-service/user/device/${encodeURIComponent(id)}`);
    const device = extractDevice(raw, id);
    if (!device) throw new CloudError('DEVICE_FORMAT');
    return device;
  }

  async setLight(id, target) {
    if (typeof target !== 'boolean') throw new CloudError('INVALID_COMMAND');
    // Exactly one write: an ambiguous network outcome must not trigger an automatic retry.
    const raw = await this.request('PUT', `/devicespd-common/speedeo/user/device/${encodeURIComponent(id)}`, {
      payload: { light_order: target },
    });
    if (raw?.msgs?.[0]?.code !== 102) throw new CloudError('COMMAND_NOT_ACCEPTED');
  }

  close() { this.identity.destroy(); }
}

function extractDevice(raw, id) {
  if (Array.isArray(raw)) {
    for (const item of raw) { const result = extractDevice(item, id); if (result) return result; }
  } else if (raw && typeof raw === 'object') {
    if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields) && (!raw.deviceId || raw.deviceId === id)) return raw;
    for (const key of ['response', 'data', 'devices', 'items', 'results']) {
      if (raw[key]) { const result = extractDevice(raw[key], id); if (result) return result; }
    }
  }
  return null;
}

module.exports = { PentairClient, CloudError, extractDevice };
