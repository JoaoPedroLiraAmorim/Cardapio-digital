'use strict';

const { spawn } = require('node:child_process');

class PrintError extends Error {
  constructor(message, { uncertain = false } = {}) { super(message); this.name = 'PrintError'; this.uncertain = uncertain; }
}

function createPrinter(config, { spawnImpl = spawn, platform = process.platform } = {}) {
  async function printReceipt(text) {
    if (platform !== 'win32') throw new PrintError('A impressão física requer Windows.');
    const payload = `${String(text).replace(/\0/g, '')}${config.paperCut ? '\f' : ''}`;
    const command = "$ErrorActionPreference='Stop'; Get-Printer -Name $env:JG_PRINT_TARGET -ErrorAction Stop | Out-Null; $input | Out-Printer -Name $env:JG_PRINT_TARGET";
    return new Promise((resolve, reject) => {
      const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, JG_PRINT_TARGET: config.printerName },
      });
      let errorText = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new PrintError(`Tempo excedido ao enviar para ${config.printerName}. Verifique a fila do Windows antes de repetir.`, { uncertain: true }));
      }, config.timeoutMs);
      child.stderr?.on('data', chunk => { errorText += chunk.toString(); });
      child.once('error', error => { clearTimeout(timer); reject(new PrintError(`Não foi possível iniciar o spooler: ${error.message}`)); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve({ accepted: true });
        else reject(new PrintError(`Impressora indisponível ou erro do Windows (código ${code}): ${errorText.trim().slice(0, 240)}`));
      });
      child.stdin.end(payload, 'utf8');
    });
  }
  return { printReceipt };
}

module.exports = { createPrinter, PrintError };

