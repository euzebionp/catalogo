-- Dados de exemplo (pode apagar depois pelo painel)
UPDATE loja_config SET
  nome = 'Bella Moda & Perfumaria',
  slogan = 'Roupas, perfumes e cosméticos com entrega rápida',
  segmento = 'misto',
  whatsapp = '5534999999999',
  instagram = 'bellamoda',
  horario = 'Seg a Sex 08:30–18:00 · Sáb 08:30–12:00',
  aviso_topo = 'Frete grátis acima de R$ 150|Pague com Pix ou cartão na entrega|Pedidos pelo site 24 horas',
  pedido_minimo = 3000,
  pix_tipo = 'cnpj',
  pix_chave = '12.345.678/0001-90',
  pix_titular = 'Bella Moda LTDA',
  pix_banco = 'Banco Exemplo',
  pix_cidade = 'Uberlandia',
  pix_modo = 'ambos'
WHERE id = 1;

INSERT INTO categorias (nome, slug, ordem) VALUES
 ('Feminino','feminino',1),('Masculino','masculino',2),
 ('Perfumaria','perfumaria',3),('Cosméticos','cosmeticos',4),('Atacado','atacado',5);

INSERT INTO produtos (categoria_id,nome,slug,descricao,marca,preco,preco_antigo,unidade,destaque) VALUES
 (1,'Vestido Midi Viscose Floral','vestido-midi-viscose-floral','Vestido midi com alça regulável e forro.','Bella',12990,15990,'un',1),
 (1,'Blusa Canelada Manga Longa','blusa-canelada-manga-longa','Malha canelada macia, modelagem justa.','Bella',5990,NULL,'un',0),
 (2,'Camiseta Básica Algodão','camiseta-basica-algodao','100% algodão penteado fio 30.1.','Urban',4990,NULL,'un',1),
 (3,'Perfume Floral Eau de Parfum','perfume-floral-edp','Notas de jasmim, rosa e baunilha.','Essenza',18990,21990,'un',1),
 (4,'Base Líquida Matte','base-liquida-matte','Alta cobertura, acabamento matte, FPS 15.','Glow',4590,NULL,'un',0),
 (5,'Sabonete em Barra — caixa','sabonete-barra-caixa','Caixa fechada para revenda.','Pureza',8990,NULL,'cx',0);

UPDATE produtos SET qtd_minima = 2 WHERE slug = 'sabonete-barra-caixa';

INSERT INTO produto_variacoes (produto_id,nome,ordem) VALUES
 (1,'P',1),(1,'M',2),(1,'G',3),
 (2,'P / Preto',1),(2,'M / Preto',2),(2,'M / Off-white',3),(2,'G / Off-white',4),
 (3,'P',1),(3,'M',2),(3,'G',3),(3,'GG',4);
INSERT INTO produto_variacoes (produto_id,nome,preco,ordem) VALUES
 (4,'50 ml',12990,1),(4,'100 ml',18990,2),
 (5,'Tom 01 Claro',NULL,1),(5,'Tom 03 Médio',NULL,2),(5,'Tom 05 Escuro',NULL,3),
 (6,'Cx c/ 12 un',8990,1),(6,'Cx c/ 24 un',16990,2);

INSERT INTO produto_specs (produto_id,rotulo,valor,ordem) VALUES
 (1,'Composição','100% viscose',1),(1,'Comprimento','Midi',2),
 (3,'Composição','100% algodão',1),
 (4,'Família olfativa','Floral',1),(4,'Concentração','Eau de Parfum',2),
 (5,'Acabamento','Matte',1),(5,'FPS','15',2),
 (6,'Peso unitário','90 g',1);

INSERT INTO regioes_entrega (nome,taxa,gratis_acima,prazo,ordem) VALUES
 ('Centro',500,15000,'mesmo dia',1),
 ('Bairros',1000,15000,'até 1 dia útil',2),
 ('Zona rural',2000,NULL,'combinar',3);
