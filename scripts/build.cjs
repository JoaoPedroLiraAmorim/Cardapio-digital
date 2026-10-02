const fs = require('node:fs');
const path = require('node:path');
const assets = ['cardapio.css', 'cardapio.js', 'pedido.js', 'pix.js', 'logo-JG.webp'];
function build(root) {
  const output = path.join(root, 'public');
  const expected = new Set(['index.html', ...assets]);
  if (fs.existsSync(output)) {
    if (fs.lstatSync(output).isSymbolicLink()) throw new Error('A pasta public não pode ser um link.');
    for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !expected.has(entry.name)) {
        throw new Error(`Publicação bloqueada: arquivo inesperado em public/: ${entry.name}. Revise o arquivo antes de continuar.`);
      }
    }
  }
  fs.mkdirSync(output, { recursive: true });
  for (const file of assets) fs.copyFileSync(path.join(root, file), path.join(output, file));
  fs.copyFileSync(path.join(root, 'cardapio.html'), path.join(output, 'index.html'));
  console.log('Cardápio preparado em public/ para o Firebase Hosting.');
}
if (require.main === module) build(path.resolve(__dirname, '..'));
module.exports = { build };
