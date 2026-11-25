-- =====================================================================
-- 0002 — Importação por planilha e integração com o ERP TagPlus
-- =====================================================================

-- Produtos: dados fiscais, custo e vínculo com o TagPlus
ALTER TABLE produtos ADD COLUMN codigo        TEXT;     -- "Código do produto" da planilha (agrupa variações)
ALTER TABLE produtos ADD COLUMN ncm           TEXT;
ALTER TABLE produtos ADD COLUMN cest          TEXT;
ALTER TABLE produtos ADD COLUMN custo         INTEGER;  -- centavos, custo total de aquisição
ALTER TABLE produtos ADD COLUMN tagplus_id    INTEGER;
ALTER TABLE produtos ADD COLUMN sincronizado_em TEXT;
CREATE UNIQUE INDEX idx_produtos_codigo  ON produtos(codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX idx_produtos_tagplus ON produtos(tagplus_id) WHERE tagplus_id IS NOT NULL;

ALTER TABLE produto_variacoes ADD COLUMN tagplus_id INTEGER;
CREATE INDEX idx_variacoes_tagplus ON produto_variacoes(tagplus_id);

-- Clientes: CPF/CNPJ para a nota fiscal
ALTER TABLE clientes ADD COLUMN cpf_cnpj   TEXT;
ALTER TABLE clientes ADD COLUMN tagplus_id INTEGER;

-- Pedidos: CPF na nota, vínculo com o pedido do ERP e dados da nota emitida
ALTER TABLE pedidos ADD COLUMN cliente_cpf_cnpj  TEXT;
ALTER TABLE pedidos ADD COLUMN tagplus_pedido_id INTEGER;
ALTER TABLE pedidos ADD COLUMN erp_status        TEXT;   -- pendente | enviado | erro
ALTER TABLE pedidos ADD COLUMN nf_tipo           TEXT;   -- nfce | nfe
ALTER TABLE pedidos ADD COLUMN nf_id             INTEGER;
ALTER TABLE pedidos ADD COLUMN nf_numero         TEXT;
ALTER TABLE pedidos ADD COLUMN nf_chave          TEXT;
ALTER TABLE pedidos ADD COLUMN nf_status         TEXT;   -- solicitada | autorizada | rejeitada | cancelada
ALTER TABLE pedidos ADD COLUMN nf_url            TEXT;   -- DANFE / link de consulta
ALTER TABLE pedidos ADD COLUMN nf_erro           TEXT;

-- Chave/valor da integração: tokens OAuth, cursores de sincronização, opções
CREATE TABLE integracao (
  chave          TEXT PRIMARY KEY,
  valor          TEXT,
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fila de tarefas (outbox): tudo que vai ou vem do ERP passa por aqui, com nova tentativa
CREATE TABLE integracao_fila (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo        TEXT    NOT NULL,   -- enviar_pedido | emitir_nota | atualizar_produto | atualizar_nota | sincronizar_produtos
  ref_id      TEXT,               -- id local ou do TagPlus, conforme o tipo
  payload     TEXT,               -- JSON
  status      TEXT    NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','ok','erro')),
  tentativas  INTEGER NOT NULL DEFAULT 0,
  proxima_em  TEXT    NOT NULL DEFAULT (datetime('now')),
  erro        TEXT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT  NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fila_status ON integracao_fila(status, proxima_em);

-- Registro de tudo que entrou e saiu (webhooks, chamadas, importações)
CREATE TABLE integracao_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  origem     TEXT NOT NULL,       -- tagplus | webhook | planilha | sistema
  evento     TEXT NOT NULL,
  ref        TEXT,
  ok         INTEGER NOT NULL DEFAULT 1,
  detalhe    TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_log_data ON integracao_log(criado_em);
