-- Dados da loja de demonstração. Rodado pelo reset diário (src/demo.js) e no primeiro deploy.
-- Não altera o WhatsApp da loja: ele é configurado pelo Administrador master e sobrevive ao reset.
DELETE FROM pedido_itens;
DELETE FROM pedidos;
DELETE FROM clientes;
DELETE FROM produto_imagens;
DELETE FROM produto_specs;
DELETE FROM produto_variacoes;
DELETE FROM produtos;
DELETE FROM categorias;
DELETE FROM regioes_entrega;
DELETE FROM integracao_fila;
DELETE FROM integracao_log;
DELETE FROM login_tentativas;
DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_itens','clientes','produtos','produto_imagens','produto_specs','produto_variacoes','categorias','regioes_entrega');
UPDATE loja_config SET nome = 'Loja Modelo', slogan = 'Moda, perfumaria e cosméticos — peça pelo WhatsApp', segmento = 'misto', logo_key = NULL, cor_primaria = '#7b3fa0', cor_destaque = '#e2a33d', instagram = NULL, endereco_loja = 'Rua das Flores, 100 — Centro', horario = 'Seg a Sex 08:30–18:00 · Sáb 08:30–12:00', aviso_topo = 'Loja de demonstração — nenhum pedido é cobrado|Entrega no mesmo dia no Centro|Pague com Pix ou cartão na entrega', pedido_minimo = 3000, permite_retirada = 1, permite_entrega = 1, pix_ativo = 1, pix_tipo = 'aleatoria', pix_chave = '00000000-0000-0000-0000-000000000000', pix_titular = 'LOJA DEMONSTRACAO', pix_banco = 'Chave fictícia — não pague', pix_cidade = 'Uberlandia', pix_modo = 'ambos', aceita_cartao = 1, aceita_dinheiro = 1 WHERE id = 1;
INSERT INTO categorias (id, nome, slug, ordem) VALUES (1,'Perfumaria','perfumaria',1),(2,'Maquiagem','maquiagem',2),(3,'Cuidados','cuidados',3),(4,'Feminino','feminino',4),(5,'Masculino','masculino',5),(6,'Acessórios','acessorios',6),(7,'Atacado','atacado',7);
INSERT INTO regioes_entrega (nome, taxa, gratis_acima, prazo, ordem) VALUES ('Centro',0,NULL,'mesmo dia',1),('Bairros',800,15000,'até 1 dia útil',2),('Cidades vizinhas',1800,30000,'até 2 dias úteis',3);
INSERT INTO produtos (id, categoria_id, codigo, nome, slug, descricao, marca, preco, preco_antigo, unidade, qtd_minima, multiplo, estoque, destaque, ncm) VALUES
 (1,1,'PERF-FLORA','Perfume Flora Eau de Parfum','perfume-flora','Floral frutado com notas de peônia, pera e baunilha. Fixação prolongada.','Essenza',18990,22990,'un',1,1,NULL,1,'33030010'),
 (2,1,'PERF-BOSQUE','Perfume Bosque Masculino','perfume-bosque','Amadeirado aromático com cedro, vetiver e bergamota.','Essenza',16990,NULL,'un',1,1,NULL,1,'33030020'),
 (3,1,'BODY-LAV','Body Splash Lavanda 200 ml','body-splash-lavanda','Refrescante para o dia a dia, com toque de lavanda e algodão.','Pureza',4990,5990,'un',1,1,25,0,'33030020'),
 (4,2,'BAT-MATTE','Batom Matte Longa Duração','batom-matte','Cobertura intensa, acabamento aveludado e até 12 h de duração.','Glow',3490,NULL,'un',1,1,NULL,1,'33041000'),
 (5,2,'BASE-MATTE','Base Líquida Matte FPS 15','base-liquida-matte','Alta cobertura, controle de oleosidade e proteção solar.','Glow',5990,NULL,'un',1,1,NULL,0,'33049990'),
 (6,3,'HID-400','Hidratante Corporal 400 ml','hidratante-corporal','Hidratação por 48 h com manteiga de karité. Pele macia sem sensação pegajosa.','Pureza',2990,3490,'un',1,1,40,0,'33049910'),
 (7,2,'ESM-UNHA','Esmalte Cremoso','esmalte-cremoso','Secagem rápida e alto brilho.','Glow',890,NULL,'un',1,1,NULL,0,'33043000'),
 (8,4,'VEST-MIDI','Vestido Midi Floral','vestido-midi-floral','Viscose leve com forro, alça regulável e fenda lateral.','Bella',12990,15990,'un',1,1,NULL,1,'62044400'),
 (9,5,'CAM-BAS','Camiseta Básica Algodão','camiseta-basica','100% algodão penteado fio 30.1, toque macio e modelagem reta.','Urban',4990,NULL,'un',1,1,NULL,0,'61091000'),
 (10,4,'JEANS-RETA','Calça Jeans Reta','calca-jeans-reta','Jeans com elastano, cintura alta e lavagem média.','Urban',14990,NULL,'un',1,1,NULL,0,'62046200'),
 (11,6,'BOLSA-TIRA','Bolsa Tiracolo Couro Sintético','bolsa-tiracolo','Compartimento interno com zíper e alça ajustável.','Bella',8990,10990,'un',1,1,12,0,'42022210'),
 (12,7,'SAB-CX12','Sabonete em Barra — caixa','sabonete-caixa','Caixa fechada para revenda. Vendido a partir de 2 caixas.','Pureza',8990,NULL,'cx',2,1,NULL,0,'34011190'),
 (13,1,'KIT-PRES','Kit Presente Perfumaria','kit-presente','Perfume Flora 50 ml + hidratante 200 ml em caixa presenteável.','Essenza',19990,23990,'kit',1,1,8,1,'33030010');
INSERT INTO produto_imagens (produto_id, r2_key, ordem) VALUES (1,'/demo/perfume-floral.svg',0),(2,'/demo/perfume-amadeirado.svg',0),(3,'/demo/body-splash.svg',0),(4,'/demo/batom.svg',0),(5,'/demo/base-liquida.svg',0),(6,'/demo/hidratante.svg',0),(7,'/demo/esmalte.svg',0),(8,'/demo/vestido.svg',0),(9,'/demo/camiseta.svg',0),(10,'/demo/calca-jeans.svg',0),(11,'/demo/bolsa.svg',0),(12,'/demo/sabonete-caixa.svg',0),(13,'/demo/kit-presente.svg',0);
INSERT INTO produto_variacoes (produto_id, nome, preco, estoque, ordem) VALUES
 (1,'50 ml',12990,6,1),(1,'100 ml',18990,4,2),
 (2,'50 ml',11990,5,1),(2,'100 ml',16990,3,2),
 (4,'Vermelho Clássico',NULL,10,1),(4,'Nude Rosado',NULL,8,2),(4,'Vinho',NULL,0,3),
 (5,'Tom 01 Claro',NULL,NULL,1),(5,'Tom 03 Médio',NULL,NULL,2),(5,'Tom 05 Escuro',NULL,NULL,3),
 (7,'Rosa Chiclete',NULL,NULL,1),(7,'Vermelho Paixão',NULL,NULL,2),(7,'Nude',NULL,NULL,3),
 (8,'P',NULL,3,1),(8,'M',NULL,5,2),(8,'G',NULL,2,3),
 (9,'P / Branco',NULL,NULL,1),(9,'M / Branco',NULL,NULL,2),(9,'G / Branco',NULL,NULL,3),(9,'M / Preto',NULL,NULL,4),(9,'G / Preto',NULL,NULL,5),
 (10,'36',NULL,2,1),(10,'38',NULL,4,2),(10,'40',NULL,4,3),(10,'42',NULL,1,4),
 (12,'Cx c/ 12 un',8990,NULL,1),(12,'Cx c/ 24 un',16990,NULL,2);
INSERT INTO produto_specs (produto_id, rotulo, valor, ordem) VALUES
 (1,'Família olfativa','Floral frutado',1),(1,'Concentração','Eau de Parfum',2),
 (2,'Família olfativa','Amadeirado aromático',1),(2,'Concentração','Eau de Parfum',2),
 (4,'Acabamento','Matte',1),(4,'Duração','Até 12 h',2),
 (5,'Acabamento','Matte',1),(5,'FPS','15',2),
 (8,'Composição','100% viscose',1),(8,'Comprimento','Midi',2),
 (9,'Composição','100% algodão',1),
 (10,'Composição','98% algodão, 2% elastano',1),(10,'Modelagem','Reta, cintura alta',2),
 (11,'Material','Couro sintético',1),(11,'Medidas','24 × 18 × 8 cm',2),
 (12,'Peso unitário','90 g',1);
