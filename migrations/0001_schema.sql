-- =====================================================================
-- Catálogo eletrônico — banco de dados (Cloudflare D1 / SQLite)
-- Valores em centavos (INTEGER) para evitar erro de arredondamento.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Configuração da loja (linha única, id = 1)
-- ---------------------------------------------------------------------
CREATE TABLE loja_config (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  nome               TEXT    NOT NULL DEFAULT 'Minha Loja',
  slogan             TEXT,
  segmento           TEXT    NOT NULL DEFAULT 'roupas',  -- roupas | perfumaria | cosmeticos | distribuidora | misto
  logo_key           TEXT,                               -- chave da imagem no R2
  cor_primaria       TEXT    NOT NULL DEFAULT '#3b3fb6',
  cor_destaque       TEXT    NOT NULL DEFAULT '#f39c12',
  whatsapp           TEXT    NOT NULL DEFAULT '',        -- só dígitos com DDI: 5534999999999
  instagram          TEXT,
  endereco_loja      TEXT,
  horario            TEXT,                               -- texto livre exibido no carrinho
  aviso_topo         TEXT,                               -- faixa de avisos (separar por |)
  pedido_minimo      INTEGER NOT NULL DEFAULT 0,         -- centavos, só para entrega
  permite_retirada   INTEGER NOT NULL DEFAULT 1,
  permite_entrega    INTEGER NOT NULL DEFAULT 1,
  -- Pix
  pix_ativo          INTEGER NOT NULL DEFAULT 1,
  pix_tipo           TEXT,                               -- cpf | cnpj | email | telefone | aleatoria
  pix_chave          TEXT,
  pix_titular        TEXT,
  pix_banco          TEXT,
  pix_cidade         TEXT,                               -- usada no Pix Copia e Cola
  pix_modo           TEXT    NOT NULL DEFAULT 'ambos'    -- chave | atendente | ambos
                     CHECK (pix_modo IN ('chave','atendente','ambos')),
  aceita_cartao      INTEGER NOT NULL DEFAULT 1,         -- cartão na entrega
  aceita_dinheiro    INTEGER NOT NULL DEFAULT 1,
  atualizado_em      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
CREATE TABLE categorias (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT    NOT NULL,
  slug      TEXT    NOT NULL UNIQUE,
  ordem     INTEGER NOT NULL DEFAULT 0,
  ativo     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE produtos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id   INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  nome           TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,
  descricao      TEXT,
  marca          TEXT,
  sku            TEXT,
  preco          INTEGER NOT NULL,              -- centavos
  preco_antigo   INTEGER,                       -- "de R$ X por R$ Y"
  unidade        TEXT    NOT NULL DEFAULT 'un', -- un, cx, kg, par, kit, ml...
  qtd_minima     INTEGER NOT NULL DEFAULT 1,    -- distribuidora: venda mínima
  multiplo       INTEGER NOT NULL DEFAULT 1,    -- distribuidora: vende de N em N
  estoque        INTEGER,                       -- NULL = não controla estoque
  destaque       INTEGER NOT NULL DEFAULT 0,
  ativo          INTEGER NOT NULL DEFAULT 1,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_produtos_categoria ON produtos(categoria_id, ativo);
CREATE INDEX idx_produtos_nome      ON produtos(nome);

-- Fotos (arquivos no R2; aqui só a chave)
CREATE TABLE produto_imagens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  r2_key      TEXT    NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_imagens_produto ON produto_imagens(produto_id, ordem);

-- Especificações livres: "Composição: 100% algodão", "Volume: 100 ml"
CREATE TABLE produto_specs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  rotulo      TEXT    NOT NULL,
  valor       TEXT    NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_specs_produto ON produto_specs(produto_id, ordem);

-- Variações: tamanho/cor (roupa), volume (perfume), tom (cosmético), caixa (distribuidora)
CREATE TABLE produto_variacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,        -- ex.: "M / Preto", "100 ml", "Cx c/ 12"
  sku         TEXT,
  preco       INTEGER,                 -- NULL = usa o preço do produto
  estoque     INTEGER,                 -- NULL = não controla
  ordem       INTEGER NOT NULL DEFAULT 0,
  ativo       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_variacoes_produto ON produto_variacoes(produto_id, ordem);

-- ---------------------------------------------------------------------
-- Entrega
-- ---------------------------------------------------------------------
CREATE TABLE regioes_entrega (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT    NOT NULL,
  taxa          INTEGER NOT NULL DEFAULT 0,   -- centavos
  gratis_acima  INTEGER,                      -- centavos; NULL = nunca grátis
  prazo         TEXT,                         -- "mesmo dia", "até 2 dias"
  ordem         INTEGER NOT NULL DEFAULT 0,
  ativo         INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Clientes e pedidos
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT    NOT NULL,
  telefone    TEXT    NOT NULL UNIQUE,   -- só dígitos
  endereco    TEXT,
  referencia  TEXT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pedidos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT    NOT NULL UNIQUE,     -- ex.: P2611-0042
  cliente_id        INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome      TEXT    NOT NULL,
  cliente_telefone  TEXT    NOT NULL,
  recebimento       TEXT    NOT NULL CHECK (recebimento IN ('entrega','retirada')),
  regiao_id         INTEGER REFERENCES regioes_entrega(id) ON DELETE SET NULL,
  regiao_nome       TEXT,
  endereco          TEXT,
  referencia        TEXT,
  pagamento         TEXT    NOT NULL CHECK (pagamento IN ('pix_chave','pix_atendente','cartao','dinheiro')),
  troco_para        INTEGER,                     -- centavos
  observacoes       TEXT,
  subtotal          INTEGER NOT NULL,
  taxa_entrega      INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'novo'
                    CHECK (status IN ('novo','confirmado','pago','preparando','saiu','entregue','cancelado')),
  criado_em         TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pedidos_status ON pedidos(status, criado_em);

-- Itens com "fotografia" do nome/preço no momento da compra
CREATE TABLE pedido_itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id      INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  variacao_id    INTEGER REFERENCES produto_variacoes(id) ON DELETE SET NULL,
  nome           TEXT    NOT NULL,
  variacao       TEXT,
  unidade        TEXT,
  preco_unit     INTEGER NOT NULL,
  quantidade     INTEGER NOT NULL CHECK (quantidade > 0),
  total          INTEGER NOT NULL
);
CREATE INDEX idx_itens_pedido ON pedido_itens(pedido_id);

INSERT INTO loja_config (id) VALUES (1);
