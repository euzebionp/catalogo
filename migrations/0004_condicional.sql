-- Condicional (loja de roupas): o cliente leva as peças para provar e paga só o que ficar.
-- O condicional NÃO baixa estoque. Ao efetivar, o sistema gera um pedido de venda com as
-- peças que ficaram, e só esse pedido baixa o estoque e segue para o TagPlus.

ALTER TABLE loja_config ADD COLUMN condicional_ativo      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loja_config ADD COLUMN condicional_prazo_dias INTEGER NOT NULL DEFAULT 2;
ALTER TABLE loja_config ADD COLUMN condicional_regras     TEXT;

ALTER TABLE pedidos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'venda' CHECK (tipo IN ('venda','condicional'));
ALTER TABLE pedidos ADD COLUMN condicional_status TEXT CHECK (condicional_status IN ('aberto','efetivado','devolvido'));
ALTER TABLE pedidos ADD COLUMN condicional_prazo  TEXT;     -- data limite para devolver (AAAA-MM-DD)
ALTER TABLE pedidos ADD COLUMN condicional_fechado_em TEXT;
ALTER TABLE pedidos ADD COLUMN venda_id      INTEGER;      -- no condicional: o pedido de venda gerado
ALTER TABLE pedidos ADD COLUMN condicional_id INTEGER;     -- na venda: o condicional de origem

ALTER TABLE pedido_itens ADD COLUMN qtd_ficou INTEGER;     -- no condicional: quanto o cliente ficou

CREATE INDEX idx_pedidos_condicional ON pedidos(tipo, condicional_status);
