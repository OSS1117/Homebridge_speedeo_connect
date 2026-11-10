'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PentairClient, extractDevice } = require('../lib/client');

function client(transport) {
  const c = new PentairClient('fixture@example.invalid', 'not-a-real-password', { transport });
  c.authenticate = async () => {};
  c.session = { getIdToken: () => ({ getJwtToken: () => 'fixture-token' }) };
  c.credentials = { accessKeyId: 'fixture-key', secretAccessKey: 'fixture-secret', sessionToken: 'fixture-session' };
  return c;
}

test('light writes exactly once to the dedicated endpoint with a signed boolean body', async () => {
  const calls = [];
  const c = client(async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ msgs: [{ code: 102 }] }));
  });
  try {
    await c.setLight('device/id', true); await c.setLight('device/id', false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.pentair.cloud/devicespd-common/speedeo/user/device/device%2Fid');
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].options.body), { payload: { light_order: true } });
    assert.deepEqual(JSON.parse(calls[1].options.body), { payload: { light_order: false } });
    assert.match(calls[0].options.headers.authorization, /^AWS4-HMAC-SHA256 /);
  } finally { c.close(); }
});

test('HTTP 200 with a generic success or application error never counts as Speedeo acceptance', async () => {
  for (const body of [{ data: { code: 'set_device_success' } }, { msgs: [{ code: 400 }] }, {}, { msgs: [{ code: '102' }] }]) {
    const c = client(async () => new Response(JSON.stringify(body)));
    try { await assert.rejects(c.setLight('x', true), { code: 'COMMAND_NOT_ACCEPTED' }); }
    finally { c.close(); }
  }
});

test('network loss after a write is not retried and sensitive transport errors are scrubbed', async () => {
  let calls = 0;
  const c = client(async () => { calls++; throw new Error('secret fixture-token fixture@example.invalid'); });
  try {
    await assert.rejects(c.setLight('x', true), error => error.message === 'NETWORK_OR_RESPONSE');
    assert.equal(calls, 1);
  } finally { c.close(); }
});

test('detail extraction respects device id and preserves timestamps', async () => {
  const device = { deviceId: 'right', online: true, fields: { output1: { value: false, timestamp: '123' } } };
  assert.equal(extractDevice({ response: { data: [{ ...device, deviceId: 'wrong' }, device] } }, 'right'), device);
  const c = client(async () => new Response(JSON.stringify({ data: device })));
  try { assert.deepEqual(await c.device('right'), device); } finally { c.close(); }
});

test('auth refresh is single-flight and checks AWS credential expiry independently of JWT expiry', async () => {
  const c = new PentairClient('fixture@example.invalid', 'fixture');
  let count = 0;
  const now = Date.now() / 1000;
  c.session = { isValid: () => true, getIdToken: () => ({ getExpiration: () => now + 3600 }) };
  c.credentials = { expiry: now - 1 };
  c.refreshAuth = async () => { count++; await new Promise(resolve => setImmediate(resolve)); c.credentials.expiry = now + 3600; };
  try {
    await Promise.all([c.authenticate(), c.authenticate(), c.authenticate()]);
    assert.equal(count, 1); await c.authenticate(); assert.equal(count, 1);
  } finally { c.close(); }
});
