'use strict';

const fs = require('node:fs');
const path = require('node:path');

class HmlClientError extends Error {
  constructor(message, { retryable = true, status = 0 } = {}) { super(message); this.name = 'HmlClientError'; this.retryable = retryable; this.status = status; }
}

function privateFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are managed by the account. */ }
}

class HmlClient {
  constructor({ apiUrl, stateFile, fetchImpl = global.fetch, timeoutMs = 10000 }) {
    this.apiUrl = apiUrl.replace(/\/$/, ''); this.stateFile = stateFile; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  state() {
    if (!fs.existsSync(this.stateFile)) return { version: 1, jobs: [], device: null };
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
  }
  save(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.stateFile); privateFile(this.stateFile);
  }
  token() {
    const token = this.state().device?.token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new HmlClientError('Dispositivo HML não pareado. Execute npm run hml:pair.', { retryable: false });
    return token;
  }
  async request(route, { method = 'POST', token, body } = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.apiUrl + route, { method, signal: controller.signal, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      }, body: body ? JSON.stringify(body) : undefined });
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new HmlClientError(payload.error || `Worker HML respondeu ${response.status}.`, { retryable: response.status >= 500, status: response.status });
      return payload;
    } catch (error) {
      if (error instanceof HmlClientError) throw error;
      throw new HmlClientError(error.name === 'AbortError' ? 'Tempo excedido ao consultar o Worker HML.' : 'Não foi possível comunicar com o Worker HML.');
    } finally { clearTimeout(timer); }
  }
  async pair({ pairingSecret, name }) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(pairingSecret || '')) throw new HmlClientError('Código de pareamento inválido.', { retryable: false });
    const paired = await this.request('/api/print/pair', { token: pairingSecret, body: { name } });
    if (!paired?.deviceId || !/^[A-Za-z0-9_-]{43}$/.test(paired.token || '')) throw new HmlClientError('Resposta de pareamento inválida.');
    const state = this.state(); state.device = { id: paired.deviceId, token: paired.token, pairedAt: Date.now() }; this.save(state);
    return { deviceId: paired.deviceId };
  }
  claim() { return this.request('/api/print/jobs/claim', { token: this.token() }); }
  result(id, body) { return this.request(`/api/print/jobs/${encodeURIComponent(id)}/result`, { token: this.token(), body }); }
  retry(id) { return this.request(`/api/print/jobs/${encodeURIComponent(id)}/retry`, { token: this.token() }); }
}

module.exports = { HmlClient, HmlClientError };
