'use strict';

const logger = require('./logger');
const { loadConfig } = require('./config');
const { formatOrder } = require('./formatter');
const { createPrinter } = require('./printer');
const { PrintQueue, StateStore } = require('./print-queue');
const { HmlClient } = require('./hml-client');

async function runHml({ client, store, printer, config }) {
  const state = store.load();
  let sanitized = false;
  for (const job of state.jobs) {
    if (['printed', 'failed', 'uncertain'].includes(job.status) && job.order) { delete job.order; sanitized = true; }
  }
  if (sanitized) store.save();
  for (const job of state.jobs.filter(job => job.status === 'uncertain' && job.leaseToken && !job.reportedUncertain)) {
    try {
      await client.result(job.id, { status: 'uncertain', leaseToken: job.leaseToken, error: 'Serviço reiniciado antes da confirmação do spooler' });
      job.reportedUncertain = true; delete job.leaseToken; store.save();
    }
    catch (error) { logger.error('HML', `Não foi possível marcar #${job.id} como incerto`, error.message); }
  }
  const claimed = await client.claim();
  if (!claimed?.job) return false;
  const { id, leaseToken, order } = claimed.job;
  const local = store.load();
  let record = local.jobs.find(job => job.id === id);
  if (record && !['uncertain', 'failed'].includes(record.status)) throw new Error(`Job remoto #${id} já existe no estado local.`);
  if (record) Object.assign(record, { leaseToken, order, status: 'printing', attempts: claimed.job.attempt, reportedUncertain: false, lastError: '' });
  else { record = { id, leaseToken, order, status: 'printing', createdAt: Date.now(), attempts: claimed.job.attempt }; local.jobs.push(record); }
  store.save();
  logger.info('PRINT', `Enviando pedido #${order.number || id} ao spooler`);
  let spoolerAccepted = false;
  try {
    await printer.printReceipt(formatOrder(order, config));
    spoolerAccepted = true;
    await client.result(id, { status: 'printed', leaseToken });
    record.status = 'printed'; record.printedAt = Date.now(); delete record.order; delete record.leaseToken;
    logger.info('SUCCESS', `Pedido #${order.number || id} aceito pelo spooler e confirmado no HML`);
  } catch (error) {
    const uncertain = Boolean(error.uncertain) || spoolerAccepted;
    record.status = uncertain ? 'uncertain' : 'failed'; record.lastError = String(error.message || error).slice(0, 240); delete record.order;
    try {
      await client.result(id, { status: uncertain ? 'uncertain' : 'failed', leaseToken, error: record.lastError });
      record.reportedUncertain = uncertain; delete record.leaseToken;
    }
    catch (resultError) { logger.error('HML', `Resultado de #${id} não confirmado; mantido como incerto`, resultError.message); record.status = 'uncertain'; }
    logger.error('PRINT', uncertain ? `Pedido #${id} está incerto e não será reimpresso automaticamente` : `Falha ao imprimir #${id}`, record.lastError);
  } finally { store.save(); }
  return true;
}

async function main() {
  const config = loadConfig();
  const store = new StateStore(config.stateFile);
  const printer = createPrinter(config);
  const queue = new PrintQueue({ store, printer, formatter: order => formatOrder(order, config), logger, retryMs: config.retryMs });
  logger.info('SERVICE', 'Serviço de impressão iniciado');
  logger.info('PRINTER', `Impressora configurada: ${config.printerName} (${config.copies} via${config.copies === 1 ? '' : 's'} por comanda)`);
  let timer = null;
  if (config.mode === 'local') {
    queue.start(); logger.info('MODE', 'Modo local: nenhuma API será acessada. Use npm run print:test para diagnóstico.');
  } else {
    const client = new HmlClient({ apiUrl: config.hml.apiUrl, stateFile: config.stateFile, timeoutMs: config.timeoutMs });
    let polling = false;
    const poll = async () => { if (polling) return; polling = true; try { await runHml({ client, store, printer, config }); } catch (error) { logger.error('HML', 'Fila HML indisponível', error.message); } finally { polling = false; } };
    await poll(); timer = setInterval(poll, Math.min(config.retryMs, 5000));
    logger.info('MODE', 'Modo HML: fila autenticada em execução. Pedidos confirmados e Pix aprovados são recebidos.');
  }
  const shutdown = signal => { logger.info('SERVICE', `Encerrando por ${signal}`); if (timer) clearInterval(timer); queue.stop(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) main().catch(error => { logger.error('SERVICE', 'Falha ao iniciar', error.message); process.exitCode = 1; });

module.exports = { main, runHml };
