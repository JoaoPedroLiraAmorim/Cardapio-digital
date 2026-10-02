# Serviço de impressão — JG Hamburgueria

Serviço Node.js sem interface gráfica para imprimir comandas confirmadas no cardápio e enviadas ao Worker/D1 HML. Ele atende Pix, dinheiro e cartões: o clique em **Confirmar pedido e abrir WhatsApp** cria a comanda antes de abrir o WhatsApp. O Firebase Hosting não participa da fila. O serviço envia uma comanda RAW ESC/POS para a impressora instalada no Windows, preservando a largura fixa e enviando corte parcial para manter a comanda presa ao rolo; uma aceitação do spooler não confirma que o papel saiu fisicamente.

## Antes de começar

1. Instale o Node.js 22 ou mais recente.
2. Instale o driver Windows da Bematech/Elgin MP-4200 HS e conecte a impressora por USB.
3. Em **Configurações > Bluetooth e dispositivos > Impressoras e scanners**, copie o nome exato da impressora. Imprima antes uma página de teste pelo próprio Windows.
4. Nesta pasta, execute `npm install` e copie `.env.example` para `.env`. Nunca versione o `.env` nem o arquivo em `data/`.

Configure `PRINTER_NAME` com o nome copiado. `ENABLE_PAPER_CUT=true` envia o comando ESC/POS de corte parcial, mantendo a via presa ao rolo. `PRINT_COPIES=1` é o padrão; mude temporariamente para `2` para imprimir duas vias idênticas de cada comanda. Como a comunicação é RAW ESC/POS, essa quantidade é controlada pelo serviço, não por uma opção física da impressora ou pelo driver do Windows.

## Modo local

O modo local não acessa API alguma. Deixe `MODE=local` e execute:

```powershell
npm run print:test
```

Ele envia uma comanda fictícia ao spooler. Se houver timeout, não repita às cegas: confira a fila do Windows primeiro. O timeout vira estado incerto porque a impressão pode ter sido aceita pelo Windows.

## Homologação HML

Use somente depois de a migração e os secrets serem configurados no Worker HML. Defina:

```ini
MODE=hml
HML_API_URL=https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev
DEVICE_NAME=caixa-01
```

O administrador fornece o código temporário de pareamento por canal seguro. Não o coloque no `.env` ou no Git. Antes deste passo, o responsável pelo Worker habilita temporariamente `PRINT_PAIRING_ENABLED=true`; depois que o comando concluir, deve voltar a variável para `false`. Claims e resultados dos dispositivos já pareados continuam funcionando com o pareamento desligado. No PowerShell, apenas durante o pareamento:

```powershell
$env:PRINT_PAIRING_SECRET='codigo-temporario-recebido-por-canal-seguro'
npm run hml:pair
Remove-Item Env:PRINT_PAIRING_SECRET
npm start
```

O token devolvido pelo Worker é salvo em `STATE_FILE` e somente o hash dele fica no D1. Proteja a conta do Windows e as permissões dessa pasta; modos POSIX como `0600` não substituem ACLs do Windows. O serviço busca um job por vez. Para Pix online, a comanda só é criada após o pagamento ser aprovado e o cliente confirmar o pedido; o endpoint público de dinheiro/cartão rejeita Pix. Para os demais meios, ela é criada no clique de confirmação.

O navegador conserva por 30 minutos somente o hash do conteúdo e as credenciais aleatórias da confirmação. Isso permite que um reload repita a mesma chave sem guardar nome, endereço ou observações no armazenamento. Depois que o Worker recebe um resultado terminal, o serviço local remove do estado a cópia do pedido; jobs em andamento mantêm os dados apenas pelo tempo necessário para imprimir.

## Estados e recuperação

- `printed`: o Worker recebeu a confirmação de que o spooler aceitou o trabalho.
- `failed`: erro conhecido antes da aceitação; o Worker devolve o job à fila após o atraso configurado.
- `uncertain`: timeout, reinício durante a impressão ou perda de comunicação depois da aceitação. Não há reimpressão automática.

Para repetir deliberadamente um job `uncertain`, confira a comanda e a fila do Windows e então execute:

```powershell
npm run queue:retry -- ID_DO_JOB
```

Ao reiniciar, um job que estava em impressão é marcado `uncertain`, evitando duplicidade. Para desligar o serviço use `Ctrl+C`; ele não apaga o estado local.

## Teste ponta a ponta HML

1. Confirme primeiro `npm test` e `npm run print:test` em modo local.
2. Com o Worker HML publicado pelo responsável, aplique a migração, configure `PRINT_SERVICE_ENABLED=true`, `PRINT_RETRY_SECONDS`, `MAX_DAILY_PRINT_ORDERS` e `PRINT_PAIRING_SECRET` apenas nos secrets/vars do Worker.
3. Defina `PRINT_PAIRING_ENABLED=true`, pareie o PC e volte imediatamente para `PRINT_PAIRING_ENABLED=false`. Então inicie `npm start` em `MODE=hml`.
4. Confirme um pedido HML de cada forma de pagamento e verifique que o job aparece antes de abrir o WhatsApp; para Pix online, primeiro conclua o pagamento e então confirme o pedido.
5. Confirme no D1 que o job virou `printed`; reinicie o serviço e confirme que ele não é impresso novamente.

O serviço não publica Worker, Firebase ou produção. `MODE=production` é bloqueado intencionalmente até uma promoção futura.
