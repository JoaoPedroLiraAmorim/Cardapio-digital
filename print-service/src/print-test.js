'use strict';

const logger = require('./logger');
const { loadConfig } = require('./config');
const { formatOrder } = require('./formatter');
const { createPrinter } = require('./printer');

async function main() {
  const config = loadConfig();
  if (config.mode !== 'local') throw new Error('npm run print:test só pode ser executado com MODE=local.');
  const order = {
    id: 'TESTE-001', number: 'TESTE', createdAt: new Date(), customer: 'Cliente Teste', fulfillment: 'pickup',
    items: [
      { name: 'X-Bacon', quantity: 1, priceCents: 3000, notes: 'Sem cebola', additions: ['Bacon'] },
      { name: 'Coca-Cola 350ml', quantity: 1, priceCents: 500 },
    ],
    subtotalCents: 3500, deliveryCents: 0, totalCents: 3500, payment: 'PIX', paymentStatus: 'TESTE',
  };
  logger.info('PRINT', `Enviando comanda de teste para ${config.printerName}`);
  await createPrinter(config).printReceipt(formatOrder(order, { columns: config.columns, test: true }));
  logger.info('SUCCESS', 'Comanda de teste aceita pelo spooler do Windows');
}

main().catch(error => { logger.error('ERROR', 'Falha na impressão de teste', error.message); process.exitCode = 1; });
