'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`Linha inválida no .env: ${raw}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value.replace(/\\n/g, '\n');
  }
  return values;
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Valores booleanos devem ser true ou false.');
}

function integer(value, fallback, min, max, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} inválido.`);
  return parsed;
}

function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const file = path.join(cwd, '.env');
  const local = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  const values = { ...local, ...env };
  const printerName = String(values.PRINTER_NAME || '').trim();
  if (!printerName) throw new Error('Configure PRINTER_NAME no arquivo .env.');
  const mode = String(values.MODE || 'local').trim().toLowerCase();
  if (!['local', 'hml', 'production'].includes(mode)) throw new Error('MODE deve ser local, hml ou production.');
  if (mode === 'production') throw new Error('MODE=production está bloqueado até uma promoção futura.');
  const stateFile = path.resolve(cwd, values.STATE_FILE || './data/print-state.json');
  const hmlApiUrl = String(values.HML_API_URL || 'https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev').replace(/\/$/, '');
  if (mode === 'hml' && hmlApiUrl !== 'https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev') throw new Error('HML_API_URL não é o Worker HML autorizado.');
  const deviceName = String(values.DEVICE_NAME || '').trim();
  if (mode === 'hml' && !deviceName) throw new Error('Configure DEVICE_NAME para o pareamento HML.');
  return Object.freeze({
    mode,
    printerName,
    nodeEnv: values.NODE_ENV || 'development',
    stateFile,
    retryMs: integer(values.PRINT_RETRY_SECONDS, 60, 5, 3600, 'PRINT_RETRY_SECONDS') * 1000,
    timeoutMs: integer(values.PRINT_TIMEOUT_SECONDS, 30, 5, 300, 'PRINT_TIMEOUT_SECONDS') * 1000,
    columns: integer(values.PAPER_COLUMNS, 42, 32, 64, 'PAPER_COLUMNS'),
    paperCut: bool(values.ENABLE_PAPER_CUT, true),
    copies: integer(values.PRINT_COPIES, 1, 1, 3, 'PRINT_COPIES'),
    hml: { apiUrl: hmlApiUrl, deviceName },
  });
}

module.exports = { loadConfig, parseEnv };
