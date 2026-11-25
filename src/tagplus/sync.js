// Sincronização catálogo ⇄ TagPlus: produtos/estoque (entrada) e pedidos/notas (saída)
import { api, paginas, lerChave, gravarChave, registrar, configurado, ErroTagPlus } from './cliente.js';
import { produtoDoTagPlus, clienteParaTagPlus, pedidoParaTagPlus, notaParaTagPlus, notaDoTagPlus, tarefaDoWebhook } from './mapa.js';

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';

// ---------------------------------------------------------------- fila (outbox)
export async function enfileirar(env, tipo, refId, payload = null) {
  // evita duplicar a mesma tarefa ainda pendente
  const ja = await env.DB.prepare(`SELECT id FROM integracao_fila WHERE tipo = ? AND ref_id IS ? AND status IN ('pendente','processando')`)
    .bind(tipo, refId == null ? null : String(refId)).first('id');
  if (ja) return ja;
  return env.DB.prepare('INSERT INTO integracao_fila (tipo, ref_id, payload) VALUES (?,?,?) RETURNING id')
    .bind(tipo, refId == null ? null : String(refId), payload ? JSON.stringify(payload) : null).first('id');
}

export async function processarFila(env, limite = 15) {
  if (!configurado(env) || !(await lerChave(env, 'tagplus_token'))) return { processadas: 0 };
  const { results } = await env.DB.prepare(`SELECT * FROM integracao_fila WHERE status = 'pendente' AND proxima_em <= datetime('now')
    ORDER BY id LIMIT ?`).bind(limite).all();
  let ok = 0, falhas = 0;
  for (const t of results) {
    const trava = await env.DB.prepare(`UPDATE integracao_fila SET status = 'processando', atualizado_em = datetime('now')
      WHERE id = ? AND status = 'pendente'`).bind(t.id).run();
    if (!trava.meta.changes) continue; // outra execução pegou
    try {
      await executar(env, t);
      await env.DB.prepare(`UPDATE integracao_fila SET status = 'ok', erro = NULL, atualizado_em = datetime('now') WHERE id = ?`).bind(t.id).run();
      ok++;
    } catch (e) {
      falhas++;
      const n = t.tentativas + 1;
      const definitivo = n >= 6 || (e instanceof ErroTagPlus && [400, 403, 404, 422].includes(e.status));
      await env.DB.prepare(`UPDATE integracao_fila SET status = ?, tentativas = ?, erro = ?,
        proxima_em = datetime('now', ?), atualizado_em = datetime('now') WHERE id = ?`)
        .bind(definitivo ? 'erro' : 'pendente', n, String(e.message).slice(0, 500), `+${2 ** n} minutes`, t.id).run();
      await registrar(env, 'tagplus', t.tipo, { ref: t.ref_id, ok: false, detalhe: { erro: e.message, codigo: e.codigo, dados: e.corpo?.data } });
      if (t.tipo === 'enviar_pedido') await env.DB.prepare(`UPDATE pedidos SET erp_status = 'erro' WHERE id = ?`).bind(+t.ref_id).run();
      if (t.tipo === 'emitir_nota') await env.DB.prepare(`UPDATE pedidos SET nf_status = 'rejeitada', nf_erro = ? WHERE id = ?`).bind(String(e.message).slice(0, 300), +t.ref_id).run();
    }
  }
  return { processadas: results.length, ok, falhas };
}

async function executar(env, t) {
  const payload = t.payload ? JSON.parse(t.payload) : {};
  switch (t.tipo) {
    case 'enviar_pedido': return enviarPedido(env, +t.ref_id);
    case 'emitir_nota': return emitirNota(env, +t.ref_id, payload.tipo || 'nfce');
    case 'atualizar_produto': return aplicarProduto(env, produtoDoTagPlus(await api(env, 'GET', `/produtos/${+t.ref_id}`)));
    case 'atualizar_nota': return atualizarNota(env, +t.ref_id, payload.tipo);
    case 'sincronizar_produtos': return sincronizarProdutos(env, payload);
    case 'atualizar_pedido': return registrar(env, 'tagplus', 'pedido_alterado_no_erp', { ref: t.ref_id });
    default: throw new Error(`Tarefa desconhecida: ${t.tipo}`);
  }
}

// ---------------------------------------------------------------- produtos e estoque (TagPlus → catálogo)
export async function sincronizarProdutos(env, { completo = false } = {}) {
  const inicio = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const desde = completo ? null : await lerChave(env, 'tagplus_produtos_desde');
  let total = 0;
  for await (const lote of paginas(env, '/produtos', { fields: '*', sort: 'data_alteracao', ...(desde ? { since: desde } : {}) })) {
    for (const p of lote) {
      // a coleção pode vir resumida; se faltar preço, busca o item completo
      const completoP = p.valor_venda_varejo === undefined && p.preco === undefined ? await api(env, 'GET', `/produtos/${p.id}`) : p;
      await aplicarProduto(env, produtoDoTagPlus(completoP));
      total++;
    }
  }
  await gravarChave(env, 'tagplus_produtos_desde', inicio);
  await registrar(env, 'tagplus', completo ? 'sincronizacao_completa' : 'sincronizacao_incremental', { detalhe: { produtos: total, desde } });
  return { produtos: total };
}

async function categoriaId(env, nome) {
  if (!nome) return null;
  const slug = slugify(nome);
  const c = await env.DB.prepare('SELECT id FROM categorias WHERE slug = ?').bind(slug).first('id');
  if (c) return c;
  return env.DB.prepare('INSERT INTO categorias (nome, slug) VALUES (?,?) RETURNING id').bind(String(nome).slice(0, 60), slug).first('id');
}

export async function aplicarProduto(env, d) {
  const opc = (await lerChave(env, 'tagplus_opcoes')) || {};
  const existente = await env.DB.prepare('SELECT * FROM produtos WHERE tagplus_id = ? OR (codigo IS NOT NULL AND codigo = ?) LIMIT 1')
    .bind(d.tagplus_id, d.codigo).first();
  const cat = await categoriaId(env, d.categoria);
  const preco = d.preco ?? existente?.preco ?? 0;

  let id;
  if (existente) {
    id = existente.id;
    await env.DB.prepare(`UPDATE produtos SET tagplus_id = ?, codigo = COALESCE(codigo, ?), nome = ?, categoria_id = COALESCE(?, categoria_id),
      marca = COALESCE(?, marca), unidade = ?, ncm = COALESCE(?, ncm), cest = COALESCE(?, cest), custo = COALESCE(?, custo),
      preco = ?, estoque = ?, ativo = ?, descricao = COALESCE(descricao, ?), sincronizado_em = datetime('now'), atualizado_em = datetime('now')
      WHERE id = ?`).bind(d.tagplus_id, d.codigo, opc.manter_nome_catalogo ? existente.nome : d.nome, cat, d.marca, d.unidade, d.ncm, d.cest,
      d.custo, opc.manter_preco_catalogo ? existente.preco : preco, d.estoque, d.ativo ? 1 : 0, d.descricao, id).run();
  } else {
    let slug = slugify(d.nome);
    if (await env.DB.prepare('SELECT 1 FROM produtos WHERE slug = ?').bind(slug).first()) slug += '-' + d.tagplus_id;
    id = await env.DB.prepare(`INSERT INTO produtos (tagplus_id, codigo, nome, slug, descricao, marca, categoria_id, unidade, ncm, cest, custo,
      preco, estoque, ativo, sincronizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now')) RETURNING id`)
      .bind(d.tagplus_id, d.codigo, d.nome, slug, d.descricao, d.marca, cat, d.unidade, d.ncm, d.cest, d.custo, preco, d.estoque,
        // produto novo vindo do ERP entra oculto até ter foto, se a loja preferir
        d.ativo && !(opc.novos_ocultos && !d.imagens.length) ? 1 : 0).first('id');
  }

  const st = [];
  if (d.imagens.length) {
    const atuais = (await env.DB.prepare('SELECT r2_key FROM produto_imagens WHERE produto_id = ?').bind(id).all()).results;
    // só troca fotos que vieram do ERP; fotos enviadas pelo painel (R2/KV) são preservadas
    if (!atuais.some((a) => !/^https?:/.test(a.r2_key))) {
      st.push(env.DB.prepare('DELETE FROM produto_imagens WHERE produto_id = ?').bind(id));
      d.imagens.slice(0, 12).forEach((u, i) => st.push(env.DB.prepare('INSERT INTO produto_imagens (produto_id, r2_key, ordem) VALUES (?,?,?)').bind(id, u, i)));
    }
  }
  for (const [i, v] of d.variacoes.entries()) {
    const ex = await env.DB.prepare('SELECT id FROM produto_variacoes WHERE produto_id = ? AND (tagplus_id = ? OR nome = ?)').bind(id, v.tagplus_id, v.nome).first('id');
    const est = v.estoque == null || typeof v.estoque === 'object' ? null : Math.floor(+v.estoque);
    if (ex) st.push(env.DB.prepare('UPDATE produto_variacoes SET tagplus_id = ?, nome = ?, preco = ?, estoque = ?, ordem = ?, ativo = 1 WHERE id = ?').bind(v.tagplus_id, v.nome, v.preco, est, i, ex));
    else st.push(env.DB.prepare('INSERT INTO produto_variacoes (produto_id, tagplus_id, nome, preco, estoque, ordem) VALUES (?,?,?,?,?,?)').bind(id, v.tagplus_id, v.nome, v.preco, est, i));
  }
  if (st.length) await env.DB.batch(st);
  return id;
}

// ---------------------------------------------------------------- pedidos (catálogo → TagPlus)
async function garantirCliente(env, pedido) {
  const cli = pedido.cliente_id ? await env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(pedido.cliente_id).first() : null;
  if (cli?.tagplus_id) return cli.tagplus_id;
  const cfg = await env.DB.prepare('SELECT nome FROM loja_config WHERE id = 1').first();
  // procura pelo CPF/CNPJ ou telefone antes de criar
  const busca = pedido.cliente_cpf_cnpj || pedido.cliente_telefone;
  const achados = await api(env, 'GET', '/clientes', { query: { q: busca, per_page: 5 } }).catch(() => []);
  let tid = Array.isArray(achados) && achados[0]?.id;
  if (!tid) tid = (await api(env, 'POST', '/clientes', { corpo: clienteParaTagPlus(pedido, cfg) })).id;
  if (cli) await env.DB.prepare('UPDATE clientes SET tagplus_id = ? WHERE id = ?').bind(tid, cli.id).run();
  return tid;
}

export async function enviarPedido(env, pedidoId) {
  const pedido = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(pedidoId).first();
  if (!pedido) throw new Error('Pedido não encontrado.');
  if (pedido.tagplus_pedido_id) return pedido.tagplus_pedido_id;
  const { results: itens } = await env.DB.prepare(`SELECT i.*, p.tagplus_id AS tagplus_produto_id, v.tagplus_id AS tagplus_variacao_id
    FROM pedido_itens i LEFT JOIN produtos p ON p.id = i.produto_id LEFT JOIN produto_variacoes v ON v.id = i.variacao_id
    WHERE i.pedido_id = ?`).bind(pedidoId).all();
  const semVinculo = itens.filter((i) => !i.tagplus_produto_id && !i.tagplus_variacao_id);
  if (semVinculo.length) throw new ErroTagPlus(422, { message: `Produto sem vínculo com o TagPlus: ${semVinculo.map((i) => i.nome).join(', ')}` });

  const clienteId = await garantirCliente(env, pedido);
  const opc = (await lerChave(env, 'tagplus_opcoes')) || {};
  const formaPagamentoId = opc.formas_pagamento?.[pedido.pagamento] || null;
  const r = await api(env, 'POST', '/pedidos', { corpo: pedidoParaTagPlus(pedido, itens, { clienteId, formaPagamentoId }) });
  await env.DB.prepare(`UPDATE pedidos SET tagplus_pedido_id = ?, erp_status = 'enviado', atualizado_em = datetime('now') WHERE id = ?`).bind(r.id, pedidoId).run();
  await registrar(env, 'tagplus', 'pedido_enviado', { ref: pedido.codigo, detalhe: { tagplus_id: r.id } });
  return r.id;
}

// ---------------------------------------------------------------- notas fiscais
export async function emitirNota(env, pedidoId, tipo = 'nfce') {
  let pedido = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(pedidoId).first();
  if (!pedido) throw new Error('Pedido não encontrado.');
  if (pedido.nf_status === 'autorizada') return pedido.nf_id;
  const tagplusPedidoId = pedido.tagplus_pedido_id || (await enviarPedido(env, pedidoId));
  pedido = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(pedidoId).first();
  const clienteId = pedido.cliente_id ? await env.DB.prepare('SELECT tagplus_id FROM clientes WHERE id = ?').bind(pedido.cliente_id).first('tagplus_id') : null;
  const recurso = tipo === 'nfe' ? '/nfes' : '/nfces';
  const r = await api(env, 'POST', recurso, { corpo: notaParaTagPlus(pedido, { tagplusPedidoId, clienteId }) });
  const n = notaDoTagPlus(r);
  await env.DB.prepare(`UPDATE pedidos SET nf_tipo = ?, nf_id = ?, nf_numero = ?, nf_chave = ?, nf_status = ?, nf_url = ?, nf_erro = ?,
    atualizado_em = datetime('now') WHERE id = ?`).bind(tipo, n.id, n.numero, n.chave, n.status, n.url, n.erro, pedidoId).run();
  await registrar(env, 'tagplus', 'nota_solicitada', { ref: pedido.codigo, detalhe: { tipo, id: n.id, status: n.status } });
  // a SEFAZ responde de forma assíncrona: confere de novo em alguns minutos
  if (n.status === 'solicitada') await enfileirar(env, 'atualizar_nota', n.id, { tipo });
  return n.id;
}

export async function atualizarNota(env, notaId, tipo) {
  const pedido = await env.DB.prepare('SELECT id, nf_tipo FROM pedidos WHERE nf_id = ?').bind(notaId).first();
  const t = tipo || pedido?.nf_tipo || 'nfce';
  const n = notaDoTagPlus(await api(env, 'GET', `/${t === 'nfe' ? 'nfes' : 'nfces'}/${notaId}`));
  if (pedido) await env.DB.prepare(`UPDATE pedidos SET nf_numero = COALESCE(?, nf_numero), nf_chave = COALESCE(?, nf_chave), nf_status = ?,
    nf_url = COALESCE(?, nf_url), nf_erro = ?, atualizado_em = datetime('now') WHERE id = ?`).bind(n.numero, n.chave, n.status, n.url, n.erro, pedido.id).run();
  if (n.status === 'solicitada') throw new Error('Nota ainda em processamento na SEFAZ.'); // volta para a fila e tenta depois
  return n;
}

// ---------------------------------------------------------------- webhook (TagPlus → catálogo)
export async function receberWebhook(env, corpo) {
  const evento = String(corpo?.event_type || '');
  const ids = (Array.isArray(corpo?.data) ? corpo.data : []).map((d) => d?.id).filter(Boolean);
  await registrar(env, 'webhook', evento || 'desconhecido', { ref: ids.join(','), detalhe: { sistema: corpo?.sistema } });
  const tarefa = tarefaDoWebhook(evento);
  if (!tarefa) return { ignorado: true };
  if (/apagad|exclu|removid/.test(evento) && tarefa === 'atualizar_produto') {
    for (const id of ids) await env.DB.prepare('UPDATE produtos SET ativo = 0 WHERE tagplus_id = ?').bind(+id).run();
    return { desativados: ids.length };
  }
  for (const id of ids) await enfileirar(env, tarefa, id, /nfe/.test(evento) && !/nfce/.test(evento) ? { tipo: 'nfe' } : /nfce/.test(evento) ? { tipo: 'nfce' } : null);
  return { enfileirados: ids.length };
}
