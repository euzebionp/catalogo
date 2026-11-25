# Catálogo eletrônico com pedido pelo WhatsApp

Catálogo eletrônico para lojas de roupas, perfumarias, cosméticos e distribuidoras. O cliente monta o carrinho e preenche nome, telefone e entrega ou retirada. O pedido chega pronto no WhatsApp da loja. No Pix, o cliente escolhe entre **receber a chave cadastrada**, com QR Code e código copia e cola já preenchidos com o valor, ou **finalizar com o atendente**.

Inspirado no fluxo de papelarianovaponte.com.br, que usa vitrine, carrinho em gaveta lateral, regiões de entrega e envio pelo WhatsApp.

## Tecnologia

| Camada | Serviço | Por quê |
|---|---|---|
| Servidor/API | Cloudflare Workers | gratuito até 100 mil acessos/dia, sem servidor para manter |
| Banco de dados | Cloudflare D1 (SQLite) | gratuito até 5 GB |
| Fotos | Cloudflare KV (ou R2) | gratuito, sem cartão |
| Telas | HTML + CSS + JavaScript puro | sem build, carrega rápido no celular |

## Estrutura do projeto

```
catalogo/
├── wrangler.toml              # configuração Cloudflare (D1, R2, arquivos estáticos)
├── package.json               # scripts: dev, db:local, db:remoto, deploy
├── .dev.vars                  # senha do admin para testes locais (não vai pro deploy)
├── migrations/
│   ├── 0001_schema.sql        # criação do banco
│   ├── 0002_integracao.sql    # planilha e TagPlus
│   └── 0003_usuarios.sql      # usuários, auditoria e freio de login
├── seed.sql                   # dados de exemplo (opcional)
├── src/
│   ├── worker.js              # API: catálogo, pedidos, painel admin, upload de fotos
│   ├── pix.js                 # gerador do Pix Copia e Cola (BR Code do Banco Central)
│   ├── usuarios.js            # papéis, permissões, senhas e auditoria
│   ├── importar.js            # importação da planilha
│   └── tagplus/               # cliente da API, sincronização e mapeamento de campos
└── public/                    # arquivos servidos ao navegador
    ├── index.html             # vitrine
    ├── app.js                 # vitrine: busca, categorias, produto, carrinho, envio
    ├── style.css              # visual (cores vêm da configuração da loja)
    ├── vendor/qrcode.js       # gerador de QR Code (MIT)
    └── admin/
        ├── index.html         # painel do administrador (/admin)
        ├── admin.js           # pedidos, produtos, fotos, categorias, entrega, loja & Pix
        └── admin.css
```

## Banco de dados

Valores em dinheiro ficam em **centavos** (inteiro). Assim, R$ 129,90 é gravado como `12990`.

```
loja_config (1 linha) ── nome, cores, logo, WhatsApp, horário, avisos, pedido mínimo,
                          Pix (tipo, chave, titular, banco, cidade, modo), cartão, dinheiro

categorias 1───N produtos 1───N produto_imagens    (chave do arquivo no R2, ordem)
                         1───N produto_variacoes   (tamanho/cor/volume/tom/caixa: preço e estoque próprios)
                         1───N produto_specs       (rótulo: valor)

regioes_entrega          (nome, taxa, grátis acima de, prazo)

clientes 1───N pedidos 1───N pedido_itens          (cópia de nome, variação e preço do momento)
                    └── regioes_entrega
```

| Tabela | Campos principais |
|---|---|
| `loja_config` | `nome`, `slogan`, `segmento`, `logo_key`, `cor_primaria`, `cor_destaque`, `whatsapp`, `instagram`, `endereco_loja`, `horario`, `aviso_topo`, `pedido_minimo`, `permite_entrega`, `permite_retirada`, `pix_ativo`, `pix_tipo`, `pix_chave`, `pix_titular`, `pix_banco`, `pix_cidade`, `pix_modo` (`chave` / `atendente` / `ambos`), `aceita_cartao`, `aceita_dinheiro` |
| `categorias` | `nome`, `slug`, `ordem`, `ativo` |
| `produtos` | `categoria_id`, `nome`, `slug`, `descricao`, `marca`, `sku`, `preco`, `preco_antigo`, `unidade`, `qtd_minima`, `multiplo`, `estoque` (vazio = não controla), `destaque`, `ativo` |
| `produto_imagens` | `produto_id`, `r2_key` (ou URL externa), `ordem` |
| `produto_variacoes` | `produto_id`, `nome`, `sku`, `preco` (vazio = preço do produto), `estoque`, `ordem`, `ativo` |
| `produto_specs` | `produto_id`, `rotulo`, `valor`, `ordem` |
| `regioes_entrega` | `nome`, `taxa`, `gratis_acima`, `prazo`, `ordem`, `ativo` |
| `clientes` | `nome`, `telefone` (único), `endereco`, `referencia` |
| `pedidos` | `codigo`, `cliente_id`, `cliente_nome`, `cliente_telefone`, `recebimento` (`entrega` / `retirada`), `regiao_id`, `endereco`, `referencia`, `pagamento` (`pix_chave` / `pix_atendente` / `cartao` / `dinheiro`), `troco_para`, `observacoes`, `subtotal`, `taxa_entrega`, `total`, `status` (`novo` → `confirmado` → `pago` → `preparando` → `saiu` → `entregue`, ou `cancelado`) |
| `pedido_itens` | `pedido_id`, `produto_id`, `variacao_id`, `nome`, `variacao`, `unidade`, `preco_unit`, `quantidade`, `total` |

O DDL completo está em `migrations/0001_schema.sql`.

## Fluxo do pedido

1. O cliente navega, busca ou filtra por categoria e abre o produto, onde vê as fotos, as especificações e as variações.
2. O cliente adiciona ao carrinho. O carrinho fica guardado no navegador, mesmo que ele feche a página.
3. No carrinho, ele escolhe **entrega** (região e endereço) ou **retirada**, informa nome e WhatsApp e escolhe a forma de pagamento.
4. `POST /api/pedidos`: **o servidor recalcula preços, taxa, pedido mínimo e estoque pelo banco**, ignorando os valores que vêm do navegador. Depois grava o cliente e o pedido e dá baixa no estoque.
5. O WhatsApp da loja abre com a mensagem pronta: número do pedido, cliente, itens, totais, endereço, pagamento e observações.
6. Se o cliente escolheu **Pix pela chave**, a tela mostra o QR Code, o código copia e cola com valor e número do pedido, a chave cadastrada e o favorecido. Se escolheu **Pix com atendente**, a mensagem avisa a loja para mandar os dados de pagamento.
7. No painel, a loja acompanha o status do pedido. Um pedido cancelado devolve os itens ao estoque.

## API

| Rota | Uso |
|---|---|
| `GET /api/loja` | dados públicos da loja, categorias e regiões |
| `GET /api/produtos` | produtos ativos com fotos, variações e especificações |
| `POST /api/pedidos` | cria o pedido e devolve `codigo`, `mensagem`, `whatsapp_url` e `pix` |
| `GET /img/:chave` | fotos do R2 |
| `POST /api/admin/login` | `{email, senha}` → token válido por 12 h |
| `GET /api/admin/eu`, `POST /api/admin/minha-senha` | usuário logado e permissões; troca da própria senha |
| `GET/POST/PUT /api/admin/usuarios[/id]`, `GET /api/admin/auditoria` | gestão de usuários e registro de ações |
| `GET/POST/PUT/DELETE /api/admin/produtos[/id]` | cadastro de produtos (fotos, variações e especificações em uma chamada) |
| `POST /api/admin/upload` | envio de foto (campo `arquivo`, até 5 MB; o painel reduz para 1600 px antes) |
| `GET/PUT /api/admin/config` | dados da loja e do Pix |
| `/api/admin/categorias`, `/api/admin/regioes` | cadastro simples |
| `GET /api/admin/pedidos[?status=]`, `GET/PUT /api/admin/pedidos/:id` | lista, detalhe e mudança de status |

## Rodar no seu computador

```bash
npm install
npm run db:local        # cria o banco local com dados de exemplo
npm run dev             # http://localhost:8787  e  http://localhost:8787/admin
```
A senha local do painel está em `.dev.vars` (`troque-esta-senha`).

## Publicar (Cloudflare)

Já estão criados na conta Cloudflare:
- banco D1 `catalogo-db` (`d86d0a84-5548-468f-a2ee-0d3858c076f6`), com as tabelas já aplicadas;
- KV `catalogo-imagens` (`635962451a234bd3b09abab68b2b338b`), que guarda as fotos.

O deploy é feito pela integração com o GitHub. Cada `git push` na branch `main` publica de novo.

1. No painel da Cloudflare, abra **Workers & Pages → Create → Import a repository** e escolha `euzebionp/catalogo`.
2. Deixe o nome do projeto como `catalogo`, o comando de build vazio e o comando de deploy como `npx wrangler deploy`.
3. Depois do primeiro deploy, abra **Settings → Variables and Secrets** e adicione dois **Secrets**:
   - `ADMIN_PASSWORD`, com a senha do painel;
   - `SESSION_SECRET`, com um texto aleatório longo.
4. Acesse `https://catalogo.<sua-conta>.workers.dev/admin`. Em **Loja & Pix**, preencha o WhatsApp, a chave Pix, o favorecido e a cidade. Depois cadastre as regiões de entrega e os produtos.

Se preferir usar o terminal: `npx wrangler login`, depois `npx wrangler secret put ADMIN_PASSWORD` e `npm run deploy`.
Migrações futuras: `npm run db:remoto`.

### Fotos: KV ou R2
O projeto usa o KV porque ele é gratuito e não pede cartão. O plano grátis tem 1 GB e mil gravações por dia, o que basta para um catálogo. Se você ativar o R2 no painel, troque o bloco `[[kv_namespaces]]` pelo `[[r2_buckets]]` comentado no `wrangler.toml`. O código aceita os dois.

## Usuários e permissões

Cada pessoa entra no painel com o próprio e-mail e senha. As senhas são guardadas com PBKDF2-SHA256.

| Papel | O que pode |
|---|---|
| Administrador master | Tudo, inclusive criar, alterar e desativar outros masters |
| Dono | Tudo da loja (Loja & Pix, Integração, Usuários), menos contas master |
| Gerente | Pedidos, notas, produtos (com custo), importação, categorias e entrega |
| Vendedor | Pedidos (ver e mudar status) e consulta de produtos, sem custo |

- **Primeiro acesso:** entre em `/admin` com o e-mail em branco e a senha mestra (`ADMIN_PASSWORD`). O painel pede para criar o Administrador master. A partir daí a senha mestra deixa de funcionar.
- Usuário novo recebe uma senha provisória e é obrigado a trocá-la no primeiro acesso.
- Desativar o usuário, mudar o papel dele ou redefinir a senha derruba as sessões abertas na hora.
- O sistema não deixa ficar sem nenhum Administrador master ativo.
- 5 senhas erradas no mesmo e-mail bloqueiam esse e-mail por 15 minutos. O bloqueio por IP só acontece com 30 erros, para não travar a loja inteira num Wi-Fi compartilhado.
- O registro de ações (aba Usuários) guarda login, mudanças de preço e estoque, status de pedido, configurações, usuários e integração.
- **Se perder o acesso de todos os masters:** desative-os direto no D1 (`UPDATE usuarios SET ativo = 0 WHERE papel = 'master'`). A senha mestra volta a funcionar para criar um novo master.

## Importar produtos por planilha

1. Baixe o modelo no painel (Produtos → Baixar modelo) ou em `/modelo-importacao-catalogo.xlsx`.
2. Preencha `Parametros`, `NCM` e `Formacao_Preco` no Excel ou LibreOffice e **salve**. Salvar é o que grava os valores calculados.
3. No painel, vá em Produtos → Importar planilha. O sistema lê a aba `Importacao`:
   - linhas com o mesmo `codigo_produto` viram um produto com variações;
   - reimportar atualiza os produtos, sem duplicar.

A planilha calcula, a partir de MG: a alíquota da nota de compra (12% de qualquer estado, 4% para importados), a antecipação do ICMS do Simples Nacional (fórmula da SEF/MG), o ICMS-ST com MVA ajustada, o crédito de ICMS no regime normal, o DAS efetivo do Anexo I e o preço sugerido com margem e despesas.

## Integração com o TagPlus

O TagPlus é a fonte de produtos, preços, estoque e notas fiscais. Arquivos: `src/tagplus/cliente.js` (OAuth2 e chamadas), `src/tagplus/sync.js` (fila, sincronização, pedidos e notas) e `src/tagplus/mapa.js` (nomes de campos).

| Fluxo | Como acontece |
|---|---|
| Produtos e estoque → catálogo | Webhook do TagPlus em tempo real, mais uma busca a cada 10 min (`since`) |
| Pedido → TagPlus | Ao marcar "Confirmado" no painel, ou pelo botão no pedido. Cria o cliente se ele não existir |
| Nota fiscal | Botão "Emitir NFC-e/NF-e" no pedido. O status volta pelo webhook e pela fila |
| Falhas | Fila com nova tentativa (2, 4, 8… min). Erros e registro na aba Integração |

Para ativar:
1. Em [developers.tagplus.com.br](https://developers.tagplus.com.br/), cadastre um app. A URL de retorno é `https://<seu-dominio>/api/tagplus/callback`.
2. Na Cloudflare (Worker → Settings → Variables and Secrets), crie os segredos `TAGPLUS_CLIENT_ID`, `TAGPLUS_CLIENT_SECRET` e `TAGPLUS_WEBHOOK_SECRET`.
3. No painel → Integração → Conectar ao TagPlus.
4. No TagPlus → Extras → API → Webhook, cadastre `https://<seu-dominio>/api/tagplus/webhook` com o mesmo `X-Hub-Secret` e marque os eventos de produto, estoque, pedido, NF-e e NFC-e.
5. Em Integração → Diagnóstico, confira o JSON real de `produtos`, `pedidos` e `nfces` e ajuste o que estiver marcado `CONFIRMAR` em `src/tagplus/mapa.js`.

O usuário do TagPlus que autoriza o app precisa da permissão "Modificar o Valor Unitário nas vendas". A emissão de NFC-e exige CSC, série e certificado configurados no próprio TagPlus.

## Próximos passos possíveis

- Cupom de desconto e frete grátis na primeira compra.
