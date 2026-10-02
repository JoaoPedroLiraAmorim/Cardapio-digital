// Local only: reads files/environment; never fetches, provisions or deploys.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const secretNames = ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'RATE_LIMIT_SECRET'];
const placeholder = value => /SUBSTITUIR|PLACEHOLDER|SEU[-_ ]|EXAMPLE|CHANGEME/i.test(String(value ?? ''));

// Strip JSONC comments without damaging https:// inside strings. Reject other syntax.
export function parseConfig(text) {
  let output = '', quoted = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      output += char;
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Configuração JSONC inválida.');
      i = end + 1; output += ' ';
    } else output += char;
  }
  return JSON.parse(output);
}
export function readSecrets(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) throw new Error('Formato do arquivo local de secrets inválido.');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}
function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      value === url.origin && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.includes('*');
  } catch { return false; }
}
export function inspectConfig(config, {secrets = {}, production = {}, template = false} = {}) {
  const errors = [], pending = [];
  const vars = config.vars || {};
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const complete = (condition, message) => { if (!condition) (template ? pending : errors).push(message); };
  check(/^[a-z0-9][a-z0-9-]*-hml$/.test(config.name || ''), 'Worker deve ter nome próprio terminado em -hml.');
  check(config.name !== production.name, 'Worker HML não pode reutilizar o nome de produção.');
  check(config.main === 'worker.js', 'Entrypoint deve ser worker.js.');
  check(config.vars?.ENVIRONMENT === 'hml', 'ENVIRONMENT deve ser hml.');
  check(vars.PIX_ENABLED === 'false', 'Mantenha PIX_ENABLED=false durante a preparação.');
  check(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date || ''), 'compatibility_date é obrigatório.');
  check(Number.isSafeInteger(Number(vars.MAX_DAILY_ORDERS)) && Number(vars.MAX_DAILY_ORDERS) >= 1 && Number(vars.MAX_DAILY_ORDERS) <= 500, 'MAX_DAILY_ORDERS deve ser inteiro de 1 a 500 para HML.');
  check(httpsOrigin(vars.PUBLIC_API_URL), 'PUBLIC_API_URL deve ser uma origem HTTPS sem barra final, credencial, caminho ou query.');
  complete(!placeholder(vars.PUBLIC_API_URL), 'Preencher URL real do Worker HML.');
  check(vars.PUBLIC_API_URL !== production.vars?.PUBLIC_API_URL, 'URL da API deve ser diferente da produção.');
  const origins = typeof vars.ALLOWED_ORIGINS === 'string' ? vars.ALLOWED_ORIGINS.split(',').map(v => v.trim()) : [];
  check(origins.length > 0 && origins.every(httpsOrigin), 'ALLOWED_ORIGINS deve conter somente origens HTTPS explícitas.');
  complete(origins.every(v => !placeholder(v)), 'Preencher origem estável do frontend HML.');
  const productionOrigins = (production.vars?.ALLOWED_ORIGINS || '').split(',').map(v => v.trim());
  check(origins.every(v => !productionOrigins.includes(v)), 'Frontend HML não pode apontar para uma origem de produção.');
  complete(/^\d{1,30}$/.test(vars.MP_COLLECTOR_ID || ''), 'Preencher MP_COLLECTOR_ID numérico da conta de teste.');
  const databases = config.d1_databases || [];
  const db = databases.find(value => value.binding === 'DB');
  check(databases.length === 1 && !!db, 'Configurar exatamente um D1 com binding DB.');
  check(/^[a-z0-9][a-z0-9-]*-hml$/.test(db?.database_name || ''), 'D1 deve ter nome próprio terminado em -hml.');
  complete(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db?.database_id || ''), 'Preencher UUID real do banco D1 HML.');
  check(!(production.d1_databases || []).some(value => value.database_name === db?.database_name || (db?.database_id && !placeholder(db.database_id) && value.database_id === db.database_id)), 'D1 HML deve ser diferente do banco de produção.');
  check(config.triggers?.crons?.includes('*/5 * * * *'), 'Configurar cron de recuperação a cada cinco minutos.');
  check(config.observability?.enabled === false, 'Observabilidade deve permanecer desligada no modelo.');
  for (const name of secretNames) {
    check(!Object.hasOwn(vars, name), `${name} deve ser secret; remova-o de vars.`);
    complete(typeof secrets[name] === 'string' && !!secrets[name].trim() && !placeholder(secrets[name]), `${name}: secret ainda não disponível localmente.`);
  }
  if (secrets.RATE_LIMIT_SECRET && !placeholder(secrets.RATE_LIMIT_SECRET)) check(/^[0-9a-f]{64,}$/i.test(secrets.RATE_LIMIT_SECRET) || /^[A-Za-z0-9_-]{43,}$/.test(secrets.RATE_LIMIT_SECRET), 'RATE_LIMIT_SECRET deve representar pelo menos 32 bytes aleatórios (hex ou base64url).');
  return {errors, pending};
}
function cli() {
  const args = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template') options.template = true;
    else if (['--config', '--secrets-file', '--production-config'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i];
    else throw new Error('Argumento inválido. Use --template, --config, --secrets-file ou --production-config.');
  }
  const base = new URL('./', import.meta.url);
  const config = parseConfig(readFileSync(options.config ? resolve(options.config) : new URL('wrangler.hml.example.jsonc', base), 'utf8'));
  const production = parseConfig(readFileSync(options['production-config'] ? resolve(options['production-config']) : new URL('wrangler.example.jsonc', base), 'utf8'));
  const secrets = options['secrets-file'] ? readSecrets(readFileSync(resolve(options['secrets-file']), 'utf8')) : process.env;
  const result = inspectConfig(config, {secrets, production, template: options.template});
  for (const message of result.errors) console.error(`ERRO: ${message}`);
  for (const message of result.pending) console.log(`PENDENTE: ${message}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log(options.template ? 'Modelo HML validado; recursos e secrets ainda precisam ser configurados. Pix permanece desligado.' : 'Configuração local validada. Não comprova recursos remotos, secrets do Worker ou conta Mercado Pago; Pix permanece desligado.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); } catch { console.error('Não foi possível ler a configuração local. Confira arquivos, permissões e sintaxe; valores não foram exibidos.'); process.exitCode = 1; }
}
