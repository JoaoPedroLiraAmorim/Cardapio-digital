'use strict';

const logger = require('./logger');
const { loadConfig } = require('./config');
const { formatOrder } = require('./formatter');
const { createPrinter } = require('./printer');
const { StateStore } = require('./print-queue');
const { HmlClient } = require('./hml-client');

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const config = loadConfig();
  const store = new StateStore(config.stateFile);
  const printer = createPrinter(config);
  logger.info('SERVICE', 'Serviço de impressão iniciado');
  logger.info('PRINTER', `Impressora configurada: ${config.printerName}`);
  if (config.mode === 'local') { logger.info('MODE', 'Modo local: nenhuma fila remota será consumida.'); return; }
  const client = new HmlClient({ config, store });
  await client.pair(); logger.info('MODE', `Pareado com HML como ${config.deviceName}`);
  let active = true;
  const shutdown = signal => { active = false; logger.info('SERVICE', `Encerrando por ${signal}`); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  while (active) {
    const state = store.load();
    if (state.inFlight) {
      try { await client.uncertain(state.inFlight); state.inFlight = null; store.save(); }
      catch (error) { logger.error('QUEUE', 'Não foi possível registrar impressão incerta', error.message); await pause(config.pollMs); continue; }
    }
    try {
      const claimed = await client.claim();
      if (!claimed) { await pause(config.pollMs); continue; }
      const job = claimed.job; state.inFlight = { id: job.id, leaseToken: job.leaseToken }; store.save();
      try { await printer.printReceipt(formatOrder(job.order, config)); await client.result(job.id, { status: 'printed', leaseToken: job.leaseToken }); logger.info('SUCCESS', `Pedido #${job.order.number} enviado ao spooler`); }
      catch (error) {
        const status = error.uncertain ? 'uncertain' : 'failed';
        await client.result(job.id, { status, leaseToken: job.leaseToken, error: String(error.message || error).slice(0, 240) });
        logger.error('PRINT', `Pedido #${job.order.number}: ${status}`, error.message);
      }
      state.inFlight = null; store.save();
    } catch (error) { logger.error('SERVICE', 'Falha ao consultar a fila HML', error.message); await pause(config.pollMs); }
  }
}

main().catch(error => { logger.error('SERVICE', 'Falha ao iniciar', error.message); process.exitCode = 1; });

