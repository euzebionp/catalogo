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
const S = { aba: 'pedidos', cats: [], produtos: [], busca: '', filtroStatus: '', eu: null };
const pode = (acao) => !!S.eu?.permissoes?.includes(acao);

const STATUS = { novo: 'Novo', confirmado: 'Confirmado', pago: 'Pago', preparando: 'Preparando', saiu: 'Saiu p/ entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAG = { pix_chave: 'Pix (chave)', pix_atendente: 'Pix (atendente)', cartao: 'Cartão na entrega', dinheiro: 'Dinheiro' };

async function api(path, opt = {}) {
  const r = await fetch('/api/admin/' + path, {
    ...opt,
    headers: { ...(opt.body && !(opt.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), authorization: 'Bearer ' + token },
    body: opt.body && !(opt.body instanceof FormData) ? JSON.stringify(opt.body) : opt.body,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { sair(); const el = $('#erro-login'); el.textContent = j.erro || 'Sessão expirada'; el.hidden = false; throw new Error(j.erro || 'Sessão expirada'); }
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
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('#email').value.trim(), senha: $('#senha').value }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { el.textContent = j.erro || 'Falha no login'; el.hidden = false; return; }
  guardarToken(j.token); $('#senha').value = '';
  iniciar();
};
function guardarToken(t) { token = t; try { sessionStorage.setItem('adm_token', t); } catch {} }
$('#sair').onclick = sair;
$('#minha-senha').onclick = () => trocarSenha(false);

// troca de senha (obrigatória quando a senha é provisória)
function trocarSenha(obrigatoria) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form class="ped" id="f-senha"><h3>${obrigatoria ? 'Crie sua senha' : 'Trocar minha senha'}</h3>
    ${obrigatoria ? '<p class="mini">Sua senha atual é provisória. Escolha uma senha só sua para continuar.</p>' : ''}
    <div class="campo"><label>Senha atual</label><input type="password" name="atual" autocomplete="current-password" required></div>
    <div class="campo"><label>Nova senha</label><input type="password" name="nova" autocomplete="new-password" minlength="8" required></div>
    <div class="campo"><label>Repita a nova senha</label><input type="password" name="nova2" autocomplete="new-password" required></div>
    <p class="mini">Pelo menos 8 caracteres, com letras e números.</p>
    <p class="erro-msg" id="e-senha" hidden></p>
    <button class="btn">Salvar senha</button>${obrigatoria ? '' : '<button type="button" class="btn sec" data-x>Cancelar</button>'}</form>`;
  dlg.onclick = (e) => { if (e.target.matches('[data-x]') || (!obrigatoria && e.target === dlg)) dlg.close(); };
  dlg.oncancel = (e) => { if (obrigatoria) e.preventDefault(); };
  $('#f-senha').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), er = $('#e-senha');
    if (f.nova !== f.nova2) { er.textContent = 'As senhas não conferem.'; er.hidden = false; return; }
    try {
      const r = await api('minha-senha', { method: 'POST', body: { atual: f.atual, nova: f.nova } });
      guardarToken(r.token); dlg.close(); toast('Senha alterada');
      if (obrigatoria) iniciar();
    } catch (x) { er.textContent = x.message; er.hidden = false; }
  };
  dlg.showModal();
}

// primeiro acesso: criar o Administrador master
function telaConfiguracaoInicial() {
  document.querySelectorAll('#abas button').forEach((b) => (b.hidden = true));
  $('#minha-senha').hidden = true;
  C().onclick = null;
  C().innerHTML = `<div class="secao" style="max-width:560px;margin:24px auto">
    <h2>Criar o Administrador master</h2>
    <p>Você entrou com a senha mestra. Crie agora a conta do <strong>Administrador master</strong>: ela gerencia tudo, inclusive os outros usuários. Depois disso a senha mestra deixa de funcionar e cada pessoa entra com o próprio e-mail.</p>
    <form id="f-master">
      <div class="campo"><label>Nome</label><input name="nome" required></div>
      <div class="campo"><label>E-mail</label><input name="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label>Senha</label><input name="senha" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="campo"><label>Repita a senha</label><input name="senha2" type="password" autocomplete="new-password" required></div>
      <p class="mini">Pelo menos 8 caracteres, com letras e números.</p>
      <p class="erro-msg" id="e-master" hidden></p>
      <button class="btn">Criar e entrar</button>
    </form></div>`;
  $('#f-master').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), er = $('#e-master');
    if (f.senha !== f.senha2) { er.textContent = 'As senhas não conferem.'; er.hidden = false; return; }
    try {
      await api('usuarios', { method: 'POST', body: { nome: f.nome, email: f.email, senha: f.senha, papel: 'master' } });
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.email, senha: f.senha }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha ao entrar');
      guardarToken(j.token); toast('Administrador master criado');
      iniciar();
    } catch (x) { er.textContent = x.message; er.hidden = false; }
  };
}

async function iniciar() {
  $('#tela-login').hidden = true; $('#app').hidden = false;
  try {
    S.eu = await api('eu');
    $('#eu-nome').textContent = `${S.eu.nome} · ${S.eu.papel_nome}`;
    $('#minha-senha').hidden = !!S.eu.configurar_usuarios;
    if (S.eu.trocar_senha) { document.querySelectorAll('#abas button').forEach((b) => (b.hidden = true)); C().innerHTML = ''; return trocarSenha(true); }
    const cfg = await api('config');
    $('#adm-nome').textContent = cfg.nome;
    if (S.eu.configurar_usuarios) return telaConfiguracaoInicial();
    // mostra só as abas que o papel permite
    const ABAS = { pedidos: 'pedidos.ver', produtos: 'produtos.ver', categorias: 'cadastros.editar', regioes: 'cadastros.editar', loja: 'loja.editar', integracao: 'integracao', usuarios: 'usuarios' };
    document.querySelectorAll('#abas button').forEach((b) => (b.hidden = !pode(ABAS[b.dataset.aba])));
    if (!pode(ABAS[S.aba])) S.aba = 'pedidos';
    document.documentElement.style.setProperty('--pri', cfg.cor_primaria);
    document.documentElement.style.setProperty('--dest', cfg.cor_destaque);
    S.cats = await api('categorias');
    const h = decodeURIComponent(location.hash || '');
    if (h.startsWith('#integracao')) {
      const msg = h.split('=')[1];
      history.replaceState(null, '', location.pathname);
      S.aba = 'integracao';
      if (msg) toast(msg === 'ok' ? 'TagPlus conectado!' : '⚠ ' + msg);
    }
    abrirAba(S.aba);
  } catch (e) { falha(e); }
}

$('#abas').onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) abrirAba(b.dataset.aba); };
function abrirAba(a) {
  S.aba = a;
  C().onclick = null;
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('on', b.dataset.aba === a));
  ({ pedidos: telaPedidos, produtos: telaProdutos, categorias: () => telaCrud('categorias'), regioes: () => telaCrud('regioes'), loja: telaLoja, integracao: telaIntegracao, usuarios: telaUsuarios }[a])();
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
    ${p.cliente_cpf_cnpj ? `<div><strong>CPF/CNPJ na nota:</strong> ${esc(p.cliente_cpf_cnpj)}</div>` : ''}
    <div class="secao" id="bloco-erp" style="margin:0;padding:12px 14px"><strong>TagPlus</strong>
      <div class="mini">Pedido no ERP: ${p.tagplus_pedido_id ? '#' + p.tagplus_pedido_id : p.erp_status === 'pendente' ? 'na fila' : p.erp_status === 'erro' ? '<span class="tag cancelado">erro (veja Integração)</span>' : 'não enviado'}
      · Nota: ${p.nf_status ? `${(p.nf_tipo || '').toUpperCase()} ${p.nf_numero ? 'nº ' + esc(p.nf_numero) : ''} <span class="tag ${p.nf_status === 'autorizada' ? 'entregue' : p.nf_status === 'rejeitada' ? 'cancelado' : 'novo'}">${esc(p.nf_status)}</span>` : 'não emitida'}
      ${p.nf_url ? ` · <a href="${esc(p.nf_url)}" target="_blank" rel="noopener">DANFE</a>` : ''}${p.nf_erro ? `<div class="mini" style="color:var(--err)">${esc(p.nf_erro)}</div>` : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${p.tagplus_pedido_id ? '' : '<button class="btn sec" style="width:auto" data-erp>Enviar ao TagPlus</button>'}
        ${p.nf_status === 'autorizada' ? '' : '<button class="btn sec" style="width:auto" data-nota="nfce">Emitir NFC-e</button><button class="btn sec" style="width:auto" data-nota="nfe">Emitir NF-e</button>'}
      </div></div>
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
    if (e.target.matches('[data-erp]') || e.target.dataset.nota) {
      e.target.disabled = true;
      try {
        const r = e.target.dataset.nota
          ? await api(`pedidos/${id}/emitir-nota`, { method: 'POST', body: { tipo: e.target.dataset.nota } })
          : await api(`pedidos/${id}/enviar-erp`, { method: 'POST' });
        toast(r.fila?.falhas ? 'Enviado à fila, mas o TagPlus recusou. Veja a aba Integração.' : 'Enviado ao TagPlus');
        dlg.close(); abrirPedido(id);
      } catch (er) { falha(er); e.target.disabled = false; }
      return;
    }
    if (e.target.matches('[data-salvar-status]')) {
      try { await api('pedidos/' + id, { method: 'PUT', body: { status: $('#p-status').value } }); toast('Status atualizado'); dlg.close(); telaPedidos(); }
      catch (er) { falha(er); }
    }
  };
  if (!pode('pedidos.erp')) $('#bloco-erp')?.remove();
  dlg.showModal();
}

// --------------------------------------------------------------- produtos
async function telaProdutos() {
  C().innerHTML = `<div class="cab"><h2>Produtos</h2><input id="f-busca" type="search" placeholder="Buscar…" value="${esc(S.busca)}">${pode('produtos.editar') ? '<label class="btn sec" style="width:auto;cursor:pointer">Importar planilha<input type="file" id="imp-arq" accept=".xlsx,.xls,.csv" hidden></label><a class="lnk" href="/modelo-importacao-catalogo.xlsx" download>Baixar modelo</a><button class="btn" data-novo>+ Novo produto</button>' : ''}</div>
    <div class="painel"><p class="vazio">Carregando…</p></div>`;
  $('#f-busca').oninput = (e) => { S.busca = e.target.value; listaProdutos(); };
  if ($('#imp-arq')) $('#imp-arq').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importarPlanilha(f); };
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
      <div class="campo"><label>Código do produto (planilha)</label><input name="codigo" value="${esc(p.codigo)}"></div>
      <div class="campo"><label>NCM</label><input name="ncm" value="${esc(p.ncm)}" inputmode="numeric" maxlength="10"></div>
      <div class="campo"><label>CEST</label><input name="cest" value="${esc(p.cest)}" inputmode="numeric" maxlength="9"></div>
      <div class="campo"><label>ID no TagPlus</label><input name="tagplus_id" value="${p.tagplus_id ?? ''}" inputmode="numeric" placeholder="vínculo com o ERP"></div>
      <div class="campo c4"><label>Descrição</label><textarea name="descricao" rows="4">${esc(p.descricao)}</textarea></div>
    </div></div>

    <div class="secao"><h3>Fotos</h3><p class="mini">A primeira foto é a capa. JPG, PNG ou WEBP até 5 MB.</p><div class="fotos" id="fotos">${fotos()}</div></div>

    <div class="secao"><h3>Preço e venda</h3><div class="form-grid">
      <div class="campo"><label>Preço (R$) *</label><input name="preco" value="${reais(p.preco)}" inputmode="decimal" placeholder="0,00" required></div>
      ${pode('produtos.custo') ? `<div class="campo"><label>Custo total (R$)</label><input name="custo" value="${reais(p.custo)}" inputmode="decimal" placeholder="da planilha"></div>` : ''}
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

    ${pode('produtos.editar') ? `<div class="salvar-bar">${p.id ? '<button type="button" class="lnk perigo" data-excluir>Excluir produto</button>' : ''}<button class="btn" id="btn-salvar">Salvar produto</button></div>` : '<p class="mini">Somente consulta: seu usuário não altera produtos.</p>'}
  </form>`;

  const form = $('#fp');
  if (!pode('produtos.editar')) form.querySelectorAll('input,select,textarea,button,label.foto-add').forEach((el) => { el.disabled = true; if (el.matches('label.foto-add,[data-addv],[data-adds],[data-grade],.x,.bar button')) el.hidden = true; });
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
      codigo: f.codigo, ncm: f.ncm, cest: f.cest, custo: cent(f.custo), tagplus_id: f.tagplus_id === '' ? null : +f.tagplus_id,
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
      ${inp('instagram', 'Instagram (nome do perfil ou link, sem acentos)', '', 'c2')}
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


// --------------------------------------------------------------- importação da planilha
async function importarPlanilha(arquivo) {
  if (!window.XLSX) return toast('⚠ Leitor de planilhas não carregou. Recarregue a página.');
  let linhas;
  try {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const aba = wb.Sheets['Importacao'] || wb.Sheets[wb.SheetNames[0]];
    linhas = XLSX.utils.sheet_to_json(aba, { defval: '', raw: true }).filter((l) => String(l.codigo_produto || '').trim());
  } catch (e) { return toast('⚠ Não consegui ler o arquivo: ' + e.message); }
  if (!linhas.length) return toast('⚠ Nenhuma linha com "codigo_produto" na aba Importacao. Abra e salve a planilha no Excel antes de importar.');
  const grupos = new Set(linhas.map((l) => String(l.codigo_produto).trim())).size;
  if (!confirm(`Importar ${linhas.length} linha(s), ${grupos} produto(s)? Produtos com o mesmo código serão atualizados.`)) return;
  toast('Importando…');
  try {
    const r = await api('importar', { method: 'POST', body: { linhas } });
    const msg = `Importação concluída: ${r.criados} novo(s), ${r.atualizados} atualizado(s).` + (r.erros.length ? `\n\n${r.erros.length} linha(s) com problema:\n` + r.erros.slice(0, 15).join('\n') : '');
    alert(msg);
    telaProdutos();
  } catch (e) { falha(e); }
}

// --------------------------------------------------------------- integração TagPlus
const dataHora = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
async function telaIntegracao() {
  C().onclick = null;
  C().innerHTML = '<div class="cab"><h2>Integração TagPlus</h2></div><p class="vazio">Carregando…</p>';
  let st;
  try { st = await api('tagplus/status'); } catch (e) { return falha(e); }
  const o = st.opcoes, fila = st.fila || {};
  const chk = (k, t) => `<label class="chk"><input type="checkbox" data-op="${k}" ${o[k] ? 'checked' : ''}> ${t}</label>`;
  const PAGS = [['pix_chave', 'Pix (chave)'], ['pix_atendente', 'Pix (atendente)'], ['cartao', 'Cartão na entrega'], ['dinheiro', 'Dinheiro']];
  C().innerHTML = `<div class="cab"><h2>Integração TagPlus</h2>
      ${st.conectado ? '<span class="tag entregue">Conectado</span>' : st.configurado ? '<span class="tag novo">Não conectado</span>' : '<span class="tag cancelado">Não configurado</span>'}</div>
    ${!st.configurado ? `<div class="secao"><h3>1. Cadastre o app no TagPlus</h3>
      <p>Em <a href="https://developers.tagplus.com.br/" target="_blank" rel="noopener">developers.tagplus.com.br</a> → Cadastrar → Aplicativos → Novo App. Use como <strong>URL de retorno</strong>:</p>
      <p><code>${esc(st.urls.retorno)}</code> <button class="lnk" data-copia="${esc(st.urls.retorno)}">copiar</button></p>
      <p>Depois, na Cloudflare (Worker <em>catalogo</em> → Settings → Variables and Secrets), crie os segredos <code>TAGPLUS_CLIENT_ID</code> e <code>TAGPLUS_CLIENT_SECRET</code> com os dados do app.</p></div>` : ''}
    <div class="secao"><h3>Conexão</h3>
      ${st.conectado ? `<p>Conta: <strong>${esc(st.conta?.usuario || st.conta?.sistema || 'TagPlus')}</strong> · conectada em ${st.conta?.conectado_em ? new Date(st.conta.conectado_em).toLocaleString('pt-BR') : '—'}</p>
        <p class="mini">Token renova sozinho. Acesso expira em ${dataHora(st.token_expira_em)} · renovação válida até ${dataHora(st.refresh_expira_em)}.</p>
        <button class="lnk perigo" data-desconectar>Desconectar</button>`
      : `<p class="mini">Você será levado ao TagPlus para informar o endereço do seu sistema (app.tagplus.com.br/SEU_SISTEMA) e autorizar o acesso.</p>
        <button class="btn" style="width:auto" data-conectar ${st.configurado ? '' : 'disabled'}>Conectar ao TagPlus</button>`}
    </div>
    <div class="secao"><h3>Webhook (atualização em tempo real)</h3>
      <p class="mini">No TagPlus: menu Extras → API → Webhook → nova integração. URL de callback:</p>
      <p><code>${esc(st.urls.webhook)}</code> <button class="lnk" data-copia="${esc(st.urls.webhook)}">copiar</button></p>
      <p class="mini">No campo X-Hub-Secret, use o mesmo valor do segredo <code>TAGPLUS_WEBHOOK_SECRET</code> do Worker ${st.webhook_configurado ? '(<span style="color:var(--ok)">configurado</span>)' : '(<span style="color:var(--err)">ainda não criado</span>)'}. Marque os eventos de produto, estoque, pedido, NF-e e NFC-e.</p></div>
    <div class="secao"><h3>Produtos e estoque</h3>
      <p>${st.produtos_vinculados} produto(s) vinculados ao TagPlus · última sincronização: ${esc(st.ultima_sincronizacao || 'nunca')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" style="width:auto" data-sync ${st.conectado ? '' : 'disabled'}>Buscar alterações agora</button>
      <button class="btn sec" style="width:auto" data-sync-completo ${st.conectado ? '' : 'disabled'}>Sincronização completa</button></div></div>
    <div class="secao"><h3>Regras</h3>
      ${chk('enviar_ao_confirmar', 'Ao marcar o pedido como "Confirmado", enviar ao TagPlus')}
      ${chk('emitir_nota_ao_confirmar', 'E já solicitar a nota fiscal')}
      <div class="campo" style="max-width:260px"><label>Nota padrão</label><select data-op-sel="tipo_nota"><option value="nfce" ${o.tipo_nota !== 'nfe' ? 'selected' : ''}>NFC-e (consumidor)</option><option value="nfe" ${o.tipo_nota === 'nfe' ? 'selected' : ''}>NF-e</option></select></div>
      ${chk('sincronizar_automatico', 'Buscar produtos alterados a cada 10 minutos')}
      ${chk('manter_preco_catalogo', 'Manter o preço do catálogo (não sobrescrever com o do TagPlus)')}
      ${chk('manter_nome_catalogo', 'Manter o nome do catálogo')}
      ${chk('novos_ocultos', 'Produto novo vindo do TagPlus sem foto entra oculto')}
      <h3 style="margin-top:14px">Formas de pagamento no TagPlus</h3><p class="mini">ID da forma de pagamento no TagPlus para cada opção do catálogo (veja em Diagnóstico → formas_pagamento). Vazio = o pedido vai sem fatura.</p>
      <div class="form-grid">${PAGS.map(([k, t]) => `<div class="campo"><label>${t}</label><input data-fp="${k}" value="${esc(o.formas_pagamento?.[k] ?? '')}" inputmode="numeric"></div>`).join('')}</div>
      <button class="btn" style="width:auto;margin-top:12px" data-salvar-op>Salvar regras</button></div>
    <div class="secao"><h3>Fila</h3>
      <p>Pendentes: ${fila.pendente || 0} · processando: ${fila.processando || 0} · concluídas: ${fila.ok || 0} · com erro: ${fila.erro || 0}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" style="width:auto" data-fila>Processar agora</button>${fila.erro ? '<button class="btn sec" style="width:auto" data-reprocessar>Tentar de novo os com erro</button>' : ''}</div>
      ${st.erros_fila.length ? `<table class="tab" style="margin-top:10px"><thead><tr><th>Tarefa</th><th>Ref.</th><th>Erro</th></tr></thead><tbody>${st.erros_fila.map((f) => `<tr><td>${esc(f.tipo)}</td><td>${esc(f.ref_id)}</td><td class="mini">${esc(f.erro)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="secao"><h3>Diagnóstico</h3><p class="mini">Mostra o JSON que o TagPlus devolve, para conferir os nomes de campos usados em <code>src/tagplus/mapa.js</code>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><div class="campo"><label>Recurso</label><select id="dg-rec">${['produtos', 'pedidos', 'nfces', 'nfes', 'clientes', 'formas_pagamento', 'categorias', 'webhooks', 'me'].map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div class="campo"><label>ID (opcional)</label><input id="dg-id" inputmode="numeric" style="width:120px"></div><button class="btn sec" style="width:auto" data-diag ${st.conectado ? '' : 'disabled'}>Consultar</button></div>
      <pre id="dg-out" style="max-height:360px;overflow:auto;background:var(--bg);padding:10px;border-radius:8px;font-size:12px;display:none"></pre></div>
    <div class="secao"><h3>Registro</h3>${st.log.length ? `<table class="tab"><thead><tr><th>Quando</th><th>Origem</th><th>Evento</th><th>Ref.</th><th>Detalhe</th></tr></thead><tbody>${st.log.map((l) => `<tr><td class="mini">${data(l.criado_em)}</td><td>${esc(l.origem)}</td><td>${l.ok ? '' : '⚠ '}${esc(l.evento)}</td><td class="mini">${esc(l.ref || '')}</td><td class="mini" style="max-width:360px;word-break:break-word">${esc((l.detalhe || '').slice(0, 220))}</td></tr>`).join('')}</tbody></table>` : '<p class="mini">Nada registrado ainda.</p>'}</div>`;

  C().onclick = async (e) => {
    const t = e.target, acao = async (fn, ok) => { t.disabled = true; try { const r = await fn(); if (ok) toast(ok(r)); telaIntegracao(); } catch (er) { falha(er); t.disabled = false; } };
    if (t.dataset.copia) { navigator.clipboard?.writeText(t.dataset.copia); toast('Copiado'); }
    if ('conectar' in t.dataset) { t.disabled = true; try { location.href = (await api('tagplus/conectar')).url; } catch (er) { falha(er); t.disabled = false; } }
    if ('desconectar' in t.dataset && confirm('Desconectar do TagPlus? Pedidos e produtos param de sincronizar.')) acao(() => api('tagplus/desconectar', { method: 'POST' }), () => 'Desconectado');
    if ('sync' in t.dataset) acao(() => api('tagplus/sincronizar', { method: 'POST', body: {} }), (r) => `${r.produtos} produto(s) atualizados`);
    if ('syncCompleto' in t.dataset && confirm('Buscar todos os produtos do TagPlus? Pode levar alguns minutos.')) acao(() => api('tagplus/sincronizar', { method: 'POST', body: { completo: true } }), (r) => `${r.produtos} produto(s) sincronizados`);
    if ('fila' in t.dataset) acao(() => api('tagplus/processar-fila', { method: 'POST' }), (r) => `${r.processadas} tarefa(s) processadas`);
    if ('reprocessar' in t.dataset) acao(() => api('tagplus/reprocessar', { method: 'POST' }), (r) => `${r.ok || 0} ok, ${r.falhas || 0} com erro`);
    if ('salvarOp' in t.dataset) {
      const b = { formas_pagamento: {} };
      C().querySelectorAll('[data-op]').forEach((i) => (b[i.dataset.op] = i.checked));
      C().querySelectorAll('[data-op-sel]').forEach((i) => (b[i.dataset.opSel] = i.value));
      C().querySelectorAll('[data-fp]').forEach((i) => { if (i.value.trim()) b.formas_pagamento[i.dataset.fp] = +i.value; });
      acao(() => api('tagplus/opcoes', { method: 'PUT', body: b }), () => 'Regras salvas');
    }
    if ('diag' in t.dataset) {
      const out = $('#dg-out'); out.style.display = 'block'; out.textContent = 'Consultando…';
      try { const r = await api(`tagplus/diagnostico?recurso=${$('#dg-rec').value}${$('#dg-id').value ? '&id=' + $('#dg-id').value : ''}`); out.textContent = JSON.stringify(r.dados, null, 2); }
      catch (er) { out.textContent = er.message; }
    }
  };
}


// --------------------------------------------------------------- usuários e auditoria
const PAPEL_NOME = { master: 'Administrador master', dono: 'Dono', gerente: 'Gerente', vendedor: 'Vendedor' };
const PAPEL_DESC = {
  master: 'Tudo, inclusive outros masters',
  dono: 'Tudo da loja, menos contas master',
  gerente: 'Pedidos, produtos, notas, categorias e entrega',
  vendedor: 'Pedidos e consulta de produtos, sem custo',
};
async function telaUsuarios() {
  C().onclick = null;
  C().innerHTML = '<div class="cab"><h2>Usuários</h2></div><p class="vazio">Carregando…</p>';
  let lista, log;
  try { [lista, log] = await Promise.all([api('usuarios'), api('auditoria')]); } catch (e) { return falha(e); }
  const papeis = Object.keys(PAPEL_NOME).filter((p) => p !== 'master' || pode('usuarios.master'));
  const optPapel = (sel) => papeis.map((p) => `<option value="${p}" ${p === sel ? 'selected' : ''}>${PAPEL_NOME[p]}</option>`).join('');
  C().innerHTML = `<div class="cab"><h2>Usuários</h2></div>
    <div class="secao"><h3>Quem pode fazer o quê</h3>
      <table class="tab"><tbody>${Object.keys(PAPEL_NOME).map((p) => `<tr><td><strong>${PAPEL_NOME[p]}</strong></td><td>${PAPEL_DESC[p]}</td></tr>`).join('')}</tbody></table></div>
    <div class="painel"><table class="tab"><thead><tr><th>Nome</th><th class="hm">E-mail</th><th>Papel</th><th class="hm">Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((x) => {
        const travado = x.papel === 'master' && !pode('usuarios.master');
        return `<tr data-uid="${x.id}"><td><strong>${esc(x.nome)}</strong>${x.id === S.eu.id ? ' <span class="mini">(você)</span>' : ''}<div class="mini">${esc(x.email)}</div></td>
        <td class="hm">${esc(x.email)}</td>
        <td>${travado ? PAPEL_NOME[x.papel] : `<select data-papel>${optPapel(x.papel)}</select>`}</td>
        <td class="hm mini">${x.ultimo_acesso ? data(x.ultimo_acesso) : 'nunca'}${x.trocar_senha ? '<div>senha provisória</div>' : ''}</td>
        <td>${x.ativo ? '<span class="tag entregue">Ativo</span>' : '<span class="tag off">Desativado</span>'}</td>
        <td style="white-space:nowrap">${travado ? '' : `<button class="lnk" data-salvar-u>Salvar</button><button class="lnk" data-senha-u>Nova senha</button><button class="lnk ${x.ativo ? 'perigo' : ''}" data-ativo-u="${x.ativo ? 0 : 1}">${x.ativo ? 'Desativar' : 'Reativar'}</button>`}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <form class="secao" id="f-novo-u" style="margin-top:14px"><h3>Novo usuário</h3><div class="form-grid">
      <div class="campo"><label>Nome</label><input name="nome" required></div>
      <div class="campo"><label>E-mail</label><input name="email" type="email" required></div>
      <div class="campo"><label>Papel</label><select name="papel">${optPapel('vendedor')}</select></div>
      <div class="campo"><label>Senha provisória</label><input name="senha" type="text" minlength="8" required placeholder="ex.: Loja2026abc"></div>
    </div><p class="mini">A pessoa troca a senha no primeiro acesso. Passe a senha provisória pessoalmente ou por WhatsApp.</p>
    <button class="btn" style="width:auto">Criar usuário</button></form>
    <div class="secao"><h3>Registro de ações</h3><p class="mini">As últimas 300 ações: login, preços, pedidos, configurações, usuários e integração.</p>
      ${log.length ? `<table class="tab"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th class="hm">Detalhe</th></tr></thead><tbody>
      ${log.map((l) => `<tr><td class="mini">${data(l.criado_em)}</td><td>${esc(l.usuario_nome)}</td><td>${esc(l.acao)}</td><td class="mini">${esc(l.alvo || '')}</td><td class="hm mini" style="max-width:320px;word-break:break-word">${esc((l.detalhe || '').slice(0, 200))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="mini">Nada registrado ainda.</p>'}</div>`;

  $('#f-novo-u').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('usuarios', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Usuário criado'); telaUsuarios(); }
    catch (er) { falha(er); }
  };
  C().onclick = async (e) => {
    const tr = e.target.closest('tr[data-uid]'); if (!tr) return;
    const uid = +tr.dataset.uid, d = e.target.dataset;
    let body = null;
    if ('salvarU' in d) body = { papel: tr.querySelector('[data-papel]').value };
    if ('ativoU' in d) {
      if (d.ativoU === '0' && !confirm('Desativar este usuário? Ele sai do painel na hora.')) return;
      body = { ativo: d.ativoU === '1' };
    }
    if ('senhaU' in d) {
      const nova = prompt('Nova senha provisória (8+ caracteres, letras e números). A pessoa troca no próximo acesso:');
      if (!nova) return;
      body = { senha: nova };
    }
    if (!body) return;
    try { await api(`usuarios/${uid}`, { method: 'PUT', body }); toast('Usuário atualizado'); if (uid === S.eu.id) return iniciar(); telaUsuarios(); }
    catch (er) { falha(er); }
  };
}

// --------------------------------------------------------------- cliques gerais
document.addEventListener('click', async (e) => {
  const ped = e.target.closest('[data-ped]'); if (ped) return abrirPedido(+ped.dataset.ped);
  const pr = e.target.closest('[data-prod]');
  if (pr) { try { editorProduto(await api('produtos/' + pr.dataset.prod)); } catch (er) { falha(er); } return; }
  if (e.target.closest('[data-novo]')) editorProduto(null);
});

// demonstração: mostra o login de visitante
fetch('/api/loja').then((r) => r.json()).then((j) => {
  if (!j.demo) return;
  const p = document.createElement('div');
  p.className = 'secao'; p.style.margin = '0';
  p.innerHTML = `<strong>Loja de demonstração</strong><p class="mini" style="margin:6px 0">Entre como visitante (papel Gerente). Os dados voltam ao original todo dia às 3h.</p>
    <p class="mini" style="margin:0">E-mail: <code>${esc(j.demo.email)}</code> · Senha: <code>${esc(j.demo.senha)}</code></p>
    <button type="button" class="btn sec" style="margin-top:8px">Entrar como visitante</button>`;
  p.querySelector('button').onclick = () => { $('#email').value = j.demo.email; $('#senha').value = j.demo.senha; $('#form-login').requestSubmit(); };
  $('#form-login').prepend(p);
}).catch(() => {});
if (token) iniciar(); else sair();
