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
  const enableFirebase = bool(values.ENABLE_FIREBASE, false);
  const stateFile = path.resolve(cwd, values.STATE_FILE || './data/print-state.json');
  const serviceAccountPath = values.FIREBASE_SERVICE_ACCOUNT_PATH ? path.resolve(cwd, values.FIREBASE_SERVICE_ACCOUNT_PATH) : '';
  if (enableFirebase && !values.FIREBASE_PROJECT_ID) throw new Error('Configure FIREBASE_PROJECT_ID antes de ativar o Firebase.');
  if (enableFirebase && !serviceAccountPath && !env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Configure FIREBASE_SERVICE_ACCOUNT_PATH ou GOOGLE_APPLICATION_CREDENTIALS.');
  return Object.freeze({
    enableFirebase,
    printerName,
    nodeEnv: values.NODE_ENV || 'development',
    stateFile,
    retryMs: integer(values.PRINT_RETRY_SECONDS, 60, 5, 3600, 'PRINT_RETRY_SECONDS') * 1000,
    timeoutMs: integer(values.PRINT_TIMEOUT_SECONDS, 30, 5, 300, 'PRINT_TIMEOUT_SECONDS') * 1000,
    columns: integer(values.PAPER_COLUMNS, 42, 32, 64, 'PAPER_COLUMNS'),
    paperCut: bool(values.ENABLE_PAPER_CUT, true),
    firebase: {
      projectId: values.FIREBASE_PROJECT_ID || '',
      serviceAccountPath,
      collection: values.FIREBASE_COLLECTION || 'printJobs',
    },
  });
}

module.exports = { loadConfig, parseEnv };

