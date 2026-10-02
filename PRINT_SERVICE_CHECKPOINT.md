# Checkpoint: serviço de impressão HML

Data: 2026-10-01

## Objetivo confirmado

Implementar e validar primeiro no HML o fluxo:

`Pix aprovado no cardápio HML -> Worker/D1 HML -> fila protegida -> serviço Node no PC -> spooler do Windows -> MP-4200 HS`

A `main` e produção não devem ser alteradas antes da validação física. O comando `npm run print:test` deve continuar existindo, mas a entrega de homologação deve iniciar em modo HML e processar pedidos reais de teste.

## Constatação de arquitetura

O Firebase atual serve somente o Hosting do cardápio. Os pedidos e a confirmação Pix ficam no Cloudflare Worker + D1. Portanto, o fluxo real HML deve consumir uma fila autenticada no Worker/D1, sem criar um Firestore paralelo. A configuração final escolhida deve usar `MODE=local|hml|production`:

- `local`: sem rede, apenas diagnóstico da impressora;
- `hml`: Worker `jg-cardapio-api-hml` e cobranças reais de teste já usadas no HML;
- `production`: reservado e bloqueado até promoção posterior.

## Branches e commits

- `hml`: commit `085ae64` consolida a migração Mercado Pago Orders e os arquivos do HML que já estavam publicados/testados.
- `feature/print-service`: criada a partir do HML e atualizada até `085ae64`. Todo o trabalho de impressão deve continuar nela.
- Commits anteriores relevantes no HML: `15ef581` (mensagens WhatsApp) e `6197a09` (botão Pix sem piscar).

## Implementado neste checkpoint

### Worker/D1 (ainda não publicar)

- Tabelas `print_devices` e `print_jobs` em `server/schema.sql`.
- Migração incremental em `server/migrations/0001_print_service.sql`.
- Enfileiramento idempotente por `order_id` somente quando o pagamento oficial chega a `approved`.
- Rotas autenticadas em desenvolvimento:
  - `POST /api/print/pair`
  - `POST /api/print/jobs/claim`
  - `POST /api/print/jobs/:id/result`
  - `POST /api/print/jobs/:id/retry`
- Token de dispositivo salvo apenas como SHA-256 no D1.
- Claim atômico e fila serial.
- Resultado `failed` volta à fila com atraso; `uncertain` exige decisão manual para impedir duplicidade.
- O agendamento transforma leases vencidos em `uncertain`, evitando reimpressão automática perigosa.

### Serviço local (parcial)

Foi criada a pasta `print-service/` com:

- formatação de comanda 80 mm;
- impressão pelo spooler do Windows usando PowerShell `Out-Printer`;
- nome da impressora por configuração;
- form feed opcional para tentar corte via driver;
- fila/estado JSON local com gravação atômica;
- proteção local contra duplicidade;
- estado `uncertain` após timeout/crash, sem retry automático;
- `npm run print:test` e `scripts/start.bat` iniciados.

## Estado de validação

- `node --test --test-isolation=none tests/worker.test.mjs`: 17/17 testes existentes passaram depois das alterações.
- As novas rotas de impressão ainda não possuem testes automatizados específicos.
- O pacote `print-service` ainda não teve dependências instaladas nem testes criados.
- Nenhuma migração D1 remota foi aplicada.
- Nenhum secret de pareamento foi configurado.
- O Worker com as rotas novas não foi publicado.
- Nenhuma impressão física foi executada ou alegada.

## Pendências obrigatórias na retomada

1. Substituir a configuração inicial `ENABLE_FIREBASE` do pacote por `MODE=local|hml|production`.
2. Remover `firebase-admin`, `src/firebase.js` e `src/order-listener.js`, pois o pivot confirmado usa a fonte real Worker/D1 HML.
3. Criar `src/hml-client.js` com pair/claim/result/retry, timeout, backoff e token de dispositivo persistido fora do Git.
4. Ligar `src/index.js` ao HML em `MODE=hml` e garantir uma impressão por vez.
5. Fazer o resultado local atualizar a fila remota: `printed`, `failed` ou `uncertain`.
6. Adicionar testes das quatro rotas Worker: autenticação, aprovação enfileira uma vez, claim concorrente, retry e incerteza.
7. Adicionar testes do pacote: formatador, vários itens/adicionais/remoções, entrega/retirada, Pix/dinheiro, falha, persistência e deduplicação.
8. Revisar `printer.js` no Windows e confirmar se `Out-Printer` preserva largura/acentos no driver MP-4200 HS. Se necessário, usar RAW/ESC-POS como fallback, sem acoplar ao Worker.
9. Atualizar `.env.example` e escrever `print-service/README.md` com passo a passo completo.
10. Rodar `npm test`, `npm run test:integration`, build e testes do `print-service`.
11. Somente depois: aplicar `server/migrations/0001_print_service.sql` ao D1 HML remoto.
12. Gerar `PRINT_PAIRING_SECRET` aleatório como secret do Worker; nunca versionar nem enviar no chat.
13. Configurar `PRINT_SERVICE_ENABLED=true` e `PRINT_RETRY_SECONDS=60` apenas no Wrangler HML local ignorado.
14. Publicar somente o Worker HML, parear o PC e executar teste ponta a ponta com um novo Pix real controlado.
15. Confirmar no D1 que o job terminou `printed` e reiniciar o serviço para provar que não reimprime.

## Regra de impressão atual

Somente Pix validado oficialmente como `approved` é enfileirado. Dinheiro/cartão atualmente seguem para WhatsApp e não possuem confirmação no backend; imprimir esses pedidos automaticamente antes da hamburgueria aceitar seria inseguro. Esse fluxo deve ser projetado separadamente depois do marco Pix, sem tratar o clique do WhatsApp como confirmação.

## Comandos de retomada

```powershell
cd "C:\Users\JOAO PEDRO\Documents\cardapio-digital\.worktrees\print-service"
git status
git pull --ff-only origin feature/print-service
Get-Content PRINT_SERVICE_CHECKPOINT.md
```

Em outro computador, clonar e executar:

```powershell
git clone https://github.com/JoaoPedroLiraAmorim/Cardapio-digital.git
cd Cardapio-digital
git switch feature/print-service
Get-Content PRINT_SERVICE_CHECKPOINT.md
```

## Segurança e limites

- Não versionar `.env`, token do dispositivo, pairing secret, credenciais Mercado Pago ou arquivo de service account.
- Sucesso do spooler significa aceitação pelo Windows, não comprova papel fisicamente impresso.
- Um crash exatamente entre o spooler aceitar e o ACK remoto é ambíguo; por isso deve virar `uncertain`, nunca retry automático.
- Não publicar este WIP no Worker até concluir os testes novos.
