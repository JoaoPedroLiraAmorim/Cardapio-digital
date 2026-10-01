'use strict';

const { spawn } = require('node:child_process');

class PrintError extends Error {
  constructor(message, { uncertain = false } = {}) { super(message); this.name = 'PrintError'; this.uncertain = uncertain; }
}

// Out-Printer reformats text according to the Windows driver page settings. It
// caused wrapped lines and ignored the cut form-feed on the MP-4200. Sending a
// RAW ESC/POS document keeps the receipt's fixed-width layout and cut command.
const rawPowerShell = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class JgRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA { public string pDocName; public string pOutputFile; public string pDatatype; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA docInfo);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Send(string printer, byte[] bytes) {
    IntPtr handle; Check(OpenPrinter(printer, out handle, IntPtr.Zero));
    try {
      var doc = new DOCINFOA { pDocName = "JG Hamburgueria", pDatatype = "RAW" };
      if (StartDocPrinter(handle, 1, doc) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { Check(StartPagePrinter(handle)); try { int written; Check(WritePrinter(handle, bytes, bytes.Length, out written)); if (written != bytes.Length) throw new Exception("Dados incompletos enviados à impressora."); } finally { Check(EndPagePrinter(handle)); } }
      finally { Check(EndDocPrinter(handle)); }
    } finally { Check(ClosePrinter(handle)); }
  }
}
'@
[JgRawPrinter]::Send($env:JG_PRINT_TARGET, [Convert]::FromBase64String($env:JG_PRINT_DATA))
`;

const encodedCommand = Buffer.from(rawPowerShell, 'utf16le').toString('base64');

function rawReceipt(text, paperCut) {
  const printable = String(text).replace(/[^\x20-\x7e\r\n]/g, '?').replace(/\r?\n/g, '\r\n');
  // GS V 1: corte parcial, mantendo a comanda presa ao rolo.
  const end = paperCut ? '\n\n\n\x1d\x56\x01' : '\n\n\n';
  return Buffer.concat([Buffer.from('\x1b\x40\x1b\x61\x00', 'binary'), Buffer.from(printable, 'ascii'), Buffer.from(end, 'binary')]);
}

function createPrinter(config, { spawnImpl = spawn, platform = process.platform } = {}) {
  async function printReceipt(text) {
    if (platform !== 'win32') throw new PrintError('A impressão física requer Windows.');
    const payload = rawReceipt(text, config.paperCut);
    return new Promise((resolve, reject) => {
      const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, JG_PRINT_TARGET: config.printerName, JG_PRINT_DATA: payload.toString('base64') },
      });
      let errorText = '';
      const timer = setTimeout(() => { child.kill(); reject(new PrintError(`Tempo excedido ao enviar para ${config.printerName}. Verifique a fila do Windows antes de repetir.`, { uncertain: true })); }, config.timeoutMs);
      child.stderr?.on('data', chunk => { errorText += chunk.toString(); });
      child.once('error', error => { clearTimeout(timer); reject(new PrintError(`Não foi possível iniciar o spooler: ${error.message}`)); });
      child.once('close', code => { clearTimeout(timer); if (code === 0) resolve({ accepted: true }); else reject(new PrintError(`Impressora indisponível ou erro do Windows (código ${code}): ${errorText.trim().slice(0, 240)}`)); });
    });
  }
  return { printReceipt };
}

module.exports = { createPrinter, PrintError, rawReceipt };
