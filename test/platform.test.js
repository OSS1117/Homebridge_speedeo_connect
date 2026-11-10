'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const hap = require('hap-nodejs');
const { PlatformAccessory } = require('homebridge/lib/platformAccessory');
const register = require('../index');
const { SpeedeoPlatform } = register;

function fixture(t) {
  const api = new EventEmitter(); api.hap = hap; api.platformAccessory = PlatformAccessory;
  const accessories = [];
  api.registerPlatformAccessories = (_plugin, _platform, items) => accessories.push(...items);
  api.updatePlatformAccessories = () => {};
  const logs = [];
  const log = { info: msg => logs.push(msg), warn: msg => logs.push(msg), error: msg => logs.push(msg) };
  const platform = new SpeedeoPlatform(log, { email: 'test@example.invalid', password: 'test', name: 'Piscine' }, api);
  platform.client.close();
  const at = Math.floor(Date.now() / 1000);
  const device = { deviceId: 'SPD-fixture', deviceType: 'SPD1', online: true, fields: {
    output1_mode: { value: 6 },
    light_order: { value: false, timestamp: String(at - 20) },
    output1: { value: false, timestamp: String(at - 10) },
    light_feedback: { value: false, timestamp: String(at - 10) },
    water_temperature: { value: 14.7, timestamp: String(at - 10) },
  } };
  const writes = [];
  platform.client = {
    devices: async () => [{ deviceId: 'ignore-pump', deviceType: 'IF31' }, device],
    device: async id => { assert.equal(id, device.deviceId); return device; },
    setLight: async (id, target) => { writes.push({ id, target }); }, close: () => {},
  };
  t.after(() => api.emit('shutdown'));
  return { api, platform, device, writes, logs, accessories };
}

test('registers the expected Homebridge platform', () => {
  let args;
  register({ registerPlatform: (...values) => { args = values; } });
  assert.equal(args[0], 'homebridge-speedeo-connect');
  assert.equal(args[1], 'SpeedeoConnect');
  assert.equal(args[2], SpeedeoPlatform);
});

test('real HAP services expose light and water temperature, not pump/color/air controls', async t => {
  const f = fixture(t); await f.platform.start();
  assert.equal(f.accessories.length, 1);
  const services = f.accessories[0].services;
  assert.equal(services.length, 3);
  assert.ok(Math.abs(f.platform.temp.getCharacteristic(hap.Characteristic.CurrentTemperature).value - 14.7) < 1e-6);
  assert.equal(f.platform.light.getCharacteristic(hap.Characteristic.On).value, false);
  assert.equal(f.platform.light.testCharacteristic(hap.Characteristic.Hue), false);
  assert.equal(f.platform.temp.getCharacteristic(hap.Characteristic.CurrentTemperature).props.minValue, -5);
});

test('explicit HomeKit commands are serialized and never suppressed by cached feedback', async t => {
  const f = fixture(t); await f.platform.start();
  const on = f.platform.light.getCharacteristic(hap.Characteristic.On);
  await on.handleSetRequest(true);
  assert.equal(on.value, true);
  await Promise.all([f.platform.command(false), f.platform.command(true)]);
  assert.deepEqual(f.writes.map(w => w.target), [true, false, true]);
  await f.platform.poll();
  assert.equal(on.value, true); assert.equal(f.platform.model.pending.target, true);
});

test('cloud rejection is returned to HomeKit rather than swallowed', async t => {
  const f = fixture(t); await f.platform.start();
  f.platform.client.setLight = async () => { throw new Error('sensitive data'); };
  await assert.rejects(f.platform.command(true), error => error.hapStatus === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  assert.equal(f.platform.model.pending, null);
  assert.ok(!f.logs.join('\n').includes('sensitive data'));
});

test('temperature expiration marks HAP characteristic faulty and later reading restores it', async t => {
  const f = fixture(t); await f.platform.start();
  f.device.fields.water_temperature.timestamp = String(Date.now() / 1000 - 1000);
  await f.platform.poll();
  assert.equal(f.platform.temp.getCharacteristic(hap.Characteristic.StatusFault).value, hap.Characteristic.StatusFault.GENERAL_FAULT);
  assert.equal(f.platform.temp.getCharacteristic(hap.Characteristic.StatusActive).value, false);
  f.device.fields.water_temperature.timestamp = String(Date.now() / 1000);
  await f.platform.poll();
  assert.equal(f.platform.temp.getCharacteristic(hap.Characteristic.StatusFault).value, hap.Characteristic.StatusFault.NO_FAULT);
});

test('configuration rejects unsafe intervals before starting network activity', t => {
  const f = fixture(t);
  const p = new SpeedeoPlatform({ error: () => {} }, { email: 'x', password: 'x', pollIntervalSeconds: 0 }, f.api);
  assert.equal(p.client, undefined);
});
