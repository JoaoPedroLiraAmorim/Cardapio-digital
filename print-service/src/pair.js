'use strict';
const logger = require('./logger');
const { loadConfig } = require('./config');
const { HmlClient } = require('./hml-client');

async function main() {
  const config = loadConfig();
  if (!['hml', 'production'].includes(config.mode)) throw new Error('Defina MODE=hml ou MODE=production antes do pareamento.');
  const secret = process.env.PRINT_PAIRING_SECRET;
  if (!secret) throw new Error('Defina PRINT_PAIRING_SECRET somente nesta sessão para parear.');
  const paired = await new HmlClient({ apiUrl: config.apiUrl, stateFile: config.stateFile, timeoutMs: config.timeoutMs }).pair({ pairingSecret: secret, name: config.deviceName });
  logger.info(config.mode.toUpperCase(), `Dispositivo pareado: ${paired.deviceId}`);
}
main().catch(error => { logger.error('HML', 'Falha no pareamento', error.message); process.exitCode = 1; });
