import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker, validateOrder, validatePrintOrder} from '../server/worker.js';
import {catalog} from '../server/catalog.js';

// Execute the actual SQL against SQLite, including constraints/atomic UPDATE claims.
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const statement = this.db.prepare(sql); let params = [];
    const query = {bind(...values) { params = values; return query; },
      async first() { return statement.get(...params) || null; },
      async all() { return {results: statement.all(...params)}; },
      async run() { const result = statement.run(...params); return {meta: {changes: result.changes}}; }};
    return query;
  }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
}
const origin = 'https://jg-hamburgueria.web.app';
const token = Buffer.alloc(32, 7).toString('base64url');
const order = () => ({payment: 'pix', fulfillment: 'delivery', items: [{id:'item-1',quantity:2,notes:'Sem cebola'}], customer:'Cliente',address:'Rua A, 10', neighborhood:'Centro', payerEmail:'cliente@example.com'});
function fixture(overrides = {}) {
  const payments = new Map(); let calls = 0; let reads = 0;
  const provider = {
    async createPix(args) { calls++; const payment = {id:'10001',status:'pending',amountCents:args.amountCents,externalReference:args.orderId,qrCode:'pix-test',qrCodeBase64:'cGl4',expiresAt:new Date(Date.now()+3600000).toISOString(),collectorId:'123',currencyId:'BRL',paymentMethodId:'pix'}; payments.set(payment.id,payment); return payment; },
    async getPayment({paymentId}) { reads++; return {...payments.get(String(paymentId))}; },
    async verifyWebhook({signature}) { return signature === 'valid'; }, ...overrides,
  };
  const env = {DB:new D1(),PIX_ENABLED:'true',MP_ACCESS_TOKEN:'private-token',MP_WEBHOOK_SECRET:'private-webhook',RATE_LIMIT_SECRET:'private-rate',MP_COLLECTOR_ID:'123',PUBLIC_API_URL:'https://jg-pix.example.workers.dev',ALLOWED_ORIGINS:origin};
  const worker = createWorker(provider);
  const key = crypto.randomUUID();
  const post = (body=order(), headers={}) => worker.fetch(new Request(env.PUBLIC_API_URL+'/api/orders', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':key,...headers},body:JSON.stringify(body)}),env);
  const get = (id, secret=token) => worker.fetch(new Request(env.PUBLIC_API_URL+'/api/orders/'+id,{headers:{Origin:origin,Authorization:`Bearer ${secret}`}}),env);
  const webhook = (signature='valid') => worker.fetch(new Request(env.PUBLIC_API_URL+'/api/webhooks/mercado-pago?data.id=10001',{method:'POST',headers:{'Content-Type':'application/json','x-signature':signature,'x-request-id':'request'},body:JSON.stringify({type:'order',data:{id:'10001'}})}),env);
  return {env,worker,post,get,webhook,payments,key,provider,calls:()=>calls,reads:()=>reads};
}
test('server catalog controls price, delivery and beverage notes', () => {
  const body = {...order(),amountCents:1,items:[{id:'item-1',quantity:2,priceCents:1}]};
  assert.equal(validateOrder(body).amountCents,5698);
  assert.equal(validateOrder({...body,fulfillment:'pickup'}).amountCents,5398);
  assert.throws(()=>validateOrder({...body,items:[{id:'item-8',quantity:1,notes:'qualquer'}]}));
  assert.throws(()=>validateOrder({...body,items:[{id:'item-1',quantity:1},{id:'item-1',quantity:1}]}));
  assert.throws(()=>validateOrder({...body,items:[{id:'toString',quantity:1}]}));
});
test('server catalog agrees with every price published in current menu', () => {
  const html=readFileSync(new URL('../cardapio.html',import.meta.url),'utf8');
  const products=[...html.matchAll(/data-product-id="([^"]+)" data-price="(\d+)"/g)];
  assert.equal(products.length,Object.keys(catalog).length);
  for(const [,id,price] of products) assert.equal(catalog[id].priceCents,Number(price));
});
test('print confirmation accepts local payments without change and rejects unapproved Pix', () => {
  const base = {fulfillment:'pickup',items:[{id:'item-1',quantity:1,notes:''}],customer:'Cliente'};
  for (const payment of ['cash','debit','credit']) {
    const validated = validatePrintOrder({...base,payment,needsChange:false,changeForCents:0});
    assert.equal(validated.payment,payment); assert.equal(validated.changeForCents,0);
  }
  assert.throws(() => validatePrintOrder({...base,payment:'cash',needsChange:true,changeForCents:1}), /Troco/);
  assert.throws(() => validatePrintOrder({...base,payment:'pix'}), /Pedido inválido/);
});
test('durable retry and concurrent claims create one charge; no PII returned', async () => {
  const f=fixture(); const results=await Promise.all([f.post(),f.post()]);
  assert.ok(results.every(result=>[200,202].includes(result.status)));
  assert.equal(f.calls(),1);
  const retry=await f.post(); const row=await retry.json();
  assert.equal(row.status,'pending'); assert.equal(row.amountCents,5698); assert.equal(row.qrCode,'pix-test');
  assert.equal(f.calls(),1); assert.equal(row.customer,undefined); assert.equal(row.payerEmail,undefined);
  assert.equal(retry.headers.get('Cache-Control'),'no-store');
  assert.equal((await f.post({...order(),customer:'Outro'})).status,409);
  assert.equal((await f.post(order(),{Authorization:`Bearer ${Buffer.alloc(32,9).toString('base64url')}`})).status,409);
  assert.equal((await f.get(row.id,Buffer.alloc(32,8).toString('base64url'))).status,404);
  assert.equal((await f.get(row.id)).status,200);
});
test('provider timeout retry retains same durable idempotency key', async () => {
  let attempt=0; const keys=[];
  const f=fixture({async createPix(args){ keys.push(args.idempotencyKey); if(++attempt===1) throw Error('timeout after accepted'); return {id:'10001',status:'pending',amountCents:args.amountCents,externalReference:args.orderId,collectorId:'123',currencyId:'BRL',paymentMethodId:'pix'}; }});
  assert.equal((await f.post()).status,503); assert.equal((await f.post()).status,200);
  assert.deepEqual(keys,[f.key,f.key]);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,1);
});
test('unsigned webhook rejected; verified provider result approves once and cannot regress', async () => {
  const f=fixture(); const created=await (await f.post()).json();
  assert.equal((await f.webhook('forged')).status,401); assert.equal(f.reads(),0);
  f.payments.get('10001').status='approved';
  assert.equal((await f.webhook()).status,200); assert.equal((await f.webhook()).status,200);
  assert.equal((await (await f.get(created.id)).json()).status,'approved');
  f.payments.get('10001').status='pending'; await f.webhook();
  assert.equal((await (await f.get(created.id)).json()).status,'approved');
  f.payments.get('10001').status='refunded'; await f.webhook();
  assert.equal((await (await f.get(created.id)).json()).status,'refunded');
});
test('provider amount, receiver and reference must match before approval', async () => {
  for (const [field,value] of [['amountCents',1],['collectorId','999'],['externalReference',crypto.randomUUID()],['currencyId','USD'],['paymentMethodId','card']]) {
    const f=fixture(); const row=await (await f.post()).json(); f.payments.get('10001').status='approved'; f.payments.get('10001')[field]=value;
    await f.webhook(); assert.equal((await (await f.get(row.id)).json()).status,'pending');
  }
});
test('GET catches missed webhooks and throttles provider polling', async () => {
  const f=fixture(); const row=await (await f.post()).json(); f.payments.get('10001').status='approved';
  f.env.DB.db.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(Date.now()-20000,row.id);
  assert.equal((await (await f.get(row.id)).json()).status,'approved'); await f.get(row.id);
  assert.equal(f.reads(),1);
});
test('disabled integration, CORS, token and body size protections', async () => {
  const f=fixture(); f.env.PIX_ENABLED='false'; assert.equal((await f.post()).status,503); f.env.PIX_ENABLED='true';
  assert.equal((await f.post(order(),{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.post(order(),{Authorization:'Bearer short'})).status,401);
  assert.equal((await f.post({...order(),notes:'x'.repeat(17000)})).status,413);
  assert.equal(f.calls(),0);
});
test('creation rate limit prevents unlimited payment charges', async () => {
  const f=fixture(); for(let i=0;i<20;i++) assert.equal((await f.post()).status,200);
  assert.equal((await f.post()).status,429); assert.equal(f.calls(),1);
});
test('scheduled recovery validates payment and deletes expired personal data', async () => {
  const f=fixture(); const row=await (await f.post()).json(); f.payments.get('10001').status='approved';
  f.env.DB.db.prepare('UPDATE orders SET updated_at=?').run(Date.now()-20000);
  await f.worker.scheduled({},f.env); assert.equal((await (await f.get(row.id)).json()).status,'approved');
  f.env.DB.db.prepare('UPDATE orders SET created_at=?').run(Date.now()-8*86400000);
  await f.worker.scheduled({},f.env); assert.equal((await f.get(row.id)).status,404);
});


test('expired payment hides QR and late approval is recovered through GET', async () => {
  const f=fixture(); const row=await (await f.post()).json();
  const past=new Date(Date.now()-60000).toISOString();
  f.payments.get('10001').expiresAt=past;
  f.env.DB.db.prepare('UPDATE orders SET expires_at=?,updated_at=? WHERE id=?').run(past,Date.now()-20000,row.id);
  const expired=await (await f.get(row.id)).json();
  assert.equal(expired.status,'expired'); assert.equal(expired.qrCode,undefined);
  // A provider returning pending with a later expiration must not revive an expired order.
  f.payments.get('10001').expiresAt=new Date(Date.now()+3600000).toISOString();
  await f.webhook(); assert.equal((await (await f.get(row.id)).json()).status,'expired');
  f.payments.get('10001').status='approved';
  f.env.DB.db.prepare('UPDATE orders SET updated_at=?').run(Date.now()-20000);
  assert.equal((await (await f.get(row.id)).json()).status,'approved');
});
test('GET and cron share one atomic payment consultation claim', async () => {
  let unblock; const waiting=new Promise(resolve=>{unblock=resolve;}); let reads=0;
  const f=fixture({async getPayment(){reads++; await waiting; return {...f.payments.get('10001')};}});
  const row=await (await f.post()).json();
  f.env.DB.db.prepare('UPDATE orders SET updated_at=?').run(Date.now()-20000);
  const first=f.get(row.id); const second=f.worker.scheduled({},f.env);
  // Yield until the claimed provider request is running, then release both callers.
  await new Promise(resolve=>setImmediate(resolve)); unblock();
  await Promise.all([first,second]); assert.equal(reads,1);
});
test('uncertain creation GET returns 202 while another caller owns the lease', async () => {
  const f=fixture({async createPix(){throw Error('uncertain');}});
  assert.equal((await f.post()).status,503);
  const row=f.env.DB.db.prepare('SELECT * FROM orders').get();
  f.env.DB.db.prepare('UPDATE orders SET lease_until=?').run(Date.now()+45000);
  assert.equal((await f.get(row.id)).status,202);
});
test('verified late approval advances cancellation and reversed payments never regress', async () => {
  const f=fixture(); const row=await (await f.post()).json();
  for(const status of ['cancelled','approved','refunded','charged_back']) {
    f.payments.get('10001').status=status; assert.equal((await f.webhook()).status,200);
    assert.equal((await (await f.get(row.id)).json()).status,status);
  }
  f.payments.get('10001').status='approved'; await f.webhook();
  assert.equal((await (await f.get(row.id)).json()).status,'charged_back');
});
test('unknown provider status does not create a pending payment', async () => {
  const f=fixture(); await f.post(); f.payments.get('10001').status='unrecognized';
  assert.equal((await f.webhook()).status,502);
  assert.equal(f.env.DB.db.prepare('SELECT status FROM orders').get().status,'pending');
});
test('UUID key casing preserves the same durable attempt', async () => {
  const f=fixture(); await f.post();
  assert.equal((await f.post(order(),{'Idempotency-Key':f.key.toUpperCase()})).status,200);
  assert.equal(f.calls(),1);
});


test('pending consultation without QR preserves saved QR until approval or expiration', async () => {
  for (const finalState of ['approved','expired']) {
    const f=fixture(); const row=await (await f.post()).json();
    f.payments.get('10001').qrCode=null; f.payments.get('10001').qrCodeBase64=null;
    f.env.DB.db.prepare('UPDATE orders SET updated_at=?').run(Date.now()-20000);
    const recovered=await (await f.get(row.id)).json();
    assert.equal(recovered.status,'pending'); assert.equal(recovered.qrCode,'pix-test'); assert.equal(recovered.qrCodeBase64,'cGl4');
    if(finalState==='approved') f.payments.get('10001').status='approved';
    else f.payments.get('10001').expiresAt=new Date(Date.now()-60000).toISOString();
    f.env.DB.db.prepare('UPDATE orders SET updated_at=?').run(Date.now()-20000);
    const final=await (await f.get(row.id)).json();
    assert.equal(final.status,finalState); assert.equal(final.qrCode,undefined); assert.equal(final.qrCodeBase64,undefined);
  }
});

test('print pairing, idempotent approved queue, atomic claim and results are protected', async () => {
  const f = fixture(); const pairing = Buffer.alloc(32, 3).toString('base64url');
  Object.assign(f.env, {PRINT_SERVICE_ENABLED:'true', PRINT_PAIRING_ENABLED:'true', PRINT_PAIRING_SECRET:pairing, PRINT_RETRY_SECONDS:'30'});
  const pair = async (secret = pairing) => f.worker.fetch(new Request(f.env.PUBLIC_API_URL + '/api/print/pair', {method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({name:'caixa-01'})}), f.env);
  assert.equal((await pair('bad')).status, 401);
  const device = await (await pair()).json(); assert.match(device.token, /^[A-Za-z0-9_-]{43}$/);
  const otherDevice = await (await pair()).json();
  f.env.PRINT_PAIRING_ENABLED = 'false';
  assert.equal((await pair()).status, 403);
  const row = await (await f.post()).json(); f.payments.get('10001').status = 'approved';
  await f.webhook(); await f.webhook();
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE order_id=?').get(row.id).count, 0);
  const approvePrint = () => f.worker.fetch(new Request(f.env.PUBLIC_API_URL + `/api/print/orders/${row.id}`, {method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`}}), f.env);
  assert.equal((await approvePrint()).status, 200);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE order_id=?').get(row.id).count, 1);
  const claim = () => f.worker.fetch(new Request(f.env.PUBLIC_API_URL + '/api/print/jobs/claim', {method:'POST',headers:{Authorization:`Bearer ${device.token}`}}), f.env);
  const [first, second] = await Promise.all([claim(), claim()]);
  const leased = [first, second].find(response => response.status === 200); assert.ok(leased); assert.equal([first.status, second.status].filter(status => status === 200).length, 1);
  const job = (await leased.json()).job;
  const result = (status, leaseToken = job.leaseToken) => f.worker.fetch(new Request(f.env.PUBLIC_API_URL + `/api/print/jobs/${job.id}/result`, {method:'POST',headers:{Authorization:`Bearer ${device.token}`,'Content-Type':'application/json'},body:JSON.stringify({status,leaseToken})}), f.env);
  assert.equal((await result('printed', 'wrong')).status, 409);
  assert.equal((await result('failed')).status, 200);
  assert.equal(f.env.DB.db.prepare('SELECT status,available_at FROM print_jobs WHERE id=?').get(job.id).status, 'queued');
  f.env.DB.db.prepare('UPDATE print_jobs SET available_at=0').run();
  const retryClaim = await claim(); const retryJob = (await retryClaim.json()).job;
  assert.equal((await result('uncertain', retryJob.leaseToken)).status, 200);
  const otherRetry = await f.worker.fetch(new Request(f.env.PUBLIC_API_URL + `/api/print/jobs/${job.id}/retry`, {method:'POST',headers:{Authorization:`Bearer ${otherDevice.token}`}}), f.env);
  assert.equal(otherRetry.status, 409);
  const manual = await f.worker.fetch(new Request(f.env.PUBLIC_API_URL + `/api/print/jobs/${job.id}/retry`, {method:'POST',headers:{Authorization:`Bearer ${device.token}`}}), f.env);
  assert.equal(manual.status, 200);
  f.env.DB.db.prepare("UPDATE print_jobs SET status='leased', lease_until=? WHERE id=?").run(Date.now() - 1, job.id);
  await f.worker.scheduled({}, f.env);
  assert.equal(f.env.DB.db.prepare('SELECT status FROM print_jobs WHERE id=?').get(job.id).status, 'uncertain');
  f.env.DB.db.prepare('UPDATE print_devices SET revoked_at=? WHERE id=?').run(Date.now(), device.deviceId);
  assert.equal((await claim()).status, 401);
});

test('confirmed WhatsApp order queues one command for any payment without waiting for Pix', async () => {
  const f = fixture(); Object.assign(f.env, {PRINT_SERVICE_ENABLED:'true', PRINT_PAIRING_ENABLED:'true', PRINT_PAIRING_SECRET:Buffer.alloc(32, 3).toString('base64url'), PRINT_RETRY_SECONDS:'30'});
  const key = crypto.randomUUID(); const body = {...order(), payment:'cash', needsChange:true, changeForCents:6000};
  const submit = () => f.worker.fetch(new Request(f.env.PUBLIC_API_URL + '/api/print/orders', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':key},body:JSON.stringify(body)}), f.env);
  const first = await submit(); const response = await first.json(); assert.equal(first.status, 201); assert.equal(response.queued, true);
  assert.equal((await submit()).status, 201);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM print_jobs').get().count, 1);
  const stored = f.env.DB.db.prepare('SELECT status,payload FROM orders WHERE id=?').get(response.id);
  assert.equal(stored.status, 'print_confirmed'); assert.equal(JSON.parse(stored.payload).payment, 'cash');
});

test('public print confirmation preflight succeeds only for an allowed origin', async () => {
  const f=fixture(); Object.assign(f.env,{PRINT_SERVICE_ENABLED:'true'});
  for (const path of ['/api/print/orders',`/api/print/orders/${crypto.randomUUID()}`]) {
    const preflight = headers => f.worker.fetch(new Request(f.env.PUBLIC_API_URL+path,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,idempotency-key',...headers}}),f.env);
    const allowed=await preflight(); assert.equal(allowed.status,204);
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),origin);
    assert.match(allowed.headers.get('Access-Control-Allow-Headers'),/Authorization/);
    assert.equal((await preflight({Origin:'https://evil.example'})).status,403);
  }
});

test('public print endpoint rejects Pix that did not use the approved-order route', async () => {
  const f=fixture(); Object.assign(f.env,{PRINT_SERVICE_ENABLED:'true'});
  const response=await f.worker.fetch(new Request(f.env.PUBLIC_API_URL+'/api/print/orders',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(order())}),f.env);
  assert.equal(response.status,400);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM print_jobs').get().count,0);
});
