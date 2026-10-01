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
test('mensagem de entrega no local segue o modelo e preserva informações opcionais', () => {
  const message = order.message(cart.map(item => item.id === 'item-8' ? { ...item, notes: 'Observação antiga da bebida' } : item), products, { customer: 'Teste', fulfillment: 'delivery', address: 'Rua de teste, 123', neighborhood: 'Centro', reference: 'Casa', payment: 'cash', needsChange: true, changeFor: 10000, notes: 'Tocar campainha' });
  assert.ok(!message.includes('Observação antiga da bebida'));
  assert.equal(message, `Olá, JG Hamburgueria! 👋

Gostaria de fazer este pedido:

👤 Cliente: Teste
🛵 Tipo: Entrega
📍 Endereço: Rua de teste, 123, Bairro: Centro, Complemento/referência: Casa

🛒 Itens
2 × Burg da casa — ${order.money(5398)}
  Observação: Um sem cebola
1 × Coca-Cola — ${order.money(500)}
Observação do pedido: Tocar campainha

🧾 Resumo
Subtotal: ${order.money(5898)}
Entrega: ${order.money(300)}
Total: ${order.money(6198)}

💳 Pagamento: Dinheiro, na entrega.
Troco para: ${order.money(10000)}

🍔 Fico no aguardo da confirmação e do preparo. Obrigado!`);
  assert.equal(order.config.whatsapp, '5512981440776');
  assert.equal(new URL(`https://wa.me/${order.config.whatsapp}?text=${encodeURIComponent(message)}`).searchParams.get('text'), message);
});
test('retirada com pagamento no local segue o modelo', () => {
  for (const [payment, label] of Object.entries({ pix: 'Pix', debit: 'Cartão de débito', credit: 'Cartão de crédito', cash: 'Dinheiro' })) {
    const message = order.message(cart, products, { customer: 'Teste', fulfillment: 'pickup', address: 'Endereço antigo', payment });
    assert.ok(message.startsWith('Olá, JG Hamburgueria! 👋\n\nGostaria de fazer este pedido:\n\n👤 Cliente: Teste\n🏪 Tipo: Retirada'));
    assert.ok(message.includes(`💳 Pagamento: ${label}, na retirada.`));
    assert.ok(!message.includes('Endereço:'));
    assert.ok(!message.includes('Troco para:'));
    assert.ok(message.includes(`Total: ${order.money(5898)}`));
    assert.ok(message.endsWith('🍔 Fico no aguardo da confirmação e do preparo. Obrigado!'));
  }
});
test('Pix confirmado usa os modelos de retirada e entrega sem expor ID do pedido', () => {
  for (const fulfillment of ['pickup', 'delivery']) {
    const details = { customer: 'Teste', fulfillment, address: 'Rua A, 10', neighborhood: 'Centro', payment: 'pix', confirmedPayment: { id: 'order-secreto', subtotal: 5898, delivery: fulfillment === 'delivery' ? 300 : 0, total: fulfillment === 'delivery' ? 6198 : 5898 } };
    const message = order.message(cart, products, details);
    assert.ok(message.startsWith('Olá, JG Hamburgueria! 👋\n\nGostaria de confirmar este pedido:'));
    assert.ok(message.includes(`\n${fulfillment === 'delivery' ? '🛵 Tipo: Entrega\n📍 Endereço: Rua A, 10, Bairro: Centro' : '🏪 Tipo: Retirada'}\n\n🛒 Itens`));
    assert.ok(message.includes('\n✅ Pagamento: Pix confirmado.\n'));
    assert.ok(!message.includes('order-secreto'));
    assert.ok(!message.includes('Mercado Pago'));
  }
});
