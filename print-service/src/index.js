'use strict';

const logger = require('./logger');
const { loadConfig } = require('./config');
const { formatOrder } = require('./formatter');
const { createPrinter } = require('./printer');
const { PrintQueue, StateStore } = require('./print-queue');
const { connectFirebase } = require('./firebase');
const { startOrderListener } = require('./order-listener');

async function main() {
  const config = loadConfig();
  const store = new StateStore(config.stateFile);
  const queue = new PrintQueue({ store, printer: createPrinter(config), formatter: order => formatOrder(order, config), logger, retryMs: config.retryMs });
  logger.info('SERVICE', 'Serviço de impressão iniciado');
  logger.info('PRINTER', `Impressora configurada: ${config.printerName}`);
  queue.start();
  let unsubscribe = null;
  if (!config.enableFirebase) {
    logger.info('MODE', 'Firebase desativado');
    logger.info('MODE', 'Executando somente impressão local');
  } else {
    const firebase = await connectFirebase(config.firebase);
    unsubscribe = await startOrderListener({ firebase, config: config.firebase, store, onOrder: order => {
      logger.info('ORDER', `Pedido #${order.id} recebido`); queue.enqueue(order);
    }, logger });
    logger.info('MODE', 'Firebase ativado; impressão automática em execução');
  }
  const shutdown = signal => { logger.info('SERVICE', `Encerrando por ${signal}`); unsubscribe?.(); queue.stop(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => { logger.error('SERVICE', 'Falha ao iniciar', error.message); process.exitCode = 1; });

