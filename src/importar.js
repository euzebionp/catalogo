// Importação da planilha (aba "Importacao" do modelo-importacao-catalogo.xlsx)
// O painel lê o .xlsx no navegador e envia as linhas em JSON; aqui elas viram produtos.

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
const txt = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const cent = (v) => {
  if (v === '' || v == null) return null;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100);
};
const int = (v) => (v === '' || v == null || isNaN(+v) ? null : Math.round(+v));
const SEM_VARIACAO = /^(|único|unico|u|-|padrão|padrao)$/i;

export async function importarLinhas(env, linhas, { atualizarFotos = true } = {}) {
  if (!Array.isArray(linhas) || !linhas.length) throw new Error('Nenhuma linha recebida.');
  if (linhas.length > 3000) throw new Error('Envie no máximo 3.000 linhas por vez.');

  // agrupa por código do produto (variações compartilham o código)
  const grupos = new Map();
  const erros = [];
  linhas.forEach((l, i) => {
    const codigo = txt(l.codigo_produto, 60);
    if (!codigo) return; // linha vazia
    if (!txt(l.nome)) { erros.push(`Linha ${i + 2}: falta o nome.`); return; }
    if (cent(l.preco) == null || cent(l.preco) <= 0) { erros.push(`Linha ${i + 2} (${codigo}): preço inválido.`); return; }
    if (!grupos.has(codigo)) grupos.set(codigo, []);
    grupos.get(codigo).push(l);
  });

  const cats = new Map((await env.DB.prepare('SELECT id, slug FROM categorias').all()).results.map((c) => [c.slug, c.id]));
  async function categoria(nome) {
    if (!txt(nome)) return null;
    const s = slugify(nome);
    if (!cats.has(s)) cats.set(s, await env.DB.prepare('INSERT INTO categorias (nome, slug) VALUES (?,?) RETURNING id').bind(txt(nome, 60), s).first('id'));
    return cats.get(s);
  }

  let criados = 0, atualizados = 0;
  for (const [codigo, rows] of grupos) {
    const base = rows[0];
    const comVariacao = rows.length > 1 || !SEM_VARIACAO.test(txt(base.variacao));
    const precos = rows.map((r) => cent(r.preco));
    const preco = Math.min(...precos);
    const estoqueTotal = rows.every((r) => int(r.estoque) == null) ? null : rows.reduce((s, r) => s + (int(r.estoque) || 0), 0);
    const tagplusId = int(base.codigo_tagplus);
    const cat = await categoria(base.categoria);
    const campos = {
      categoria_id: cat, nome: txt(base.nome, 150), descricao: txt(base.descricao, 4000) || null, marca: txt(base.marca, 80) || null,
      sku: comVariacao ? null : txt(base.sku, 60) || null, preco, preco_antigo: cent(base.preco_antigo),
      unidade: txt(base.unidade, 10) || 'un', qtd_minima: Math.max(1, int(base.qtd_minima) || 1), multiplo: Math.max(1, int(base.multiplo) || 1),
      estoque: comVariacao ? null : estoqueTotal, ativo: /^n/i.test(txt(base.ativo)) ? 0 : 1,
      ncm: txt(base.ncm, 10).replace(/\D/g, '') || null, cest: txt(base.cest, 10).replace(/\D/g, '') || null, custo: cent(base.custo),
    };

    let existente = await env.DB.prepare('SELECT id, slug FROM produtos WHERE codigo = ? OR (? IS NOT NULL AND tagplus_id = ?) LIMIT 1')
      .bind(codigo, tagplusId, tagplusId).first();
    let id;
    if (existente) {
      id = existente.id;
      const ks = Object.keys(campos);
      await env.DB.prepare(`UPDATE produtos SET ${ks.map((k) => k + ' = ?').join(', ')}, codigo = ?, tagplus_id = COALESCE(?, tagplus_id),
        atualizado_em = datetime('now') WHERE id = ?`).bind(...ks.map((k) => campos[k]), codigo, tagplusId, id).run();
      atualizados++;
    } else {
      let slug = slugify(campos.nome);
      if (await env.DB.prepare('SELECT 1 FROM produtos WHERE slug = ?').bind(slug).first()) slug += '-' + slugify(codigo);
      const ks = Object.keys(campos);
      id = await env.DB.prepare(`INSERT INTO produtos (${ks.join(', ')}, codigo, tagplus_id, slug) VALUES (${ks.map(() => '?').join(', ')}, ?, ?, ?) RETURNING id`)
        .bind(...ks.map((k) => campos[k]), codigo, tagplusId, slug).first('id');
      criados++;
    }

    const st = [];
    // especificações: "Rótulo: valor | Rótulo: valor"
    const specs = txt(base.especificacoes, 3000).split('|').map((s) => s.split(':')).filter((p) => p.length >= 2 && p[0].trim())
      .map(([r, ...v]) => [r.trim().slice(0, 60), v.join(':').trim().slice(0, 300)]).filter(([, v]) => v);
    if (specs.length) {
      st.push(env.DB.prepare('DELETE FROM produto_specs WHERE produto_id = ?').bind(id));
      specs.forEach(([r, v], i) => st.push(env.DB.prepare('INSERT INTO produto_specs (produto_id, rotulo, valor, ordem) VALUES (?,?,?,?)').bind(id, r, v, i)));
    }
    // fotos por URL
    const fotos = txt(base.fotos, 4000).split('|').map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 12);
    if (fotos.length && atualizarFotos) {
      st.push(env.DB.prepare(`DELETE FROM produto_imagens WHERE produto_id = ? AND r2_key LIKE 'http%'`).bind(id));
      fotos.forEach((u, i) => st.push(env.DB.prepare('INSERT INTO produto_imagens (produto_id, r2_key, ordem) VALUES (?,?,?)').bind(id, u, 100 + i)));
    }
    // variações
    if (comVariacao) {
      const nomes = [];
      for (const [i, r] of rows.entries()) {
        const nome = txt(r.variacao, 80) || `Opção ${i + 1}`;
        nomes.push(nome);
        const p = cent(r.preco);
        const vals = [txt(r.sku, 60) || null, p === preco ? null : p, int(r.estoque), i];
        const ex = await env.DB.prepare('SELECT id FROM produto_variacoes WHERE produto_id = ? AND nome = ?').bind(id, nome).first('id');
        if (ex) st.push(env.DB.prepare('UPDATE produto_variacoes SET sku = ?, preco = ?, estoque = ?, ordem = ?, ativo = 1 WHERE id = ?').bind(...vals, ex));
        else st.push(env.DB.prepare('INSERT INTO produto_variacoes (sku, preco, estoque, ordem, produto_id, nome) VALUES (?,?,?,?,?,?)').bind(...vals, id, nome));
      }
      st.push(env.DB.prepare(`UPDATE produto_variacoes SET ativo = 0 WHERE produto_id = ? AND nome NOT IN (${nomes.map(() => '?').join(',')})`).bind(id, ...nomes));
    }
    if (st.length) await env.DB.batch(st);
  }

  await env.DB.prepare('INSERT INTO integracao_log (origem, evento, ok, detalhe) VALUES (?,?,?,?)')
    .bind('planilha', 'importacao', erros.length ? 0 : 1, JSON.stringify({ criados, atualizados, erros: erros.slice(0, 50) })).run();
  return { produtos: grupos.size, criados, atualizados, erros };
}
