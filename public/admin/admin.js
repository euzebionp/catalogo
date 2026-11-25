// Painel do administrador
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
// "129,90" | "1.299,90" | "129.9" -> centavos
const cent = (s) => {
  s = String(s ?? '').trim(); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100);
};
const reais = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const fone = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t; };
const data = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

let token = null;
try { token = sessionStorage.getItem('adm_token'); } catch {}
const S = { aba: 'pedidos', cats: [], produtos: [], busca: '', filtroStatus: '' };

const STATUS = { novo: 'Novo', confirmado: 'Confirmado', pago: 'Pago', preparando: 'Preparando', saiu: 'Saiu p/ entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAG = { pix_chave: 'Pix (chave)', pix_atendente: 'Pix (atendente)', cartao: 'Cartão na entrega', dinheiro: 'Dinheiro' };

async function api(path, opt = {}) {
  const r = await fetch('/api/admin/' + path, {
    ...opt,
    headers: { ...(opt.body && !(opt.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), authorization: 'Bearer ' + token },
    body: opt.body && !(opt.body instanceof FormData) ? JSON.stringify(opt.body) : opt.body,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { sair(); throw new Error(j.erro || 'Sessão expirada'); }
  if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
  return j;
}

let tT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('on'), 2600); }
const falha = (e) => toast('⚠ ' + e.message);

// --------------------------------------------------------------- login
function sair() { token = null; try { sessionStorage.removeItem('adm_token'); } catch {} $('#app').hidden = true; $('#tela-login').hidden = false; }
$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  const el = $('#erro-login'); el.hidden = true;
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: $('#senha').value }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { el.textContent = j.erro || 'Falha no login'; el.hidden = false; return; }
  token = j.token; try { sessionStorage.setItem('adm_token', token); } catch {}
  iniciar();
};
$('#sair').onclick = sair;

async function iniciar() {
  $('#tela-login').hidden = true; $('#app').hidden = false;
  try {
    const cfg = await api('config');
    $('#adm-nome').textContent = cfg.nome;
    document.documentElement.style.setProperty('--pri', cfg.cor_primaria);
    document.documentElement.style.setProperty('--dest', cfg.cor_destaque);
    S.cats = await api('categorias');
    abrirAba(S.aba);
  } catch (e) { falha(e); }
}

$('#abas').onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) abrirAba(b.dataset.aba); };
function abrirAba(a) {
  S.aba = a;
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('on', b.dataset.aba === a));
  ({ pedidos: telaPedidos, produtos: telaProdutos, categorias: () => telaCrud('categorias'), regioes: () => telaCrud('regioes'), loja: telaLoja }[a])();
}
const C = () => $('#conteudo');

// --------------------------------------------------------------- pedidos
async function telaPedidos() {
  C().innerHTML = `<div class="cab"><h2>Pedidos</h2>
    <select id="f-status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${S.filtroStatus === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="painel"><p class="vazio">Carregando…</p></div>`;
  $('#f-status').onchange = (e) => { S.filtroStatus = e.target.value; telaPedidos(); };
  try {
    const l = await api('pedidos' + (S.filtroStatus ? '?status=' + S.filtroStatus : ''));
    $('.painel', C()).innerHTML = l.length ? `<table class="tab"><thead><tr><th>Pedido</th><th>Cliente</th><th class="hm">Recebimento</th><th class="hm">Pagamento</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${l.map((p) => `<tr class="clic" data-ped="${p.id}"><td><strong>${esc(p.codigo)}</strong><div class="mini">${data(p.criado_em)}</div></td>
        <td>${esc(p.cliente_nome)}<div class="mini">${fone(p.cliente_telefone)}</div></td>
        <td class="hm">${p.recebimento === 'entrega' ? 'Entrega' + (p.regiao_nome ? ' · ' + esc(p.regiao_nome) : '') : 'Retirada'}</td>
        <td class="hm">${PAG[p.pagamento]}</td><td><strong>${brl(p.total)}</strong><div class="mini">${p.qtd_itens} itens</div></td>
        <td><span class="tag ${p.status}">${STATUS[p.status]}</span></td></tr>`).join('')}</tbody></table>`
      : '<p class="vazio">Nenhum pedido ainda.</p>';
  } catch (e) { falha(e); }
}

async function abrirPedido(id) {
  const p = await api('pedidos/' + id).catch(falha);
  if (!p) return;
  const dlg = $('#dlg');
  const tel = String(p.cliente_telefone).replace(/\D/g, '');
  dlg.innerHTML = `<div class="ped">
    <button class="fechar" data-x>×</button>
    <h3>Pedido ${esc(p.codigo)}</h3>
    <div class="mini">${data(p.criado_em)}</div>
    <div><strong>${esc(p.cliente_nome)}</strong> · <a href="https://wa.me/${tel.length <= 11 ? '55' + tel : tel}" target="_blank" rel="noopener">${fone(p.cliente_telefone)} (WhatsApp)</a></div>
    <div>${p.recebimento === 'entrega' ? `<strong>Entrega</strong>${p.regiao_nome ? ' · ' + esc(p.regiao_nome) : ''}<br>${esc(p.endereco)}${p.referencia ? '<br>Ref.: ' + esc(p.referencia) : ''}` : '<strong>Retirada na loja</strong>'}</div>
    <div><strong>Pagamento:</strong> ${PAG[p.pagamento]}${p.troco_para ? ' · troco para ' + brl(p.troco_para) : ''}</div>
    ${p.observacoes ? `<div><strong>Obs.:</strong> ${esc(p.observacoes)}</div>` : ''}
    <table class="tab"><thead><tr><th>Item</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
      ${p.itens.map((i) => `<tr><td>${esc(i.nome)}${i.variacao ? `<div class="mini">${esc(i.variacao)}</div>` : ''}<div class="mini">${brl(i.preco_unit)} /${esc(i.unidade)}</div></td><td>${i.quantidade}</td><td>${brl(i.total)}</td></tr>`).join('')}
      <tr><td colspan="2">Subtotal</td><td>${brl(p.subtotal)}</td></tr>
      ${p.recebimento === 'entrega' ? `<tr><td colspan="2">Entrega</td><td>${p.taxa_entrega ? brl(p.taxa_entrega) : 'Grátis'}</td></tr>` : ''}
      <tr><td colspan="2"><strong>Total</strong></td><td><strong>${brl(p.total)}</strong></td></tr></tbody></table>
    <div class="campo"><label for="p-status">Status</label><select id="p-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="mini">Cancelar devolve ao estoque os itens com estoque controlado.</p>
    <button class="btn" data-salvar-status>Salvar status</button></div>`;
  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.matches('[data-x]')) return dlg.close();
    if (e.target.matches('[data-salvar-status]')) {
      try { await api('pedidos/' + id, { method: 'PUT', body: { status: $('#p-status').value } }); toast('Status atualizado'); dlg.close(); telaPedidos(); }
      catch (er) { falha(er); }
    }
  };
  dlg.showModal();
}

// --------------------------------------------------------------- produtos
async function telaProdutos() {
  C().innerHTML = `<div class="cab"><h2>Produtos</h2><input id="f-busca" type="search" placeholder="Buscar…" value="${esc(S.busca)}"><button class="btn" data-novo>+ Novo produto</button></div>
    <div class="painel"><p class="vazio">Carregando…</p></div>`;
  $('#f-busca').oninput = (e) => { S.busca = e.target.value; listaProdutos(); };
  try { S.produtos = await api('produtos'); listaProdutos(); } catch (e) { falha(e); }
}
function listaProdutos() {
  const t = S.busca.toLowerCase();
  const l = S.produtos.filter((p) => !t || `${p.nome} ${p.sku || ''} ${p.marca || ''}`.toLowerCase().includes(t));
  $('.painel', C()).innerHTML = l.length ? `<table class="tab"><thead><tr><th></th><th>Produto</th><th class="hm">Categoria</th><th>Preço</th><th class="hm">Estoque</th><th>Situação</th></tr></thead><tbody>
    ${l.map((p) => `<tr class="clic" data-prod="${p.id}">
      <td>${p.imagens[0] ? `<img src="${esc(p.imagens[0].url)}" alt="">` : '<div class="placeholder">—</div>'}</td>
      <td><strong>${esc(p.nome)}</strong><div class="mini">${[p.marca, p.sku, p.variacoes.filter((v) => v.ativo).length ? p.variacoes.filter((v) => v.ativo).length + ' variações' : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td class="hm">${esc(p.categoria || '—')}</td><td>${brl(p.preco)}</td>
      <td class="hm">${p.variacoes.some((v) => v.ativo && v.estoque != null) ? p.variacoes.filter((v) => v.ativo).reduce((s, v) => s + (v.estoque || 0), 0) : p.estoque ?? '—'}</td>
      <td>${p.ativo ? '<span class="tag entregue">Visível</span>' : '<span class="tag off">Oculto</span>'}${p.destaque ? ' <span class="tag">★</span>' : ''}</td></tr>`).join('')}
    </tbody></table>` : '<p class="vazio">Nenhum produto. Clique em "+ Novo produto".</p>';
}

function editorProduto(p) {
  p = p || { nome: '', preco: null, unidade: 'un', qtd_minima: 1, multiplo: 1, ativo: true, destaque: false, imagens: [], specs: [], variacoes: [] };
  const st = { imagens: [...p.imagens], specs: p.specs.map((s) => ({ ...s })), variacoes: p.variacoes.filter((v) => v.ativo !== false).map((v) => ({ ...v })) };

  const fotos = () => `${st.imagens.map((im, i) => `<div class="foto-ed">${i === 0 ? '<span class="capa">Capa</span>' : ''}<img src="${esc(im.url)}" alt="">
      <div class="bar"><button type="button" data-fe="${i}" title="Mover para a esquerda">◀</button><button type="button" data-fx="${i}" title="Remover">✕</button><button type="button" data-fd="${i}" title="Mover para a direita">▶</button></div></div>`).join('')}
    <label class="foto-add">+ Adicionar fotos<input type="file" id="up" accept="image/jpeg,image/png,image/webp" multiple hidden></label>`;
  const specs = () => st.specs.map((s, i) => `<div class="lin spec"><input data-s="${i}" data-k="rotulo" value="${esc(s.rotulo)}" placeholder="Ex.: Composição"><input data-s="${i}" data-k="valor" value="${esc(s.valor)}" placeholder="Ex.: 100% algodão"><button type="button" class="x" data-sx="${i}">×</button></div>`).join('');
  const vars = () => (st.variacoes.length ? '<div class="lin var hd"><span>Opção (tamanho, cor, volume…)</span><span>Preço próprio</span><span>Estoque</span><span>SKU</span><span></span></div>' : '') +
    st.variacoes.map((v, i) => `<div class="lin var"><input data-v="${i}" data-k="nome" value="${esc(v.nome)}" placeholder="Ex.: M / Preto"><input data-v="${i}" data-k="preco" value="${reais(v.preco)}" placeholder="igual ao produto" inputmode="decimal"><input data-v="${i}" data-k="estoque" value="${v.estoque ?? ''}" placeholder="não controla" inputmode="numeric"><input data-v="${i}" data-k="sku" value="${esc(v.sku)}" placeholder="opcional"><button type="button" class="x" data-vx="${i}">×</button></div>`).join('');

  C().innerHTML = `<div class="cab"><h2>${p.id ? 'Editar produto' : 'Novo produto'}</h2><button class="lnk" data-voltar>← Voltar à lista</button></div>
  <form id="fp">
    <div class="secao"><h3>Informações</h3><div class="form-grid">
      <div class="campo c4"><label>Nome *</label><input name="nome" value="${esc(p.nome)}" required></div>
      <div class="campo c2"><label>Categoria</label><select name="categoria_id"><option value="">Sem categoria</option>${S.cats.map((c) => `<option value="${c.id}" ${p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label>Marca</label><input name="marca" value="${esc(p.marca)}"></div>
      <div class="campo"><label>Código / SKU</label><input name="sku" value="${esc(p.sku)}"></div>
      <div class="campo c4"><label>Descrição</label><textarea name="descricao" rows="4">${esc(p.descricao)}</textarea></div>
    </div></div>

    <div class="secao"><h3>Fotos</h3><p class="mini">A primeira foto é a capa. JPG, PNG ou WEBP até 5 MB.</p><div class="fotos" id="fotos">${fotos()}</div></div>

    <div class="secao"><h3>Preço e venda</h3><div class="form-grid">
      <div class="campo"><label>Preço (R$) *</label><input name="preco" value="${reais(p.preco)}" inputmode="decimal" placeholder="0,00" required></div>
      <div class="campo"><label>Preço "de" (R$)</label><input name="preco_antigo" value="${reais(p.preco_antigo)}" inputmode="decimal" placeholder="opcional"></div>
      <div class="campo"><label>Unidade</label><input name="unidade" value="${esc(p.unidade)}" list="unids"><datalist id="unids"><option>un</option><option>cx</option><option>par</option><option>kit</option><option>pct</option><option>kg</option><option>fardo</option></datalist></div>
      <div class="campo"><label>Estoque</label><input name="estoque" value="${p.estoque ?? ''}" inputmode="numeric" placeholder="não controla"></div>
      <div class="campo"><label>Qtd. mínima</label><input name="qtd_minima" value="${p.qtd_minima}" inputmode="numeric"></div>
      <div class="campo"><label>Vende de quanto em quanto</label><input name="multiplo" value="${p.multiplo}" inputmode="numeric"></div>
    </div>
    <label class="chk"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Visível no catálogo</label>
    <label class="chk"><input type="checkbox" name="destaque" ${p.destaque ? 'checked' : ''}> Destaque (aparece primeiro)</label></div>

    <div class="secao"><h3>Variações</h3><p class="mini">Tamanhos, cores, volumes, tons ou embalagens. Se o produto tiver variações, o cliente precisa escolher uma. Quando a variação tem estoque, ele substitui o estoque do produto.</p>
      <div class="linhas" id="vars">${vars()}</div><button type="button" class="btn sec add-lin" data-addv style="width:auto">+ Variação</button>
      <button type="button" class="lnk add-lin" data-grade>Gerar grade de tamanhos…</button></div>

    <div class="secao"><h3>Especificações</h3><p class="mini">Aparecem em tabela na página do produto.</p>
      <div class="linhas" id="specs">${specs()}</div><button type="button" class="btn sec add-lin" data-adds style="width:auto">+ Especificação</button></div>

    <div class="salvar-bar">${p.id ? '<button type="button" class="lnk perigo" data-excluir>Excluir produto</button>' : ''}<button class="btn" id="btn-salvar">Salvar produto</button></div>
  </form>`;

  const form = $('#fp');
  const redrawF = () => { $('#fotos').innerHTML = fotos(); };
  const redrawV = () => { $('#vars').innerHTML = vars(); };
  const redrawS = () => { $('#specs').innerHTML = specs(); };

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.s) st.specs[+t.dataset.s][t.dataset.k] = t.value;
    if (t.dataset.v) st.variacoes[+t.dataset.v][t.dataset.k] = t.value;
  });
  form.addEventListener('change', async (e) => {
    if (e.target.id !== 'up') return;
    const files = [...e.target.files];
    toast(`Enviando ${files.length} foto(s)…`);
    for (const f of files) {
      try {
        const fd = new FormData(); fd.append('arquivo', await reduzir(f));
        st.imagens.push(await api('upload', { method: 'POST', body: fd }));
        redrawF();
      } catch (er) { falha(er); }
    }
    toast('Fotos enviadas');
  });
  form.addEventListener('click', async (e) => {
    const d = e.target.dataset;
    const mover = (i, j) => { if (j < 0 || j >= st.imagens.length) return; [st.imagens[i], st.imagens[j]] = [st.imagens[j], st.imagens[i]]; redrawF(); };
    if (d.fe) mover(+d.fe, +d.fe - 1);
    if (d.fd) mover(+d.fd, +d.fd + 1);
    if (d.fx) { st.imagens.splice(+d.fx, 1); redrawF(); }
    if (d.sx) { st.specs.splice(+d.sx, 1); redrawS(); }
    if (d.vx) { st.variacoes.splice(+d.vx, 1); redrawV(); }
    if ('adds' in d) { st.specs.push({ rotulo: '', valor: '' }); redrawS(); }
    if ('addv' in d) { st.variacoes.push({ nome: '' }); redrawV(); }
    if ('grade' in d) {
      const tam = prompt('Tamanhos separados por vírgula:', 'P, M, G, GG');
      if (tam == null) return;
      const cores = prompt('Cores separadas por vírgula (deixe vazio se não houver):', '') || '';
      const T = tam.split(',').map((s) => s.trim()).filter(Boolean);
      const K = cores.split(',').map((s) => s.trim()).filter(Boolean);
      for (const t of T) for (const k of K.length ? K : [null]) st.variacoes.push({ nome: k ? `${t} / ${k}` : t });
      redrawV();
    }
    if ('excluir' in d) {
      if (!confirm(`Excluir "${p.nome}" e suas fotos? Pedidos antigos continuam com o registro.`)) return;
      try { await api('produtos/' + p.id, { method: 'DELETE' }); toast('Produto excluído'); telaProdutos(); } catch (er) { falha(er); }
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const body = {
      nome: f.nome, categoria_id: f.categoria_id || null, marca: f.marca, sku: f.sku, descricao: f.descricao,
      preco: cent(f.preco), preco_antigo: cent(f.preco_antigo), unidade: f.unidade,
      estoque: f.estoque === '' ? null : +f.estoque, qtd_minima: +f.qtd_minima || 1, multiplo: +f.multiplo || 1,
      ativo: !!f.ativo, destaque: !!f.destaque,
      imagens: st.imagens.map((i) => i.key),
      specs: st.specs,
      variacoes: st.variacoes.map((v) => ({ id: v.id, nome: v.nome, sku: v.sku, preco: cent(v.preco === null || typeof v.preco === 'number' ? reais(v.preco) : v.preco), estoque: v.estoque === '' || v.estoque == null ? null : +v.estoque })),
    };
    if (body.preco == null) return toast('⚠ Informe o preço');
    $('#btn-salvar').disabled = true;
    try {
      const salvo = await api(p.id ? 'produtos/' + p.id : 'produtos', { method: p.id ? 'PUT' : 'POST', body });
      toast('Produto salvo'); editorProduto(salvo);
    } catch (er) { falha(er); $('#btn-salvar').disabled = false; }
  };
  $('[data-voltar]').onclick = telaProdutos;
  window.scrollTo(0, 0);
}

// reduz fotos grandes no navegador antes de enviar (máx. 1600 px)
async function reduzir(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600, esc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (esc === 1 && file.size < 900 * 1024) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp' }) : file;
  } catch { return file; }
}

// --------------------------------------------------------------- categorias e regiões
const CRUD = {
  categorias: { titulo: 'Categorias', cols: [['nome', 'Nome'], ['ordem', 'Ordem', 'num']] },
  regioes: { titulo: 'Regiões de entrega', cols: [['nome', 'Região / bairro'], ['taxa', 'Taxa (R$)', 'din'], ['gratis_acima', 'Grátis acima de (R$)', 'din'], ['prazo', 'Prazo'], ['ordem', 'Ordem', 'num']] },
};
async function telaCrud(rec) {
  const cfg = CRUD[rec];
  let l = [];
  try { l = await api(rec); } catch (e) { return falha(e); }
  const cel = (r, [k, , t]) => `<td><input data-k="${k}" value="${t === 'din' ? reais(r[k]) : esc(r[k] ?? '')}" ${t ? 'inputmode="decimal"' : ''} style="width:100%;border:1.5px solid var(--bd);border-radius:8px;padding:7px 9px"></td>`;
  C().innerHTML = `<div class="cab"><h2>${cfg.titulo}</h2></div>
    ${rec === 'regioes' ? '<p class="mini">Deixe "grátis acima de" vazio para nunca ser grátis. Sem nenhuma região ativa, a entrega não cobra taxa.</p>' : ''}
    <div class="painel"><table class="tab"><thead><tr>${cfg.cols.map((c) => `<th>${c[1]}</th>`).join('')}<th>Ativo</th><th></th></tr></thead><tbody>
    ${[...l, { id: 0, ativo: 1 }].map((r) => `<tr data-id="${r.id}">${cfg.cols.map((c) => cel(r, c)).join('')}
      <td><input type="checkbox" data-k="ativo" ${r.ativo ? 'checked' : ''}></td>
      <td style="white-space:nowrap"><button class="lnk" data-salvar>${r.id ? 'Salvar' : 'Adicionar'}</button>${r.id ? '<button class="lnk perigo" data-del>Excluir</button>' : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  C().onclick = async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = +tr.dataset.id;
    if (e.target.matches('[data-del]')) {
      if (!confirm('Excluir este registro?')) return;
      try { await api(`${rec}/${id}`, { method: 'DELETE' }); toast('Excluído'); telaCrud(rec); } catch (er) { falha(er); }
    }
    if (e.target.matches('[data-salvar]')) {
      const b = {};
      tr.querySelectorAll('[data-k]').forEach((i) => {
        const col = cfg.cols.find((c) => c[0] === i.dataset.k);
        b[i.dataset.k] = i.type === 'checkbox' ? i.checked : col?.[2] === 'din' ? cent(i.value) : i.value;
      });
      try { await api(id ? `${rec}/${id}` : rec, { method: id ? 'PUT' : 'POST', body: b }); toast('Salvo'); if (rec === 'categorias') S.cats = await api('categorias'); telaCrud(rec); }
      catch (er) { falha(er); }
    }
  };
}

// --------------------------------------------------------------- loja & pix
async function telaLoja() {
  let c;
  try { c = await api('config'); } catch (e) { return falha(e); }
  const chk = (k, t) => `<label class="chk"><input type="checkbox" name="${k}" ${c[k] ? 'checked' : ''}> ${t}</label>`;
  const inp = (k, t, extra = '', cls = '') => `<div class="campo ${cls}"><label>${t}</label><input name="${k}" value="${esc(c[k])}" ${extra}></div>`;
  C().onclick = null;
  C().innerHTML = `<div class="cab"><h2>Loja &amp; Pix</h2></div><form id="fl">
    <div class="secao"><h3>Identidade</h3><div class="form-grid">
      ${inp('nome', 'Nome da loja', 'required', 'c2')}${inp('slogan', 'Frase abaixo do nome', '', 'c2')}
      <div class="campo"><label>Segmento</label><select name="segmento">${['roupas', 'perfumaria', 'cosmeticos', 'distribuidora', 'misto'].map((s) => `<option ${c.segmento === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="campo"><label>Cor principal</label><input type="color" name="cor_primaria" value="${esc(c.cor_primaria)}" style="height:40px;padding:2px"></div>
      <div class="campo"><label>Cor de destaque</label><input type="color" name="cor_destaque" value="${esc(c.cor_destaque)}" style="height:40px;padding:2px"></div>
      <div class="campo"><label>Logo</label><input type="file" id="logo-up" accept="image/*"><input type="hidden" name="logo_key" value="${esc(c.logo_key)}"></div>
      ${c.logo_key ? `<div class="campo c4"><img src="${/^https?:/.test(c.logo_key) ? esc(c.logo_key) : '/img/' + esc(c.logo_key)}" alt="Logo" style="height:56px;width:auto"></div>` : ''}
    </div></div>
    <div class="secao"><h3>Contato e atendimento</h3><div class="form-grid">
      ${inp('whatsapp', 'WhatsApp que recebe os pedidos', 'placeholder="(34) 99999-9999" required inputmode="tel"', 'c2')}
      ${inp('instagram', 'Instagram (sem @)', '', 'c2')}
      ${inp('endereco_loja', 'Endereço da loja (retirada)', '', 'c4')}
      ${inp('horario', 'Horário de atendimento', 'placeholder="Seg a Sex 08:00–18:00"', 'c4')}
      ${inp('aviso_topo', 'Avisos da faixa do topo (separe com |)', 'placeholder="Frete grátis acima de R$ 150|Entrega no mesmo dia"', 'c4')}
    </div><p class="mini">WhatsApp: DDD + número, ex.: (34) 99769-3393. O 55 do Brasil é acrescentado automaticamente.</p></div>
    <div class="secao"><h3>Entrega e retirada</h3><div class="form-grid">
      <div class="campo"><label>Pedido mínimo p/ entrega (R$)</label><input name="pedido_minimo" value="${reais(c.pedido_minimo)}" inputmode="decimal"></div></div>
      ${chk('permite_entrega', 'Fazemos entrega')}${chk('permite_retirada', 'Cliente pode retirar na loja')}</div>
    <div class="secao"><h3>Pagamento</h3>
      ${chk('pix_ativo', 'Aceitar Pix')}
      <div class="form-grid">
        <div class="campo c2"><label>Como o cliente paga o Pix</label><select name="pix_modo">
          <option value="ambos" ${c.pix_modo === 'ambos' ? 'selected' : ''}>Cliente escolhe: chave automática ou atendente</option>
          <option value="chave" ${c.pix_modo === 'chave' ? 'selected' : ''}>Sempre enviar a chave cadastrada</option>
          <option value="atendente" ${c.pix_modo === 'atendente' ? 'selected' : ''}>Sempre finalizar com o atendente</option></select></div>
        <div class="campo"><label>Tipo de chave</label><select name="pix_tipo">${[['cpf', 'CPF'], ['cnpj', 'CNPJ'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['aleatoria', 'Aleatória']].map(([v, t]) => `<option value="${v}" ${c.pix_tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${inp('pix_chave', 'Chave Pix')}
        ${inp('pix_titular', 'Nome do favorecido', '', 'c2')}${inp('pix_banco', 'Banco')}${inp('pix_cidade', 'Cidade do favorecido')}
      </div>
      <p class="mini">Com a chave cadastrada, o cliente recebe ao enviar o pedido um QR Code e um Pix copia e cola já com o valor e o número do pedido. Confira o nome e a cidade como estão no banco.</p>
      ${chk('aceita_cartao', 'Cartão na entrega')}${chk('aceita_dinheiro', 'Dinheiro')}
    </div>
    <div class="salvar-bar"><button class="btn">Salvar configurações</button></div></form>`;

  $('#logo-up').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const fd = new FormData(); fd.append('arquivo', await reduzir(f)); const r = await api('upload', { method: 'POST', body: fd }); $('[name=logo_key]').value = r.key; toast('Logo enviada. Clique em salvar.'); }
    catch (er) { falha(er); }
  };
  $('#fl').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const b = Object.fromEntries(fd);
    for (const k of ['permite_entrega', 'permite_retirada', 'pix_ativo', 'aceita_cartao', 'aceita_dinheiro']) b[k] = fd.has(k);
    b.pedido_minimo = cent(b.pedido_minimo) || 0;
    try { const r = await api('config', { method: 'PUT', body: b }); $('#adm-nome').textContent = r.nome; toast('Configurações salvas'); telaLoja(); } catch (er) { falha(er); }
  };
}

// --------------------------------------------------------------- cliques gerais
document.addEventListener('click', async (e) => {
  const ped = e.target.closest('[data-ped]'); if (ped) return abrirPedido(+ped.dataset.ped);
  const pr = e.target.closest('[data-prod]');
  if (pr) { try { editorProduto(await api('produtos/' + pr.dataset.prod)); } catch (er) { falha(er); } return; }
  if (e.target.closest('[data-novo]')) editorProduto(null);
});

if (token) iniciar(); else sair();
