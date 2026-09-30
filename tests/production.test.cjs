const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { build } = require('../scripts/build.cjs');
const root = path.resolve(__dirname, '..');

function navigation(positions = [90, 900, 1400, 1800]) {
  const callbacks = [], timers = new Map(), handlers = {};
  let timerId = 0;
  const ids = ['hamburgueres', 'combos', 'porcoes', 'bebidas'];
  const tabs = ids.map(id => {
    const classes = new Set(id === 'hamburgueres' ? ['active'] : []);
    const attrs = { href: '#' + id };
    return { getAttribute: key => attrs[key], setAttribute: (key,value) => { attrs[key] = value; }, removeAttribute: key => { delete attrs[key]; }, classList: { contains: c => classes.has(c), toggle: (c,on) => on ? classes.add(c) : classes.delete(c) }, addEventListener: (event,cb) => { handlers[id] = cb; } };
  });
  const sections = ids.map((id,index) => ({ getAttribute: () => id, getBoundingClientRect: () => ({ top: positions[index], bottom: positions[index] + 500 }) }));
  const win = { pageYOffset: 0, matchMedia: () => ({ matches:false }), scrollTo: () => {}, addEventListener: (event,cb) => { handlers[event] = cb; }, requestAnimationFrame: cb => cb() };
  const doc = { addEventListener: (event,cb) => callbacks.push(cb), querySelectorAll: selector => selector === '.cat-tab' ? tabs : sections, querySelector: selector => selector === '.category-bar-wrap' ? null : selector === '.category-bar' ? { offsetHeight:54 } : sections[ids.indexOf(selector.slice(1))] };
  vm.runInNewContext(fs.readFileSync(path.join(root,'cardapio.js'),'utf8'), { document:doc, window:win, setTimeout: cb => { const id=++timerId; timers.set(id,cb); return id; }, clearTimeout: id => timers.delete(id) });
  callbacks[0]();
  return { win, tabs, handlers, active: () => ids.filter((id,i) => tabs[i].classList.contains('active')), finish: () => { for (const cb of [...timers.values()]) cb(); } };
}

test('navegação recalcula categoria ao encerrar fallback e scrollend', () => {
  for (const finish of ['fallback','scrollend']) {
    const nav = navigation();
    nav.handlers.bebidas({ preventDefault() {} });
    assert.deepEqual(nav.active(), ['bebidas']);
    nav.handlers.scroll(); // Usuário retorna ao topo durante a animação.
    if (finish === 'fallback') nav.finish(); else nav.handlers.scrollend();
    assert.deepEqual(nav.active(), ['hamburgueres']);
    assert.equal(nav.tabs[0].getAttribute('aria-current'), 'location');
    assert.equal(nav.tabs[3].getAttribute('aria-current'), undefined);
  }
});

test('navegação retoma acompanhamento após gesto do usuário', () => {
  const nav = navigation();
  nav.handlers.bebidas({ preventDefault() {} });
  nav.handlers.touchstart();
  nav.handlers.scroll();
  assert.deepEqual(nav.active(), ['hamburgueres']);
});

test('página restaurada e posição entre seções mantêm categoria coerente', () => {
  const nav = navigation([-1400,-550,-30,450]);
  nav.win.pageYOffset = 1500;
  nav.handlers.pageshow();
  assert.deepEqual(nav.active(), ['porcoes']);
});

test('HTML e raiz exigem revalidação de cache', () => {
  const { hosting } = JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  for (const source of ['/', '**/*.html']) {
    const rule = hosting.headers.find(rule => rule.source === source);
    assert.ok(rule);
    assert.ok(rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('max-age=0') && header.value.includes('must-revalidate')));
  }
  assert.ok(hosting.redirects.some(rule => rule.source === '/logo-JG.png' && rule.destination === '/logo-JG.webp'));
});

test('títulos sobre verde atingem contraste mínimo e logo é mais leve', () => {
  const css = fs.readFileSync(path.join(root,'cardapio.css'),'utf8');
  const bg = css.match(/--bg-main:\s*#([0-9a-f]{6})/i)[1];
  const title = css.match(/--title-on-green:\s*#([0-9a-f]{6})/i)[1];
  const luminance = color => color.match(/../g).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4).reduce((sum,value,index) => sum+value*[.2126,.7152,.0722][index],0);
  const values = [luminance(bg),luminance(title)];
  assert.ok((Math.max(...values)+.05)/(Math.min(...values)+.05) >= 3);
  assert.ok(fs.statSync(path.join(root,'logo-JG.webp')).size < fs.statSync(path.join(root,'logo-JG.png')).size);
});

test('build bloqueia arquivo extra e mantém somente os assets públicos esperados', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'jg-build-test-'));
  const publicPath = path.join(fixture,'public');
  const assets = ['cardapio.css','cardapio.js','pedido.js','pix.js','logo-JG.webp'];
  try {
    for (const file of [...assets,'cardapio.html']) fs.writeFileSync(path.join(fixture,file),'fixture');
    build(fixture);
    assert.deepEqual(fs.readdirSync(publicPath).sort(), [...assets,'index.html'].sort());
    const sentinel = path.join(publicPath,'internal.txt');
    fs.writeFileSync(sentinel,'must not publish');
    assert.throws(() => build(fixture), /arquivo inesperado/);
    assert.equal(fs.readFileSync(sentinel,'utf8'),'must not publish');
  } finally {
    // Remove apenas arquivos criados por este teste, sem exclusão recursiva.
    if (fs.existsSync(publicPath)) {
      for (const file of fs.readdirSync(publicPath)) fs.unlinkSync(path.join(publicPath,file));
      fs.rmdirSync(publicPath);
    }
    for (const file of fs.readdirSync(fixture)) fs.unlinkSync(path.join(fixture,file));
    fs.rmdirSync(fixture);
  }
});
