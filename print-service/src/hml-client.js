'use strict';

class HmlClient {
  constructor({ config, store, fetchImpl = global.fetch }) {
    this.config = config; this.store = store; this.fetch = fetchImpl;
  }
  async request(path, { token, body } = {}) {
    const response = await this.fetch(`${this.config.apiUrl}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Worker respondeu ${response.status}.`);
    return data;
  }
  async pair() {
    const state = this.store.load();
    if (state.deviceToken) return state.deviceToken;
    const data = await this.request('/api/print/pair', { token: this.config.pairingSecret, body: { name: this.config.deviceName } });
    if (!data?.token || !data?.deviceId) throw new Error('Resposta de pareamento inválida.');
    state.deviceId = data.deviceId; state.deviceToken = data.token; this.store.save();
    return state.deviceToken;
  }
  async claim() { return this.request('/api/print/jobs/claim', { token: await this.pair() }); }
  async result(id, body) { return this.request(`/api/print/jobs/${id}/result`, { token: await this.pair(), body }); }
  async uncertain(job) {
    return this.result(job.id, { status: 'uncertain', leaseToken: job.leaseToken, error: 'Serviço reiniciado ou perdeu confirmação do spooler.' });
  }
}

module.exports = { HmlClient };
