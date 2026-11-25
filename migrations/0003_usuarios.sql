-- =====================================================================
-- 0003 — Vários usuários no painel, com papéis, e registro de ações
-- =====================================================================

CREATE TABLE usuarios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash     TEXT    NOT NULL,            -- pbkdf2$<iterações>$<sal>$<hash>
  papel          TEXT    NOT NULL CHECK (papel IN ('master','dono','gerente','vendedor')),
  ativo          INTEGER NOT NULL DEFAULT 1,
  trocar_senha   INTEGER NOT NULL DEFAULT 1,  -- senha provisória: pede troca no 1º acesso
  versao_sessao  INTEGER NOT NULL DEFAULT 1,  -- incrementar derruba as sessões abertas
  ultimo_acesso  TEXT,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Quem fez o quê (preço, status de pedido, configuração, usuários, integração)
CREATE TABLE auditoria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome  TEXT    NOT NULL,
  acao          TEXT    NOT NULL,             -- ex.: produto.editar, pedido.status, loja.editar
  alvo          TEXT,                         -- ex.: "produto 12", "pedido P261125-AB12"
  detalhe       TEXT,                         -- JSON curto
  ip            TEXT,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auditoria_data    ON auditoria(criado_em);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id, criado_em);

-- Freio de tentativas de login (por e-mail e por IP)
CREATE TABLE login_tentativas (
  chave       TEXT PRIMARY KEY,               -- "email:<e-mail>" ou "ip:<ip>"
  falhas      INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
