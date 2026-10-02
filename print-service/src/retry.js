'use strict';

const logger = require('./logger');
const { loadConfig } = require('./config');
const { formatOrder } = require('./formatter');
const { createPrinter } = require('./printer');
const { PrintQueue, StateStore } = require('./print-queue');
const { HmlClient } = require('./hml-client');

const id = process.argv[2];
if (!id) { console.error('Uso: npm run queue:retry -- ID_DO_PEDIDO'); process.exit(1); }
const config = loadConfig();
if (config.mode === 'hml') {
  new HmlClient({ apiUrl: config.apiUrl, stateFile: config.stateFile, timeoutMs: config.timeoutMs }).retry(id)
    .then(() => logger.info('HML', `Job #${id} devolvido à fila HML`))
    .catch(error => { logger.error('HML', 'Não foi possível repetir o job', error.message); process.exitCode = 1; });
  return;
}
const queue = new PrintQueue({ store: new StateStore(config.stateFile), printer: createPrinter(config), formatter: order => formatOrder(order, config), logger, retryMs: config.retryMs });
if (!queue.retry(id)) { console.error('Pedido não encontrado ou não pode ser repetido.'); process.exit(1); }
queue.drainOnce().finally(() => queue.stop());
