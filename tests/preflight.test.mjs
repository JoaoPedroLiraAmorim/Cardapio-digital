import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectConfig, parseConfig, readSecrets} from '../server/preflight.mjs';
const model = () => parseConfig(readFileSync(new URL('../server/wrangler.hml.example.jsonc', import.meta.url), 'utf8'));
const production = parseConfig(readFileSync(new URL('../server/wrangler.example.jsonc', import.meta.url), 'utf8'));
function fixture() {
  const config = model();
  config.vars.PUBLIC_API_URL = 'https://jg-pix-hml.test.workers.dev';
  config.vars.ALLOWED_ORIGINS = 'https://jg-hamburgueria-hml.web.app';
  config.vars.MP_COLLECTOR_ID = '123';
  config.d1_databases[0].database_id = 'e470400c-bf89-4c01-b6a8-dfe17ebd338a';
  return {config, secrets:{MP_ACCESS_TOKEN:'fake-test-token', MP_WEBHOOK_SECRET:'fake-webhook-secret', RATE_LIMIT_SECRET:'a'.repeat(64)}, production};
}
test('HML template stays disabled and reports missing resources without network', () => {
  const result = inspectConfig(model(), {production, template:true});
  assert.deepEqual(result.errors, []); assert.ok(result.pending.length >= 5);
  assert.ok(inspectConfig(model(), {production}).errors.length >= 5);
});
test('completed local HML configuration passes without printing secrets', () => {
  const {config,...options}=fixture(); const result=inspectConfig(config,options);
  assert.deepEqual(result,{errors:[],pending:[]});
  config.vars.MP_ACCESS_TOKEN='token-sensitive';
  const errors=inspectConfig(config,options).errors;
  assert.ok(errors.some(value=>value.includes('deve ser secret')));
  assert.ok(!JSON.stringify(errors).includes('token-sensitive'));
});
test('preflight rejects production reuse, activation, unsafe URL and wildcards', () => {
  const cases = [c=>{c.name=production.name;}, c=>{c.vars.PIX_ENABLED='true';}, c=>{c.vars.PUBLIC_API_URL='https://user:password@example.org';}, c=>{c.vars.ALLOWED_ORIGINS='https://*.web.app';}, c=>{c.vars.ALLOWED_ORIGINS=production.vars.ALLOWED_ORIGINS;}, c=>{c.d1_databases[0].database_name=production.d1_databases[0].database_name;}, c=>{c.vars.MAX_DAILY_ORDERS='-10';}];
  for(const mutate of cases){const {config,...options}=fixture(); mutate(config); assert.ok(inspectConfig(config,options).errors.length);}
});
test('JSONC parser preserves URL strings; dotenv reader does not execute values', () => {
  assert.deepEqual(parseConfig('// note\n{"url":"https://example.org",/* comment */"name":"hml"}'),{url:'https://example.org',name:'hml'});
  assert.equal(readSecrets('# local\nMP_ACCESS_TOKEN="$(do-not-run)"\n').MP_ACCESS_TOKEN,'$(do-not-run)');
  assert.throws(()=>readSecrets('invalid line')); assert.throws(()=>parseConfig('{/* unclosed'));
});
