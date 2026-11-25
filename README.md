# Catálogo eletrônico com pedido pelo WhatsApp

Catálogo eletrônico para lojas de roupas, perfumarias, cosméticos e distribuidoras. O cliente monta o carrinho e preenche nome, telefone e entrega ou retirada. O pedido chega pronto no WhatsApp da loja. No Pix, o cliente escolhe entre **receber a chave cadastrada**, com QR Code e código copia e cola já preenchidos com o valor, ou **finalizar com o atendente**.

Inspirado no fluxo de papelarianovaponte.com.br, que usa vitrine, carrinho em gaveta lateral, regiões de entrega e envio pelo WhatsApp.

## Tecnologia

| Camada | Serviço | Por quê |
|---|---|---|
| Servidor/API | Cloudflare Workers | gratuito até 100 mil acessos/dia, sem servidor para manter |
| Banco de dados | Cloudflare D1 (SQLite) | gratuito até 5 GB |
| Fotos | Cloudflare R2 | gratuito até 10 GB, sem custo de saída |
| Telas | HTML + CSS + JavaScript puro | sem build, carrega rápido no celular |

## Estrutura do projeto

```
catalogo/
├── wrangler.toml              # configuração Cloudflare (D1, R2, arquivos estáticos)
├── package.json               # scripts: dev, db:local, db:remoto, deploy
├── .dev.vars                  # senha do admin para testes locais (não vai pro deploy)
├── migrations/
│   └── 0001_schema.sql        # criação do banco
├── seed.sql                   # dados de exemplo (opcional)
├── src/
│   ├── worker.js              # API: catálogo, pedidos, painel admin, upload de fotos
│   └── pix.js                 # gerador do Pix Copia e Cola (BR Code do Banco Central)
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
| `POST /api/admin/login` | `{senha}` → token válido por 12 h |
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

```bash
npx wrangler login
npx wrangler d1 create catalogo-db          # copie o database_id para o wrangler.toml
npx wrangler r2 bucket create catalogo-imagens
npm run db:remoto                            # cria as tabelas (sem dados de exemplo)
npx wrangler secret put ADMIN_PASSWORD       # senha do painel
npx wrangler secret put SESSION_SECRET       # texto aleatório longo
npm run deploy
```
Depois do deploy, acesse `/admin`. Em **Loja & Pix**, preencha o WhatsApp (55 + DDD + número), a chave Pix, o favorecido e a cidade. Cadastre as regiões de entrega em **Entrega** e depois os produtos. Para usar um domínio próprio, adicione-o ao Worker no painel da Cloudflare.

## Próximos passos possíveis

- Importar produtos de planilha ou de um ERP. O site de referência sincroniza os produtos do TagPlus.
- Cupom de desconto e frete grátis na primeira compra.
- Vários usuários no painel, com permissões.
