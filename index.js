'use strict';

const { PentairClient } = require('./lib/client');
const { SpeedeoState, field } = require('./lib/state');
const PLUGIN = 'homebridge-speedeo-connect';
const PLATFORM = 'SpeedeoConnect';
const VERSION = require('./package.json').version;

function seconds(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < minimum || n > maximum) throw new Error('INVALID_INTERVAL');
  return n;
}

class SpeedeoPlatform {
  constructor(log, config, api) {
    this.log = log; this.config = config; this.api = api;
    this.cached = new Map(); this.stopped = false; this.queue = Promise.resolve();
    if (!config) return;
    try {
      if (typeof config.email !== 'string' || !config.email.trim() || typeof config.password !== 'string' || !config.password) throw new Error('CREDENTIALS_REQUIRED');
      if (config.deviceId !== undefined && (typeof config.deviceId !== 'string' || !config.deviceId.trim())) throw new Error('INVALID_DEVICE_ID');
      this.interval = seconds(config.pollIntervalSeconds, 30, 15, 300);
      this.model = new SpeedeoState({
        staleSeconds: seconds(config.staleSeconds, 900, 120, 86400),
        confirmationSeconds: seconds(config.confirmationSeconds, 600, 60, 1800),
      });
      this.client = new PentairClient(config.email.trim(), config.password);
    } catch (error) {
      log.error(`Configuration Speedeo invalide (${error.message}).`); return;
    }
    api.on('didFinishLaunching', () => { void this.start(); });
    api.on('shutdown', () => {
      this.stopped = true; clearTimeout(this.timer); this.client.close();
    });
  }

  configureAccessory(accessory) { this.cached.set(accessory.UUID, accessory); }
  unavailable() { return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  read(getter) { try { return getter(); } catch { throw this.unavailable(); } }

  async start() {
    if (this.stopped) return;
    try {
      if (!this.id) {
        const devices = await this.client.devices();
        const candidates = devices.filter(d => d.deviceType === 'SPD1' && (!this.config.deviceId || d.deviceId === this.config.deviceId));
        if (candidates.length !== 1) {
          this.log.error('Il faut un Speedeo SPD1 unique, ou préciser son deviceId dans la configuration.');
          return;
        }
        this.id = candidates[0].deviceId;
        if (typeof this.id !== 'string' || !this.id) throw new Error('DEVICE_FORMAT');
        const label = this.config.name || 'Piscine';
        const uuid = this.api.hap.uuid.generate(`${PLUGIN}:${this.id}`);
        const accessory = this.cached.get(uuid) || new this.api.platformAccessory(label, uuid);
        this.setupAccessory(accessory, label);
        if (!this.cached.has(uuid)) this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [accessory]);
        else this.api.updatePlatformAccessories([accessory]);
        this.log.info('Speedeo détecté. Éclairage et température activés ; état initial en cours de lecture.');
      }
      if (!this.stopped) await this.poll();
    } catch (error) {
      this.log.warn(`Démarrage Speedeo impossible (${error.code || 'STARTUP_FAILED'}). Nouvel essai dans 60 s.`);
      if (!this.stopped) this.timer = setTimeout(() => { void this.start(); }, 60000);
    }
  }

  setupAccessory(accessory, label) {
    const { Service, Characteristic: C } = this.api.hap;
    this.C = C;
    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(C.Manufacturer, 'Pentair')
      .setCharacteristic(C.Model, 'Speedeo Connect SPD1')
      .setCharacteristic(C.SerialNumber, this.id)
      .setCharacteristic(C.FirmwareRevision, VERSION);
    this.light = accessory.getServiceById(Service.Lightbulb, 'light') || accessory.addService(Service.Lightbulb, `${label} éclairage`, 'light');
    this.light.getCharacteristic(C.On).onGet(() => this.read(() => this.model.light()))
      .onSet(value => this.command(Boolean(value)));
    this.temp = accessory.getServiceById(Service.TemperatureSensor, 'water') || accessory.addService(Service.TemperatureSensor, `${label} eau`, 'water');
    this.temp.getCharacteristic(C.CurrentTemperature).setProps({ minValue: -5, maxValue: 45, minStep: 0.1 })
      .onGet(() => this.read(() => this.model.temperature()));
    this.temp.addOptionalCharacteristic(C.StatusFault);
    this.temp.addOptionalCharacteristic(C.StatusActive);
    this.publish();
  }

  publish() {
    if (this.stopped || !this.light) return;
    const C = this.C;
    try { this.light.updateCharacteristic(C.On, this.model.light()); }
    catch { this.light.updateCharacteristic(C.On, this.unavailable()); }
    try {
      this.temp.updateCharacteristic(C.CurrentTemperature, this.model.temperature());
      this.temp.updateCharacteristic(C.StatusFault, C.StatusFault.NO_FAULT);
      this.temp.updateCharacteristic(C.StatusActive, true);
    } catch {
      this.temp.updateCharacteristic(C.CurrentTemperature, this.unavailable());
      this.temp.updateCharacteristic(C.StatusFault, C.StatusFault.GENERAL_FAULT);
      this.temp.updateCharacteristic(C.StatusActive, false);
    }
    if (this.model.pending && Date.now() / 1000 - this.model.pending.since > this.model.confirmationSeconds && !this.unconfirmedLogged) {
      this.unconfirmedLogged = true;
      this.log.warn('Éclairage : aucun retour concordant dans le délai. État indisponible ; aucune répétition de commande.');
    }
  }

  async poll() {
    clearTimeout(this.timer);
    try {
      const hadPending = Boolean(this.model.pending);
      this.model.ingest(await this.client.device(this.id));
      if (hadPending && !this.model.pending) {
        this.log.info('Éclairage : retour du contrôleur concordant.'); this.unconfirmedLogged = false;
      }
      if (this.lastError) this.log.info('Lecture Speedeo rétablie.');
      this.lastError = null;
    } catch (error) {
      this.model.failed = true;
      const code = error.code || 'READ_FAILED';
      if (this.lastError !== code) this.log.warn(`Lecture Speedeo impossible (${code}).`);
      this.lastError = code;
    } finally {
      this.publish();
      if (!this.stopped) this.timer = setTimeout(() => { void this.poll(); }, this.interval * 1000);
    }
  }

  command(target) {
    const run = async () => {
      if (this.stopped || !this.id || !this.model.connected() || field(this.model.data, 'output1_mode').value !== 6) throw this.unavailable();
      const baseline = this.model.report()?.at ?? null;
      const sent = Date.now() / 1000;
      try {
        await this.client.setLight(this.id, target);
        this.model.accept(target, sent, baseline);
        this.unconfirmedLogged = false;
        this.log.info(`Éclairage : consigne ${target ? 'allumé' : 'éteint'} acceptée ; confirmation en attente.`);
        this.publish();
      } catch (error) {
        this.log.warn(`Commande non confirmée par le cloud (${error.code || 'COMMAND_FAILED'}). Aucun nouvel envoi automatique.`);
        throw this.unavailable();
      }
    };
    const task = this.queue.then(run);
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = api => api.registerPlatform(PLUGIN, PLATFORM, SpeedeoPlatform);
module.exports.SpeedeoPlatform = SpeedeoPlatform;
