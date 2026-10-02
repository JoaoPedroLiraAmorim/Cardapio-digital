'use strict';

// A impressora recebe ESC/POS RAW em ASCII. Remove acentos e símbolos que não
// têm representação estável nos code pages das térmicas Windows.
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/[^\x20-\x7e]+/g, '?').trim();
const cents = value => Number.isInteger(value) ? value : Math.round(Number(value || 0) * 100);
const money = value => (cents(value) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const paymentLabels = Object.freeze({ cash: 'DINHEIRO', debit: 'CARTAO DE DEBITO', credit: 'CARTAO DE CREDITO', pix: 'PIX' });

function wrap(text, width) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width));
    } else if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function centered(text, width) {
  const value = clean(text).slice(0, width);
  return ' '.repeat(Math.max(0, Math.floor((width - value.length) / 2))) + value;
}

function linePair(left, right, width) {
  const a = clean(left); const b = clean(right);
  const spaces = width - a.length - b.length;
  return spaces > 0 ? `${a}${' '.repeat(spaces)}${b}` : `${a}\n${b.padStart(width)}`;
}

function formatOrder(order, { columns = 42, test = false } = {}) {
  if (!order || !clean(order.id || order.number) || !Array.isArray(order.items) || !order.items.length) throw new Error('Pedido inválido para impressão.');
  const created = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt || Date.now());
  const number = clean(order.number || order.id).slice(0, 16).toUpperCase();
  const lines = [centered('JG HAMBURGUERIA', columns), centered(test ? 'PEDIDO TESTE' : `PEDIDO #${number}`, columns), '-'.repeat(columns)];
  lines.push(`Data: ${created.toLocaleDateString('pt-BR')} ${created.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  if (order.customer) lines.push(...wrap(`Cliente: ${order.customer}`, columns));
  if (order.phone) lines.push(...wrap(`Telefone: ${order.phone}`, columns));
  const delivery = order.fulfillment === 'delivery';
  lines.push(`Tipo: ${delivery ? 'ENTREGA' : 'RETIRADA'}`);
  if (delivery) {
    const address = [order.address, order.neighborhood && `Bairro: ${order.neighborhood}`, order.reference].filter(Boolean).join(', ');
    lines.push(...wrap(`Endereco: ${address}`, columns));
  }
  lines.push('-'.repeat(columns));
  for (const item of order.items) {
    const quantity = Number(item.quantity) || 1;
    const unit = cents(item.priceCents ?? item.unitPriceCents ?? item.price);
    lines.push(...wrap(`${quantity}x ${item.name}`, columns));
    if (unit) lines.push(linePair(`  ${money(unit)} cada`, money(unit * quantity), columns));
    for (const extra of item.additions || item.extras || []) lines.push(...wrap(`  + ${typeof extra === 'string' ? extra : extra.name}`, columns));
    for (const removal of item.removals || []) lines.push(...wrap(`  - SEM ${typeof removal === 'string' ? removal : removal.name}`, columns));
    if (item.notes) lines.push(...wrap(`  OBS: ${item.notes}`, columns));
    lines.push('');
  }
  lines.push('-'.repeat(columns));
  const subtotal = cents(order.subtotalCents ?? order.subtotal);
  const deliveryFee = cents(order.deliveryCents ?? order.deliveryFeeCents ?? order.deliveryFee);
  const discount = cents(order.discountCents ?? order.discount);
  const calculated = order.items.reduce((sum, item) => sum + cents(item.priceCents ?? item.unitPriceCents ?? item.price) * (Number(item.quantity) || 1), 0);
  const total = cents(order.totalCents ?? order.amountCents ?? order.total) || calculated + deliveryFee - discount;
  if (subtotal || calculated) lines.push(linePair('Subtotal', money(subtotal || calculated), columns));
  lines.push(linePair('Entrega', money(deliveryFee), columns));
  if (discount) lines.push(linePair('Desconto', `- ${money(discount)}`, columns));
  lines.push(linePair('TOTAL', money(total), columns));
  lines.push('-'.repeat(columns));
  const paymentCode = clean(order.payment || '').toLowerCase();
  const payment = paymentLabels[paymentCode] || clean(order.paymentLabel || order.payment || 'Nao informado').toUpperCase();
  lines.push(...wrap(`Pagamento: ${payment}`, columns));
  if (order.paymentStatus) lines.push(...wrap(`Status pagamento: ${order.paymentStatus}`, columns));
  if (order.changeForCents) lines.push(`Troco para: ${money(order.changeForCents)}`);
  if (order.notes) lines.push('', ...wrap(`OBS GERAL: ${order.notes}`, columns));
  if (test) lines.push('', centered('TESTE DE IMPRESSAO', columns));
  lines.push('', centered('*** FIM DO PEDIDO ***', columns), '', '');
  return lines.join('\r\n');
}

module.exports = { formatOrder, money, wrap };

