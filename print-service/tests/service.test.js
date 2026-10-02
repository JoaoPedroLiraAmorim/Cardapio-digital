'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { formatOrder } = require('../src/formatter');
const { rawReceipt } = require('../src/printer');
const { HmlClient } = require('../src/hml-client');
const { PrintQueue, StateStore } = require('../src/print-queue');
const { runHml } = require('../src/index');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jg-print-test-')); }
const base = { PRINTER_NAME:'Teste', MODE:'local' };

test('configuration supports local and HML while production remains blocked', () => {
  const cwd = temp();
  assert.equal(loadConfig({cwd,env:base}).mode, 'local');
  const hml = loadConfig({cwd,env:{...base,MODE:'hml',DEVICE_NAME:'caixa'}});
  assert.equal(hml.hml.apiUrl, 'https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev');
  assert.equal(loadConfig({cwd,env:{...base,PRINT_COPIES:'2'}}).copies, 2);
  assert.throws(() => loadConfig({cwd,env:{...base,PRINT_COPIES:'4'}}), /PRINT_COPIES/);
  assert.throws(() => loadConfig({cwd,env:{...base,MODE:'production'}}), /bloqueado/);
  assert.throws(() => loadConfig({cwd,env:{...base,MODE:'hml',DEVICE_NAME:'caixa',HML_API_URL:'https:\/\/other.example'}}), /autorizado/);
});

test('formatter includes delivery, additions, removals, observations and money', () => {
  const receipt = formatOrder({id:'abc',fulfillment:'delivery',customer:'Ana',address:'Rua A',neighborhood:'Centro',items:[{name:'X',quantity:2,priceCents:1000,additions:['Bacon'],removals:['Cebola'],notes:'Bem passado'}],subtotalCents:2000,deliveryCents:300,totalCents:2300,payment:'pix',notes:'Interfone'}, {columns:42});
  for (const text of ['ENTREGA','+ Bacon','- SEM Cebola','OBS: Bem passado','PIX','R$']) assert.ok(receipt.includes(text));
  assert.ok(!receipt.includes('R$?'));
});

test('comanda RAW preserva texto ASCII e envia o corte parcial ESC/POS', () => {
  const bytes = rawReceipt('João\r\nPedido', true);
  assert.deepEqual([...bytes.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x61, 0x00]);
  assert.match(bytes.toString('ascii'), /Jo\?o\r\nPedido/);
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x01]);
});

test('HML client persists the device token after pairing and sends authenticated claim', async () => {
  const cwd = temp(); const stateFile = path.join(cwd, 'state.json'); const seen = [];
  const fetchImpl = async (url, init) => { seen.push({url,init}); if (url.endsWith('/pair')) return Response.json({deviceId:'d1',token:'a'.repeat(43)}); return new Response(null,{status:204}); };
  const client = new HmlClient({apiUrl:'https://hml.example',stateFile,fetchImpl});
  await client.pair({pairingSecret:'b'.repeat(32),name:'caixa'}); await client.claim();
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).device.id,'d1');
  assert.equal(seen[1].init.headers.Authorization,`Bearer ${'a'.repeat(43)}`);
});

test('HML processing removes order PII after reporting a terminal result', async () => {
  const cwd=temp(); const file=path.join(cwd,'state.json'); const results=[];
  const store=new StateStore(file);
  const order={id:'order-1',number:'ABC',customer:'Cliente secreto',fulfillment:'delivery',address:'Rua privada',items:[{name:'X',quantity:1,priceCents:1000}],subtotalCents:1000,deliveryCents:300,totalCents:1300};
  const client={async claim(){return {job:{id:'11111111-1111-4111-8111-111111111111',attempt:1,leaseToken:'lease',order}};},async result(id,body){results.push({id,body});}};
  await runHml({client,store,printer:{async printReceipt(){}},config:{columns:42}});
  const saved=JSON.parse(fs.readFileSync(file,'utf8')).jobs[0];
  assert.equal(saved.status,'printed'); assert.equal(saved.order,undefined); assert.equal(saved.leaseToken,undefined);
  assert.equal(results[0].body.status,'printed');

  const interrupted={version:1,device:null,jobs:[{id:'22222222-2222-4222-8222-222222222222',status:'printing',leaseToken:'old-lease',order}]};
  fs.writeFileSync(file,JSON.stringify(interrupted));
  const restartResults=[];
  await runHml({client:{async claim(){return null;},async result(id,body){restartResults.push({id,body});}},store:new StateStore(file),printer:{},config:{columns:42}});
  const recovered=JSON.parse(fs.readFileSync(file,'utf8')).jobs[0];
  assert.equal(recovered.status,'uncertain'); assert.equal(recovered.order,undefined); assert.equal(recovered.leaseToken,undefined);
  assert.equal(restartResults[0].body.status,'uncertain');
});

test('queue serializes jobs and marks an interrupted print uncertain after restart', async () => {
  const cwd=temp(); const file=path.join(cwd,'state.json'); const logs=[]; let active=0, max=0;
  const queue = new PrintQueue({store:new StateStore(file),printer:{async printReceipt(){active++;max=Math.max(max,active); await new Promise(r=>setTimeout(r,5)); active--;}},formatter:order=>order.id,logger:{info(){},error(...args){logs.push(args);}},retryMs:1});
  queue.enqueue({id:'1',items:[{}]}); queue.enqueue({id:'2',items:[{}]}); await queue.drainOnce(); await queue.drainOnce();
  assert.equal(max,1); assert.deepEqual(new StateStore(file).load().jobs.map(job=>job.status),['printed','printed']);
  const state=JSON.parse(fs.readFileSync(file,'utf8')); state.jobs.push({id:'3',status:'printing'}); fs.writeFileSync(file,JSON.stringify(state));
  assert.equal(new StateStore(file).load().jobs.find(job=>job.id==='3').status,'uncertain');
});
