// Catálogo autorizado do servidor. Atualize junto com o HTML quando alterar preços.
export const catalog = Object.freeze(Object.fromEntries([
  ['item-1', 'Burg da casa', 2699], ['item-2', 'JG', 2599],
  ['item-3', 'PCQ Adulto', 1999], ['item-4', 'Burb tradicional', 2400],
  ['item-5', 'Pulled pork', 2999], ['item-6', 'PCQ Kids', 2000],
  ['item-7', 'Batata Frita (200 g)', 999], ['item-8', 'Coca-Cola', 500],
  ['item-9', 'Fanta Laranja', 500], ['item-10', 'Guaraná Antarctica', 500],
  ['item-11', 'Sprite', 500], ['item-12', 'Coca-Cola (Garrafinha)', 300],
].map(([id, name, priceCents], i) => [id, {name, priceCents, allowsNotes: i < 7}])));
export const deliveryFeeCents = 300;
