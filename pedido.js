/* Regras do pedido: valores em centavos; nenhum pagamento é processado aqui. */
(function (root) {
  const config = { whatsapp: "5512981440776", deliveryFee: 300 };
  const payments = { cash: "Dinheiro", debit: "Cartão de débito", credit: "Cartão de crédito", pix: "Pix" };
  const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const clean = value => String(value || "").replace(/[\r\n]+/g, " ").trim();
  function restore(value, products) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => item && products[item.id] && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99 && !seen.has(item.id) && seen.add(item.id))
      .map(item => ({ id: item.id, quantity: item.quantity, notes: products[item.id].allowsNotes && typeof item.notes === "string" ? item.notes.slice(0, 240) : "" }));
  }
  function totals(cart, products, fulfillment) {
    const subtotal = cart.reduce((sum, item) => sum + products[item.id].price * item.quantity, 0);
    const delivery = cart.length && fulfillment === "delivery" ? config.deliveryFee : 0;
    return { subtotal, delivery, total: subtotal + delivery };
  }
  function message(cart, products, details) {
    const amounts = totals(cart, products, details.fulfillment);
    const lines = ["Olá! Quero fazer um pedido na JG Hamburgueria.", "", `Cliente: ${clean(details.customer)}`, `Tipo: ${details.fulfillment === "delivery" ? "Entrega" : "Retirada"}`];
    if (details.fulfillment === "delivery") {
      lines.push(`Endereço: ${clean(details.address)}`, `Bairro: ${clean(details.neighborhood)}`);
      if (clean(details.reference)) lines.push(`Complemento/referência: ${clean(details.reference)}`);
    }
    lines.push("", "ITENS");
    cart.forEach(item => {
      const product = products[item.id];
      lines.push(`${item.quantity} × ${product.name} — ${money(product.price * item.quantity)}`);
      if (product.allowsNotes && clean(item.notes)) lines.push(`  Observação: ${clean(item.notes)}`);
    });
    lines.push("", `Subtotal: ${money(amounts.subtotal)}`, `Entrega: ${money(amounts.delivery)}`, `Total: ${money(amounts.total)}`, "", `Pagamento: ${payments[details.payment]}`);
    if (details.payment === "cash") lines.push(details.needsChange ? `Troco para: ${money(details.changeFor)}` : "Não preciso de troco.");
    if (clean(details.notes)) lines.push(`Observação do pedido: ${clean(details.notes)}`);
    lines.push("", "Aguardo a confirmação do pedido pela hamburgueria.");
    return lines.join("\n");
  }
  const api = { config, money, restore, totals, message };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JGOrder = api;
})(typeof window !== "undefined" ? window : this);
