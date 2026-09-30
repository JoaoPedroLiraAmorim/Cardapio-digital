# JG Hamburgueria — Cardápio digital

Cardápio com carrinho e finalização pelo WhatsApp. Os pagamentos são combinados com a hamburgueria.

## Publicação no Firebase Hosting

1. Instale as ferramentas com `npm install`.
2. Entre na conta Google com `npx firebase login`.
3. Este repositório já está vinculado ao projeto `jg-hamburgueria` no plano gratuito Spark. A conta conectada precisa ter acesso a esse projeto.
4. Publique com `npm run deploy`.

O deploy executa os testes e prepara automaticamente a pasta `public/`. O arquivo `cardapio.html` é publicado como `index.html`, permitindo acessar o cardápio diretamente na raiz do endereço.

O endereço do cardápio é https://jg-hamburgueria.web.app. O projeto pode ser administrado no [Firebase Console](https://console.firebase.google.com/project/jg-hamburgueria/overview). Não é necessário ativar faturamento, banco de dados ou Firebase App Hosting para este projeto.

## Atualizações

Edite `cardapio.html`, `cardapio.css`, `cardapio.js` ou `pedido.js` e execute `npm run deploy` novamente. Não edite os arquivos gerados em `public/`.

## Verificações locais

- `npm test`: verifica preços, totais, restauração do carrinho, mensagem do WhatsApp, navegação, contraste, cache e proteção do build.
- `npm run build`: gera os cinco arquivos necessários à publicação.

O telefone e a taxa de entrega ficam em `pedido.js`. Os preços em centavos ficam nos atributos `data-price` de `cardapio.html`.

O build aborta se encontrar arquivos inesperados em `public/`; revise esses arquivos antes de removê-los. A logo original `logo-JG.png` é preservada como fonte; o site usa `logo-JG.webp` otimizada. O endereço antigo da logo redireciona para o arquivo novo, mantendo compatibilidade com páginas antigas em cache.
