const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const order = require('./pedido.js');
const html = fs.readFileSync(__dirname + '/cardapio.html', 'utf8');
const products = Object.create(null);
for (const match of html.matchAll(/<article data-product-id="([^"]+)" data-price="(\d+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<span class="(?:item|drink)-price">R\$ (\d+),(\d{2})<\/span>/g)) {
  products[match[1]] = { name: match[3], price: Number(match[2]), allowsNotes: !match[0].includes('class="drink-item"') };
  assert.equal(Number(match[2]), Number(match[4]) * 100 + Number(match[5]));
}
const cart = [{ id: 'item-1', quantity: 2, notes: 'Um sem cebola' }, { id: 'item-8', quantity: 1, notes: '' }];
test('catálogo completo e preços consistentes com o cardápio', () => assert.equal(Object.keys(products).length, 12));
test('total em centavos, entrega de R$ 3 e retirada grátis', () => {
  assert.deepEqual(order.totals(cart, products, 'delivery'), { subtotal: 5898, delivery: 300, total: 6198 });
  assert.deepEqual(order.totals(cart, products, 'pickup'), { subtotal: 5898, delivery: 0, total: 5898 });
  assert.deepEqual(order.totals([], products, 'delivery'), { subtotal: 0, delivery: 0, total: 0 });
});
test('restaura apenas itens válidos sem confiar em preços salvos', () => {
  assert.deepEqual(order.restore([{ id: 'item-8', quantity: 1, notes: 'Observação antiga da bebida' }], products), [{ id: 'item-8', quantity: 1, notes: '' }]);
  assert.deepEqual(order.restore([{ id: 'item-1', quantity: 2, price: 1 }, { id: 'item-1', quantity: 1 }, { id: 'desconhecido', quantity: 1 }, { id: 'item-2', quantity: -1 }, { id: 'item-3', quantity: 1.5 }, { id: 'item-4', quantity: 100 }, null], products), [{ id: 'item-1', quantity: 2, notes: '' }]);
  assert.deepEqual(order.restore({}, products), []);
});
test('mensagem inclui itens, observações, endereço, pagamento e total correto', () => {
  const message = order.message(cart.map(item => item.id === 'item-8' ? { ...item, notes: 'Observação antiga da bebida' } : item), products, { customer: 'Teste', fulfillment: 'delivery', address: 'Rua de teste, 123', neighborhood: 'Centro', reference: 'Casa', payment: 'cash', needsChange: true, changeFor: 10000, notes: 'Tocar campainha' });
  assert.ok(!message.includes('Observação antiga da bebida'));
  for (const expected of ['2 × Burg da casa', 'Um sem cebola', 'Rua de teste, 123', 'Bairro: Centro', 'Complemento/referência: Casa', 'Pagamento: Dinheiro', 'Troco para:', 'Tocar campainha']) assert.ok(message.includes(expected));
  assert.ok(message.includes(`Total: ${order.money(6198)}`));
  assert.equal(order.config.whatsapp, '5512983157450');
  assert.equal(new URL(`https://wa.me/${order.config.whatsapp}?text=${encodeURIComponent(message)}`).searchParams.get('text'), message);
});
test('todos os pagamentos e retirada sem endereço ou troco indevido', () => {
  for (const [payment, label] of Object.entries({ pix: 'Pix', debit: 'Cartão de débito', credit: 'Cartão de crédito', cash: 'Dinheiro' })) {
    const message = order.message(cart, products, { customer: 'Teste', fulfillment: 'pickup', address: 'Endereço antigo', payment });
    assert.ok(message.includes(`Pagamento: ${label}`));
    assert.ok(message.includes('Tipo: Retirada'));
    assert.ok(!message.includes('Endereço:'));
    assert.ok(!message.includes('Troco para:'));
    assert.ok(message.includes(`Total: ${order.money(5898)}`));
  }
});
