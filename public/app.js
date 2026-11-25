// Vitrine + carrinho + envio do pedido pelo WhatsApp
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const S = {
  loja: null, categorias: [], regioes: [], produtos: [], porId: {},
  cat: '', q: '', ordem: '',
  carrinho: store.get('carrinho', []),          // [{pid, vid, qtd}]
  cliente: store.get('cliente', {}),            // dados lembrados
  enviando: false, confirmacao: null,
};

// --------------------------------------------------------------- dados
async function carregar() {
  try {
    const [a, b] = await Promise.all([fetch('/api/loja').then((r) => r.json()), fetch('/api/produtos').then((r) => r.json())]);
    Object.assign(S, { loja: a.loja, categorias: a.categorias, regioes: a.regioes, produtos: b.produtos });
    S.porId = Object.fromEntries(S.produtos.map((p) => [p.id, p]));
    // remove do carrinho o que não existe mais
    S.carrinho = S.carrinho.filter((i) => {
      const p = S.porId[i.pid];
      return p && (!i.vid || p.variacoes.some((v) => v.id === i.vid));
    });
    aplicarLoja();
    lerHash();
    renderCats(); renderGrade(); renderBadge();
  } catch (e) {
    $('#grade').innerHTML = '<p class="vazio">Não foi possível carregar o catálogo. Atualize a página.</p>';
  }
}

function aplicarLoja() {
  const L = S.loja;
  document.title = L.nome + (L.slogan ? ' — ' + L.slogan : '');
  document.documentElement.style.setProperty('--pri', L.cor_primaria);
  document.documentElement.style.setProperty('--dest', L.cor_destaque);
  $('#avisos').innerHTML = L.avisos.map((a) => `<span>${esc(a)}</span>`).join('');
  $('#marca').innerHTML = (L.logo ? `<img src="${esc(L.logo)}" alt="">` : '') +
    `<span><strong>${esc(L.nome)}</strong>${L.slogan ? `<small>${esc(L.slogan)}</small>` : ''}</span>`;
  if (L.instagram) { $('#lnk-insta').href = 'https://instagram.com/' + encodeURIComponent(L.instagram); $('#lnk-insta').hidden = false; }
  $('#lnk-wpp').href = 'https://wa.me/' + L.whatsapp;
  $('#rodape').innerHTML = `<p><strong>${esc(L.nome)}</strong></p>` +
    (L.endereco_loja ? `<p>${esc(L.endereco_loja)}</p>` : '') +
    (L.horario ? `<p>Horário: ${esc(L.horario)}</p>` : '') +
    `<p>Pedidos enviados pelo WhatsApp. Pagamento combinado com a loja.</p>`;
}

// --------------------------------------------------------------- preço / regras
const precoVar = (p, v) => (v && v.preco != null ? v.preco : p.preco);
const varsDisp = (p) => p.variacoes.filter((v) => v.ativo !== false);
function faixa(p) {
  const vs = varsDisp(p);
  if (!vs.length) return { min: p.preco, varia: false };
  const ps = vs.map((v) => precoVar(p, v));
  return { min: Math.min(...ps), varia: Math.min(...ps) !== Math.max(...ps) };
}
const esgotado = (p, v) => (v ? v.estoque === 0 : p.variacoes.length ? varsDisp(p).every((x) => x.estoque === 0) : p.estoque === 0);
const passo = (p) => Math.max(1, p.multiplo || 1);
function qtdInicial(p) { const s = passo(p); return Math.ceil(Math.max(1, p.qtd_minima || 1) / s) * s; }

function imgHtml(p, cls = '') {
  const u = p.imagens[0]?.url;
  return u ? `<img class="${cls}" src="${esc(u)}" alt="${esc(p.nome)}" loading="lazy">`
    : `<div class="placeholder ${cls}">${esc((p.nome.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase())}</div>`;
}

// --------------------------------------------------------------- lista
function renderCats() {
  const nav = $('#cats');
  const cont = (id) => S.produtos.filter((p) => p.categoria_id === id).length;
  nav.innerHTML = `<button data-cat="" class="${!S.cat ? 'on' : ''}">Todos</button>` +
    S.categorias.filter((c) => cont(c.id)).map((c) =>
      `<button data-cat="${esc(c.slug)}" class="${S.cat === c.slug ? 'on' : ''}">${esc(c.nome)}</button>`).join('');
}

function filtrados() {
  const cat = S.categorias.find((c) => c.slug === S.cat);
  const termos = norm(S.q).split(/\s+/).filter(Boolean);
  let l = S.produtos.filter((p) => (!cat || p.categoria_id === cat.id) &&
    termos.every((t) => norm(`${p.nome} ${p.marca || ''} ${p.sku || ''} ${p.categoria || ''}`).includes(t)));
  if (S.ordem === 'menor') l = [...l].sort((a, b) => faixa(a).min - faixa(b).min);
  if (S.ordem === 'maior') l = [...l].sort((a, b) => faixa(b).min - faixa(a).min);
  if (S.ordem === 'az') l = [...l].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return l;
}

let limite = 60; // paginação simples para catálogos grandes
function renderGrade() {
  const l = filtrados();
  const cat = S.categorias.find((c) => c.slug === S.cat);
  $('#titulo-lista').textContent = S.q ? `Resultados para "${S.q}"` : cat ? cat.nome : 'Todos os produtos';
  if (!l.length) { $('#grade').innerHTML = '<p class="vazio">Nenhum produto encontrado.</p>'; return; }
  $('#grade').innerHTML = l.slice(0, limite).map(cardHtml).join('') +
    (l.length > limite ? `<div class="vazio"><button class="btn sec" data-mais style="max-width:280px">Ver mais produtos (${l.length - limite})</button></div>` : '');
}

function cardHtml(p) {
  const f = faixa(p);
  const off = p.preco_antigo && p.preco_antigo > p.preco ? Math.round(100 - (p.preco * 100) / p.preco_antigo) : 0;
  const sem = esgotado(p);
  const noCarr = S.carrinho.find((i) => i.pid === p.id && !i.vid);
  let acao;
  if (sem) acao = `<button class="btn" disabled>Esgotado</button>`;
  else if (p.variacoes.length) acao = `<button class="btn" data-abrir="${p.id}">Escolher opção</button>`;
  else if (noCarr) acao = `<div class="qtd"><button data-menos="${p.id}:0" aria-label="Diminuir">−</button><span>${noCarr.qtd} no carrinho</span><button data-mais-q="${p.id}:0" aria-label="Aumentar">+</button></div>`;
  else acao = `<button class="btn" data-add="${p.id}">Adicionar ao carrinho</button>`;
  return `<article class="card">
    <div class="foto" data-abrir="${p.id}">${imgHtml(p)}${off ? `<span class="selo">-${off}%</span>` : ''}${p.destaque ? '<span class="selo dest">Destaque</span>' : ''}</div>
    <div class="info">
      ${p.marca ? `<span class="marca-p">${esc(p.marca)}</span>` : ''}
      <span class="nome" data-abrir="${p.id}">${esc(p.nome)}</span>
      ${off ? `<span class="de">${brl(p.preco_antigo)}</span>` : ''}
      <span class="preco">${f.varia ? '<small>a partir de </small>' : ''}${brl(f.min)}<small> /${esc(p.unidade)}</small></span>
      ${p.qtd_minima > 1 ? `<span class="obs">Mínimo ${p.qtd_minima} ${esc(p.unidade)}</span>` : ''}
      <div class="acao">${acao}</div>
    </div></article>`;
}

// --------------------------------------------------------------- modal do produto
function abrirProduto(id) {
  const p = S.porId[id];
  if (!p) return;
  const dlg = $('#modal-produto');
  const vs = varsDisp(p);
  let vSel = vs.length === 1 ? vs[0] : null;
  let qtd = qtdInicial(p);
  let fotoIdx = 0;

  const draw = () => {
    const preco = vSel ? precoVar(p, vSel) : faixa(p).min;
    const sem = vSel ? esgotado(p, vSel) : esgotado(p);
    dlg.innerHTML = `<div class="mp">
      <div class="galeria">
        <div class="principal">${p.imagens.length ? `<img src="${esc(p.imagens[fotoIdx].url)}" alt="${esc(p.nome)}">` : imgHtml(p)}</div>
        ${p.imagens.length > 1 ? `<div class="miniaturas">${p.imagens.map((im, i) =>
          `<img src="${esc(im.url)}" data-foto="${i}" class="${i === fotoIdx ? 'on' : ''}" alt="">`).join('')}</div>` : ''}
      </div>
      <div class="det">
        <button class="fechar" data-fechar aria-label="Fechar">×</button>
        ${p.marca ? `<span class="marca-p obs">${esc(p.marca)}</span>` : ''}
        <h2>${esc(p.nome)}</h2>
        <div>${p.preco_antigo && p.preco_antigo > preco ? `<div class="de">${brl(p.preco_antigo)}</div>` : ''}
          <span class="preco">${!vSel && faixa(p).varia ? '<small>a partir de </small>' : ''}${brl(preco)}<small> /${esc(p.unidade)}</small></span></div>
        ${vs.length ? `<div><div class="rot-campo">Escolha a opção</div><div class="chips">${vs.map((v) =>
          `<button class="chip ${vSel?.id === v.id ? 'on' : ''}" data-var="${v.id}" ${v.estoque === 0 ? 'disabled' : ''}>${esc(v.nome)}${
            v.preco != null && faixa(p).varia ? ' · ' + brl(v.preco) : ''}</button>`).join('')}</div></div>` : ''}
        <div class="linha">
          <div class="qtd"><button data-q="-1" aria-label="Diminuir">−</button><span>${qtd}</span><button data-q="1" aria-label="Aumentar">+</button></div>
          <button class="btn" data-confirmar ${sem || (vs.length && !vSel) ? 'disabled' : ''}>${sem ? 'Esgotado' : vs.length && !vSel ? 'Escolha uma opção' : 'Adicionar · ' + brl(preco * qtd)}</button>
        </div>
        ${p.qtd_minima > 1 || passo(p) > 1 ? `<p class="obs">${p.qtd_minima > 1 ? `Pedido mínimo: ${p.qtd_minima} ${esc(p.unidade)}. ` : ''}${passo(p) > 1 ? `Vendido de ${passo(p)} em ${passo(p)}.` : ''}</p>` : ''}
        ${p.descricao ? `<div class="desc">${esc(p.descricao)}</div>` : ''}
        ${p.specs.length ? `<table class="specs">${p.specs.map((s) => `<tr><td>${esc(s.rotulo)}</td><td>${esc(s.valor)}</td></tr>`).join('')}</table>` : ''}
        ${p.sku ? `<p class="obs">Cód.: ${esc(p.sku)}</p>` : ''}
      </div></div>`;
  };
  dlg.onclick = (e) => {
    const t = e.target.closest('button,img[data-foto]') || e.target;
    if (e.target === dlg || t.matches('[data-fechar]')) return dlg.close();
    if (t.dataset.foto) { fotoIdx = +t.dataset.foto; draw(); }
    if (t.dataset.var) { vSel = vs.find((v) => v.id === +t.dataset.var); draw(); }
    if (t.dataset.q) { qtd = Math.max(qtdInicial(p), qtd + +t.dataset.q * passo(p)); draw(); }
    if (t.matches('[data-confirmar]')) { addCarrinho(p.id, vSel?.id || null, qtd); dlg.close(); }
  };
  draw();
  dlg.showModal();
  history.replaceState(null, '', '#p/' + p.slug);
  dlg.onclose = () => history.replaceState(null, '', location.pathname + location.search);
}

// --------------------------------------------------------------- carrinho
const salvar = () => { store.set('carrinho', S.carrinho); renderBadge(); };
function addCarrinho(pid, vid, qtd) {
  const it = S.carrinho.find((i) => i.pid === pid && (i.vid || null) === (vid || null));
  if (it) it.qtd += qtd; else S.carrinho.push({ pid, vid: vid || null, qtd });
  salvar(); renderGrade();
  toast('Adicionado ao carrinho');
}
function mudarQtd(pid, vid, dir) {
  const p = S.porId[pid];
  const it = S.carrinho.find((i) => i.pid === pid && (i.vid || null) === (vid || null));
  if (!it) return;
  it.qtd += dir * passo(p);
  if (it.qtd < qtdInicial(p)) S.carrinho = S.carrinho.filter((i) => i !== it);
  salvar(); renderGrade(); if (gavetaAberta()) renderCarrinho();
}
function linhas() {
  return S.carrinho.map((i) => {
    const p = S.porId[i.pid];
    const v = i.vid ? p.variacoes.find((x) => x.id === i.vid) : null;
    const preco = precoVar(p, v);
    return { ...i, p, v, preco, total: preco * i.qtd };
  });
}
function renderBadge() {
  const n = S.carrinho.reduce((s, i) => s + i.qtd, 0);
  $('#badge').textContent = n; $('#badge').hidden = !n;
}

const gavetaAberta = () => $('#gaveta').classList.contains('aberta');
function abrirCarrinho() {
  S.confirmacao = null;
  $('#gaveta').classList.add('aberta'); $('#gaveta').setAttribute('aria-hidden', 'false'); $('#veu').hidden = false;
  renderCarrinho();
}
function fecharCarrinho() {
  $('#gaveta').classList.remove('aberta'); $('#gaveta').setAttribute('aria-hidden', 'true'); $('#veu').hidden = true;
}

function calc() {
  const L = S.loja, c = S.cliente;
  const ls = linhas();
  const subtotal = ls.reduce((s, i) => s + i.total, 0);
  const receb = c.recebimento === 'retirada' && L.permite_retirada ? 'retirada' : L.permite_entrega ? 'entrega' : 'retirada';
  const reg = S.regioes.find((r) => r.id === +c.regiao_id);
  let taxa = 0;
  if (receb === 'entrega' && reg) taxa = reg.gratis_acima != null && subtotal >= reg.gratis_acima ? 0 : reg.taxa;
  const faltaMin = receb === 'entrega' && L.pedido_minimo && subtotal < L.pedido_minimo ? L.pedido_minimo - subtotal : 0;
  return { ls, subtotal, receb, reg, taxa, total: subtotal + taxa, faltaMin };
}

function renderCarrinho() {
  const corpo = $('#gaveta-corpo'), pe = $('#gaveta-pe');
  if (S.confirmacao) return renderConfirmacao();
  const L = S.loja, c = S.cliente;
  const k = calc();
  if (!k.ls.length) {
    corpo.innerHTML = '<p class="vazio">Seu carrinho está vazio.</p><button class="btn sec" data-fechar-g>Ver produtos</button>';
    pe.innerHTML = '';
    return;
  }
  const pg = L.pagamentos;
  const pagOpts = [
    pg.pix_chave && ['pix_chave', 'Pix — pagar agora', 'Você recebe a chave Pix e o código copia e cola ao enviar o pedido.'],
    pg.pix_atendente && ['pix_atendente', 'Pix — combinar com o atendente', 'A loja confirma o pedido e envia os dados do Pix pelo WhatsApp.'],
    pg.cartao && ['cartao', 'Cartão na entrega', 'Débito ou crédito na maquininha.'],
    pg.dinheiro && ['dinheiro', 'Dinheiro', ''],
  ].filter(Boolean);
  if (!pagOpts.some((o) => o[0] === c.pagamento)) c.pagamento = pagOpts[0]?.[0];

  corpo.innerHTML = `
    ${k.ls.map((i) => `<div class="item">
      ${imgHtml(i.p)}
      <div><div class="n">${esc(i.p.nome)}</div>${i.v ? `<div class="v">${esc(i.v.nome)}</div>` : ''}
        <div class="v">${brl(i.preco)} /${esc(i.p.unidade)}</div>
        <div class="qtd"><button data-menos="${i.pid}:${i.vid || 0}" aria-label="Diminuir">−</button><span>${i.qtd}</span><button data-mais-q="${i.pid}:${i.vid || 0}" aria-label="Aumentar">+</button></div></div>
      <div><div class="t">${brl(i.total)}</div><button class="rm" data-rm="${i.pid}:${i.vid || 0}">Remover</button></div>
    </div>`).join('')}
    <form id="form-pedido" novalidate>
      ${L.permite_entrega && L.permite_retirada ? `<fieldset><legend>Como receber</legend><div class="opcoes duas">
        <label class="opcao"><input type="radio" name="recebimento" value="entrega" ${k.receb === 'entrega' ? 'checked' : ''}> Entrega</label>
        <label class="opcao"><input type="radio" name="recebimento" value="retirada" ${k.receb === 'retirada' ? 'checked' : ''}> Retirar na loja</label>
      </div>` : `<fieldset><legend>${k.receb === 'entrega' ? 'Entrega' : 'Retirada na loja'}</legend>`}
        ${k.receb === 'entrega' ? `
          ${S.regioes.length ? `<div class="campo"><label for="f-reg">Região</label><select id="f-reg" name="regiao_id">
            <option value="">Selecione…</option>${S.regioes.map((r) => `<option value="${r.id}" ${+c.regiao_id === r.id ? 'selected' : ''}>${esc(r.nome)} — ${
              r.taxa ? brl(r.taxa) + (r.gratis_acima != null ? ` (grátis acima de ${brl(r.gratis_acima)})` : '') : 'grátis'}${r.prazo ? ' · ' + esc(r.prazo) : ''}</option>`).join('')}
          </select></div>` : ''}
          <div class="campo"><label for="f-end">Endereço (rua, número, bairro)</label><input id="f-end" name="endereco" value="${esc(c.endereco)}" autocomplete="street-address"></div>
          <div class="campo"><label for="f-ref">Ponto de referência</label><input id="f-ref" name="referencia" value="${esc(c.referencia)}"></div>`
        : L.endereco_loja ? `<p class="obs">Retire em: ${esc(L.endereco_loja)}</p>` : ''}
      </fieldset>
      <fieldset><legend>Seus dados</legend>
        <div class="campo"><label for="f-nome">Nome</label><input id="f-nome" name="nome" value="${esc(c.nome)}" autocomplete="name"></div>
        <div class="campo"><label for="f-tel">WhatsApp / telefone</label><input id="f-tel" name="telefone" value="${esc(c.telefone)}" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000"></div>
        <div class="campo"><label for="f-doc">CPF ou CNPJ na nota (opcional)</label><input id="f-doc" name="cpf_cnpj" value="${esc(c.cpf_cnpj)}" inputmode="numeric" autocomplete="off"></div>
      </fieldset>
      <fieldset><legend>Pagamento</legend><div class="opcoes">
        ${pagOpts.map(([v, t, d]) => `<label class="opcao"><input type="radio" name="pagamento" value="${v}" ${c.pagamento === v ? 'checked' : ''}><span>${t}${d ? `<small>${d}</small>` : ''}</span></label>`).join('')}
      </div>
        ${c.pagamento === 'dinheiro' ? `<div class="campo"><label for="f-troco">Troco para quanto? (opcional)</label><input id="f-troco" name="troco" value="${esc(c.troco)}" inputmode="decimal" placeholder="Ex.: 100"></div>` : ''}
      </fieldset>
      <div class="campo"><label for="f-obs">Observações</label><textarea id="f-obs" name="observacoes" rows="2" placeholder="Ex.: embrulhar para presente">${esc(c.observacoes)}</textarea></div>
    </form>`;

  pe.innerHTML = `
    <div class="resumo"><span>Subtotal</span><span>${brl(k.subtotal)}</span>
      ${k.receb === 'entrega' ? `<span>Entrega</span><span>${k.reg ? (k.taxa ? brl(k.taxa) : 'Grátis') : '—'}</span>` : ''}
      <span class="tot">Total</span><span class="tot">${brl(k.total)}</span></div>
    ${k.faltaMin ? `<p class="alerta">Pedido mínimo para entrega: ${brl(L.pedido_minimo)}. Faltam ${brl(k.faltaMin)}.</p>` : ''}
    ${L.horario ? `<p class="obs" style="margin:0 0 8px">Atendimento: ${esc(L.horario)}</p>` : ''}
    <p class="erro-msg" id="erro-pedido" hidden></p>
    <button class="btn wpp" id="enviar" ${k.faltaMin || S.enviando ? 'disabled' : ''}>${S.enviando ? 'Enviando…' : 'Enviar pedido pelo WhatsApp'}</button>`;
}

function lerForm() {
  const f = $('#form-pedido');
  if (!f) return;
  const d = Object.fromEntries(new FormData(f));
  Object.assign(S.cliente, d);
  store.set('cliente', { ...S.cliente, observacoes: '', troco: '' });
}

async function enviarPedido() {
  lerForm();
  const c = S.cliente, k = calc();
  const err = (m) => { const e = $('#erro-pedido'); e.textContent = m; e.hidden = false; };
  if (!c.nome || c.nome.trim().length < 2) return err('Informe seu nome.');
  if ((c.telefone || '').replace(/\D/g, '').length < 10) return err('Informe seu WhatsApp com DDD.');
  if (k.receb === 'entrega') {
    if (S.regioes.length && !k.reg) return err('Escolha a região de entrega.');
    if (!c.endereco || c.endereco.trim().length < 5) return err('Informe o endereço de entrega.');
  }
  if (!c.pagamento) return err('Escolha a forma de pagamento.');
  const doc = (c.cpf_cnpj || '').replace(/\D/g, '');
  if (doc && doc.length !== 11 && doc.length !== 14) return err('CPF deve ter 11 dígitos e CNPJ, 14.');

  S.enviando = true; renderCarrinho();
  try {
    const r = await fetch('/api/pedidos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        itens: k.ls.map((i) => ({ produto_id: i.pid, variacao_id: i.vid, quantidade: i.qtd })),
        nome: c.nome, telefone: c.telefone, cpf_cnpj: c.cpf_cnpj, recebimento: k.receb, regiao_id: c.regiao_id || null,
        endereco: c.endereco, referencia: c.referencia, pagamento: c.pagamento,
        troco_para: c.troco ? Math.round(parseFloat(String(c.troco).replace(/\./g, '').replace(',', '.')) * 100) || null : null,
        observacoes: c.observacoes,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.');
    S.confirmacao = j;
    S.carrinho = []; salvar(); renderGrade();
    S.cliente.observacoes = ''; S.cliente.troco = '';
    S.enviando = false;
    renderConfirmacao();
    // tenta abrir o WhatsApp direto; se o navegador bloquear, o botão continua na tela
    const w = window.open(j.whatsapp_url, '_blank');
    if (!w) toast('Toque em "Abrir WhatsApp" para enviar o pedido');
  } catch (e) {
    S.enviando = false; renderCarrinho();
    const el = $('#erro-pedido'); el.textContent = e.message; el.hidden = false;
  }
}

function renderConfirmacao() {
  const j = S.confirmacao;
  let qr = '';
  if (j.pix && window.qrcode) {
    try { const q = qrcode(0, 'M'); q.addData(j.pix.copia_e_cola); q.make(); qr = q.createDataURL(6, 2); } catch {}
  }
  $('#gaveta-corpo').innerHTML = `<div class="conf">
    <div class="ok">✓</div>
    <h3>Pedido ${esc(j.codigo)} gerado!</h3>
    <p class="obs">Envie a mensagem no WhatsApp da loja para confirmar. Total: <strong>${brl(j.total)}</strong></p>
    <a class="btn wpp" href="${esc(j.whatsapp_url)}" target="_blank" rel="noopener">Abrir WhatsApp</a>
    ${j.pix ? `<div class="pix">
      <strong>Pague com Pix</strong>
      ${qr ? `<div class="qr"><img src="${qr}" alt="QR Code Pix"></div>` : ''}
      <div class="rot-campo">Pix copia e cola (já com o valor)</div>
      <code>${esc(j.pix.copia_e_cola)}</code>
      <button class="btn sec" data-copiar="${esc(j.pix.copia_e_cola)}">Copiar código Pix</button>
      <div class="rot-campo">Ou use a chave ${esc({cpf:'CPF',cnpj:'CNPJ',email:'e-mail',telefone:'telefone',aleatoria:'aleatória'}[j.pix.tipo] || 'Pix')}</div>
      <div class="k">${esc(j.pix.chave)}</div>
      <button class="btn sec" data-copiar="${esc(j.pix.chave)}">Copiar chave</button>
      ${j.pix.titular ? `<p class="obs" style="margin:0">Favorecido: ${esc(j.pix.titular)}${j.pix.banco ? ' · ' + esc(j.pix.banco) : ''}</p>` : ''}
      <p class="obs" style="margin:0">Depois de pagar, envie o comprovante na mesma conversa do WhatsApp.</p>
    </div>` : ''}
    <button class="btn sec" data-copiar="${esc(j.mensagem)}">Copiar pedido</button>
    <button class="btn sec" data-fechar-g>Continuar comprando</button>
  </div>`;
  $('#gaveta-pe').innerHTML = '';
}

// --------------------------------------------------------------- utilidades de UI
let tT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('on'), 2200); }
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Copiado!'); }
  catch { const a = document.createElement('textarea'); a.value = txt; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); toast('Copiado!'); }
}
function lerHash() {
  const m = location.hash.match(/^#p\/(.+)$/);
  if (m) { const p = S.produtos.find((x) => x.slug === decodeURIComponent(m[1])); if (p) abrirProduto(p.id); }
}
const chave = (s) => { const [p, v] = s.split(':').map(Number); return [p, v || null]; };

// --------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-abrir],[data-add],[data-menos],[data-mais-q],[data-rm],[data-mais],[data-cat],[data-copiar],[data-fechar-g]');
  if (!t) return;
  if (t.dataset.abrir) abrirProduto(+t.dataset.abrir);
  else if (t.dataset.add) { const p = S.porId[+t.dataset.add]; addCarrinho(p.id, null, qtdInicial(p)); }
  else if (t.dataset.menos) mudarQtd(...chave(t.dataset.menos), -1);
  else if (t.dataset.maisQ) mudarQtd(...chave(t.dataset.maisQ), 1);
  else if (t.dataset.rm) { const [p, v] = chave(t.dataset.rm); S.carrinho = S.carrinho.filter((i) => !(i.pid === p && (i.vid || null) === v)); salvar(); renderGrade(); renderCarrinho(); }
  else if (t.hasAttribute('data-mais')) { limite += 60; renderGrade(); }
  else if (t.dataset.cat !== undefined) { S.cat = t.dataset.cat; S.q = ''; $('#q').value = ''; limite = 60; renderCats(); renderGrade(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (t.dataset.copiar) copiar(t.dataset.copiar);
  else if (t.hasAttribute('data-fechar-g')) fecharCarrinho();
});
$('#abrir-carrinho').onclick = abrirCarrinho;
$('#fechar-carrinho').onclick = fecharCarrinho;
$('#veu').onclick = fecharCarrinho;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && gavetaAberta()) fecharCarrinho(); });
$('#busca').onsubmit = (e) => { e.preventDefault(); S.q = $('#q').value.trim(); limite = 60; renderGrade(); };
let tB; $('#q').oninput = () => { clearTimeout(tB); tB = setTimeout(() => { S.q = $('#q').value.trim(); limite = 60; renderGrade(); }, 250); };
$('#ordem').onchange = (e) => { S.ordem = e.target.value; renderGrade(); };
// mudanças no formulário que alteram valores redesenham o carrinho
$('#gaveta').addEventListener('change', (e) => {
  if (!e.target.closest('#form-pedido')) return;
  lerForm();
  if (['recebimento', 'regiao_id', 'pagamento'].includes(e.target.name)) renderCarrinho();
});
$('#gaveta').addEventListener('input', (e) => { if (e.target.closest('#form-pedido')) lerForm(); });
$('#gaveta').addEventListener('click', (e) => { if (e.target.id === 'enviar') enviarPedido(); });

carregar();
