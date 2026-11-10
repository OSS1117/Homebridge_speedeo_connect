'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SpeedeoState, field } = require('../lib/state');

function sample({ report = 950, order = 900, on = false, wanted = on, temp = 15.5, online = true } = {}) {
  return { online, fields: {
    output1: { value: on, timestamp: String(report) },
    light_feedback: { value: on, timestamp: String(report) },
    light_order: { value: wanted, timestamp: String(order) },
    water_temperature: { value: temp, timestamp: String(report) },
    water_temperature_connected: { value: false, timestamp: String(report) },
    output1_mode: { value: 6 },
  } };
}

test('startup and old temperature never produce fabricated zero/off readings', () => {
  const s = new SpeedeoState({ now: () => 2000 });
  assert.throws(() => s.light()); assert.throws(() => s.temperature());
  s.ingest(sample());
  assert.throws(() => s.light()); assert.throws(() => s.temperature());
});

test('six-minute-old states cannot undo an accepted light command; fresh feedback confirms it', () => {
  let now = 1000;
  const s = new SpeedeoState({ now: () => now });
  s.ingest(sample()); s.accept(true, 1000, 950);
  now = 1330;
  s.ingest(sample({ wanted: true, order: 1005 }));
  assert.equal(s.light(), true); assert.ok(s.pending);
  s.ingest(sample({ wanted: true, order: 1005, report: 1320, on: true }));
  assert.equal(s.light(), true); assert.equal(s.pending, null);
});

test('same value with an old timestamp never confirms a command', () => {
  const s = new SpeedeoState({ now: () => 1000 });
  s.ingest(sample({ on: true })); s.accept(true, 1000, 950);
  s.ingest(sample({ on: true }));
  assert.ok(s.pending);
});

test('timeout is unavailable instead of reverting; a late fresh confirmation recovers', () => {
  let now = 1000;
  const s = new SpeedeoState({ now: () => now });
  s.ingest(sample()); s.accept(true, 1000, 950);
  now = 1601; s.ingest(sample({ wanted: true, order: 1005 }));
  assert.throws(() => s.light(), /UNCONFIRMED/);
  now = 1620; s.ingest(sample({ wanted: true, order: 1005, report: 1610, on: true }));
  assert.equal(s.light(), true); assert.equal(s.pending, null);
});

test('a newer command from the official app supersedes local intent, not an older order', () => {
  let now = 1000;
  const s = new SpeedeoState({ now: () => now });
  s.ingest(sample()); s.accept(true, 1000, 950);
  s.ingest(sample()); assert.equal(s.light(), true);
  now = 1030; s.ingest(sample({ order: 1020, wanted: false }));
  assert.equal(s.light(), false); assert.equal(s.pending.external, true);
});

test('external light command is shown pending instead of old contradictory feedback', () => {
  const s = new SpeedeoState({ now: () => 1030 });
  s.ingest(sample({ order: 1020, wanted: true }));
  assert.equal(s.light(), true); assert.equal(s.pending.external, true);
});

test('off commands work while the old report already says off', () => {
  const s = new SpeedeoState({ now: () => 1000 });
  s.ingest(sample()); s.accept(false, 1000, 950);
  assert.equal(s.light(), false); assert.ok(s.pending);
});

test('temperature is independent of connected flag, but not freshness, range or numeric type', () => {
  const s = new SpeedeoState({ now: () => 1000 });
  s.ingest(sample()); assert.equal(s.temperature(), 15.5);
  for (const temp of [-64.1, 46, '15.5', null, NaN]) {
    s.ingest(sample({ temp })); assert.throws(() => s.temperature());
  }
});

test('online=true and updated lastReport cannot make old field values fresh', () => {
  const s = new SpeedeoState({ now: () => 2000 });
  s.ingest({ ...sample(), lastReport: 2000000 });
  assert.throws(() => s.temperature()); assert.throws(() => s.light());
});

test('read failure and offline become unavailable; successful read recovers', () => {
  const s = new SpeedeoState({ now: () => 1000 });
  s.ingest(sample()); s.failed = true; assert.throws(() => s.light());
  s.ingest(sample({ online: false })); assert.throws(() => s.temperature());
  s.ingest(sample()); assert.equal(s.light(), false);
});

test('contradictory feedback is unavailable and does not confirm a command', () => {
  const s = new SpeedeoState({ now: () => 1000 });
  const d = sample(); d.fields.light_feedback.value = true;
  s.ingest(d); assert.throws(() => s.light());
});

test('timestamp milliseconds and missing values are normalized safely', () => {
  assert.equal(field({ fields: { x: { value: 1, timestamp: '1794347100000' } } }, 'x').at, 1794347100);
  assert.equal(field({ fields: { x: true } }, 'x').at, null);
  const s = new SpeedeoState({ now: () => 1000 });
  s.ingest(sample({ report: 2000 })); assert.throws(() => s.light());
});
