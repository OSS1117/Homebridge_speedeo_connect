'use strict';

function field(device, key) {
  const raw = device?.fields?.[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: raw, at: null };
  let at = Number(raw.timestamp);
  if (at > 1e11) at /= 1000;
  if (!Number.isFinite(at) || at <= 0) at = null;
  return { value: raw.value, at };
}

class SpeedeoState {
  constructor({ staleSeconds = 900, confirmationSeconds = 600, now = () => Date.now() / 1000 } = {}) {
    this.staleSeconds = staleSeconds;
    this.confirmationSeconds = confirmationSeconds;
    this.now = now;
    this.data = null;
    this.pending = null;
    this.failed = true;
    this.readAt = 0;
  }

  report() {
    const output = field(this.data, 'output1');
    const feedback = field(this.data, 'light_feedback');
    if (typeof output.value !== 'boolean' || output.at === null) return null;
    if (typeof feedback.value === 'boolean') {
      if (feedback.at === null || feedback.value !== output.value) return null;
      return { value: output.value, at: Math.min(output.at, feedback.at) };
    }
    return output;
  }

  fresh(at) { return at !== null && at <= this.now() + 30 && this.now() - at <= this.staleSeconds; }
  connected() { return !this.failed && this.data?.online === true && this.now() - this.readAt <= this.staleSeconds; }

  accept(target, since, baseline) {
    this.pending = { target, since, baseline, external: false };
  }

  ingest(device) {
    this.data = device;
    this.failed = false;
    this.readAt = this.now();
    const report = this.report();
    const order = field(device, 'light_order');
    const latestFeedbackAt = Math.max(field(device, 'output1').at ?? 0, field(device, 'light_feedback').at ?? 0);
    if (this.pending) {
      const p = this.pending;
      if (this.connected() && report && this.fresh(report.at) && report.value === p.target &&
          report.at >= Math.floor(p.since) && (p.baseline === null || report.at > p.baseline)) {
        this.pending = null;
      }
      // A strictly later cloud order can supersede our local intent, e.g. from the official app.
      else if (order.at !== null && typeof order.value === 'boolean' && order.value !== p.target && order.at > p.since) {
        this.pending = { target: order.value, since: order.at, baseline: report?.at ?? null, external: true };
      }
    }
    if (!this.pending && typeof order.value === 'boolean' && this.fresh(order.at) &&
        order.at > latestFeedbackAt && (!report || order.value !== report.value)) {
      this.pending = { target: order.value, since: order.at, baseline: report?.at ?? null, external: true };
    }
  }

  light() {
    if (!this.connected()) throw new Error('UNAVAILABLE');
    if (this.pending) {
      if (this.now() - this.pending.since > this.confirmationSeconds) throw new Error('UNCONFIRMED');
      return this.pending.target;
    }
    const report = this.report();
    if (!report || !this.fresh(report.at)) throw new Error('STALE');
    return report.value;
  }

  temperature() {
    const temp = field(this.data, 'water_temperature');
    if (!this.connected() || !this.fresh(temp.at) || typeof temp.value !== 'number' ||
        !Number.isFinite(temp.value) || temp.value < -5 || temp.value > 45) throw new Error('TEMPERATURE_UNAVAILABLE');
    // water_temperature_connected=false was observed with valid water readings on this installation.
    return temp.value;
  }
}

module.exports = { SpeedeoState, field };
