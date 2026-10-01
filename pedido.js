/* Regras do pedido: valores em centavos; nenhum pagamento é processado aqui. */
(function (root) {
  const config = { whatsapp: "5512981440776", deliveryFee: 300, pix: { enabled: true, apiBaseUrl: "https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev" } };
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
    const amounts = details.confirmedPayment || totals(cart, products, details.fulfillment);
    const delivery = details.fulfillment === "delivery";
    const pixConfirmed = details.payment === "pix" && details.confirmedPayment;
    const lines = [
      "Olá, JG Hamburgueria! 👋",
      "",
      pixConfirmed ? "Gostaria de confirmar este pedido:" : "Gostaria de fazer este pedido:",
      "",
      `👤 Cliente: ${clean(details.customer)}`,
      `${delivery ? "🛵" : "🏪"} Tipo: ${delivery ? "Entrega" : "Retirada"}`,
    ];
    if (delivery) {
      const address = [clean(details.address), clean(details.neighborhood) && `Bairro: ${clean(details.neighborhood)}`, clean(details.reference) && `Complemento/referência: ${clean(details.reference)}`].filter(Boolean).join(", ");
      lines.push(`📍 Endereço: ${address}`);
    }
    lines.push("", "🛒 Itens");
    cart.forEach(item => {
      const product = products[item.id];
      lines.push(`${item.quantity} × ${product.name} — ${money(product.price * item.quantity)}`);
      if (product.allowsNotes && clean(item.notes)) lines.push(`  Observação: ${clean(item.notes)}`);
    });
    if (clean(details.notes)) lines.push(`Observação do pedido: ${clean(details.notes)}`);
    lines.push("", "🧾 Resumo", `Subtotal: ${money(amounts.subtotal)}`, `Entrega: ${money(amounts.delivery)}`, `Total: ${money(amounts.total)}`, "");
    lines.push(pixConfirmed ? "✅ Pagamento: Pix confirmado." : `💳 Pagamento: ${payments[details.payment]}, na ${delivery ? "entrega" : "retirada"}.`);
    if (details.payment === "cash" && details.needsChange) lines.push(`Troco para: ${money(details.changeFor)}`);
    lines.push("", "🍔 Fico no aguardo da confirmação e do preparo. Obrigado!");
    return lines.join("\n");
  }
  const api = { config, money, restore, totals, message };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JGOrder = api;
})(typeof window !== "undefined" ? window : this);
