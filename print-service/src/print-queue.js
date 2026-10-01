'use strict';

const fs = require('node:fs');
const path = require('node:path');

class StateStore {
  constructor(file) { this.file = file; this.state = null; }
  load() {
    if (this.state) return this.state;
    if (!fs.existsSync(this.file)) this.state = { version: 1, jobs: [], deviceId: '', deviceToken: '', inFlight: null };
    else {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.state.version !== 1 || !Array.isArray(this.state.jobs)) throw new Error('Arquivo de estado incompatível.');
      for (const job of this.state.jobs) if (job.status === 'printing') job.status = 'uncertain';
    }
    this.save();
    return this.state;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}

class PrintQueue {
  constructor({ store, printer, formatter, logger, retryMs = 60000, now = Date.now }) {
    this.store = store; this.printer = printer; this.formatter = formatter; this.logger = logger; this.retryMs = retryMs; this.now = now;
    this.running = false; this.timer = null;
  }
  enqueue(order) {
    const state = this.store.load();
    const id = String(order.id || order.number || '').trim();
    if (!id) throw new Error('Pedido sem identificador.');
    if (state.jobs.some(job => job.id === id)) { this.logger.info('QUEUE', `Pedido #${id} já conhecido; ignorado`); return false; }
    state.jobs.push({ id, order, status: 'pending', attempts: 0, retryAt: 0, createdAt: this.now(), lastError: '' });
    this.store.save();
    this.logger.info('QUEUE', `Pedido #${id} adicionado à fila`);
    this.wake();
    return true;
  }
  async drainOnce() {
    if (this.running) return false;
    const state = this.store.load();
    const job = state.jobs.find(entry => entry.status === 'pending' && entry.retryAt <= this.now());
    if (!job) return false;
    this.running = true; job.status = 'printing'; job.attempts += 1; this.store.save();
    this.logger.info('PRINT', `Imprimindo pedido #${job.id}`);
    try {
      await this.printer.printReceipt(this.formatter(job.order));
      job.status = 'printed'; job.printedAt = this.now(); job.lastError = '';
      this.logger.info('SUCCESS', `Pedido #${job.id} impresso`);
    } catch (error) {
      job.lastError = String(error.message || error).slice(0, 500);
      if (error.uncertain) {
        job.status = 'uncertain';
        this.logger.error('QUEUE', `Pedido #${job.id} ficou incerto e não será repetido automaticamente`, job.lastError);
      } else {
        job.status = 'pending'; job.retryAt = this.now() + this.retryMs;
        this.logger.error('ERROR', `Impressora indisponível; pedido #${job.id} continuará pendente`, job.lastError);
      }
    } finally {
      this.store.save(); this.running = false;
    }
    return true;
  }
  start() { this.wake(); this.timer = setInterval(() => this.drainOnce().catch(error => this.logger.error('SERVICE', 'Erro inesperado na fila', error.message)), Math.min(this.retryMs, 5000)); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  wake() { setImmediate(() => this.drainOnce().catch(error => this.logger.error('SERVICE', 'Erro inesperado na fila', error.message))); }
  retry(id) {
    const job = this.store.load().jobs.find(entry => entry.id === id && ['uncertain', 'pending'].includes(entry.status));
    if (!job) return false;
    job.status = 'pending'; job.retryAt = 0; job.lastError = ''; this.store.save(); this.wake(); return true;
  }
}

module.exports = { PrintQueue, StateStore };

