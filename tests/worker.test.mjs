import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker, validateOrder} from '../server/worker.js';
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
  const webhook = (signature='valid') => worker.fetch(new Request(env.PUBLIC_API_URL+'/api/webhooks/mercado-pago?data.id=10001',{method:'POST',headers:{'Content-Type':'application/json','x-signature':signature,'x-request-id':'request'},body:JSON.stringify({type:'payment',data:{id:'10001'}})}),env);
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
  await f.worker.scheduled({},f.env); assert.equal((await (await f.get(row.id)).json()).status,'approved');
  f.env.DB.db.prepare('UPDATE orders SET created_at=?').run(Date.now()-8*86400000);
  await f.worker.scheduled({},f.env); assert.equal((await f.get(row.id)).status,404);
});
