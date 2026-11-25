// Catálogo eletrônico — API (Cloudflare Worker + D1 + R2)
import { brCode } from './pix.js';
import { importarLinhas } from './importar.js';
import { PAPEIS, pode, permissoes, gerarHash, conferirSenha, validarSenha, auditar, bloqueado, registrarFalha, limparFalhas } from './usuarios.js';
import { configurado as tagplusConfigurado, urlAutorizacao, trocarCodigo, lerChave, gravarChave, registrar, api as tagplusApi, renovarToken } from './tagplus/cliente.js';
import { enfileirar, processarFila, sincronizarProdutos, receberWebhook } from './tagplus/sync.js';

// ---------------------------------------------------------------- utilidades
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const erro = (msg, status = 400) => json({ erro: msg }, status);

class HttpError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const digitos = (s) => String(s || '').replace(/\D/g, '');
// Número para o link do WhatsApp: precisa do código do país (55).
// Aceita "(34) 99769-3393", "034997693393", "+55 34 99769-3393"...
const numeroWhats = (s) => {
  let d = digitos(s).replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
};
const texto = (s, max = 500) => String(s ?? '').trim().slice(0, max);
const inteiro = (v, def = null) => (v === '' || v === null || v === undefined || isNaN(+v) ? def : Math.round(+v));
const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';

const imgUrl = (key) => (!key ? null : /^https?:\/\//.test(key) ? key : '/img/' + key);

function fone(t) {
  const d = digitos(t).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}


// ---------------------------------------------------------------- fotos: R2 (IMAGENS) ou KV (IMAGENS_KV)
const fotos = {
  ativo: (env) => !!(env.IMAGENS || env.IMAGENS_KV),
  async put(env, key, file) {
    if (env.IMAGENS) return env.IMAGENS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return env.IMAGENS_KV.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } });
  },
  async get(env, key) {
    if (env.IMAGENS) {
      const obj = await env.IMAGENS.get(key);
      if (!obj) return null;
      return { body: obj.body, type: obj.httpMetadata?.contentType || 'application/octet-stream' };
    }
    if (!env.IMAGENS_KV) return null;
    const r = await env.IMAGENS_KV.getWithMetadata(key, { type: 'stream', cacheTtl: 86400 });
    return r.value ? { body: r.value, type: r.metadata?.contentType || 'application/octet-stream' } : null;
  },
  async del(env, keys) {
    if (!keys.length) return;
    if (env.IMAGENS) return env.IMAGENS.delete(keys);
    if (env.IMAGENS_KV) await Promise.all(keys.map((k) => env.IMAGENS_KV.delete(k)));
  },
};

// ---------------------------------------------------------------- autenticação admin
// Cada pessoa entra com e-mail e senha (tabela usuarios). Token = usuario.versao.expiração.assinaturaHMAC
// A senha mestra (ADMIN_PASSWORD) só abre o painel enquanto não existir nenhum Administrador master ativo:
// serve para criar o primeiro master e depois deixa de funcionar.
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
}
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const segredo = (env) => env.SESSION_SECRET || env.ADMIN_PASSWORD;

async function criarToken(env, uid, versao) {
  const corpo = `${uid}.${versao}.${Date.now() + 1000 * 60 * 60 * 12}`; // 12 h
  return corpo + '.' + (await hmac(segredo(env), 'sessao' + corpo));
}
const mastersAtivos = (env) => env.DB.prepare(`SELECT COUNT(*) n FROM usuarios WHERE ativo = 1 AND papel = 'master'`).first('n');
const MESTRE = { id: 0, nome: 'Configuração inicial (senha mestra)', email: null, papel: 'master', mestre: true, trocar_senha: 0 };

async function exigirAdmin(req, env) {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [uid, versao, exp, sig] = tok.split('.');
  if (!sig || +exp < Date.now()) throw new HttpError('Sessão expirada. Entre novamente.', 401);
  if (!iguais(sig, await hmac(segredo(env), `sessao${uid}.${versao}.${exp}`))) throw new HttpError('Sessão expirada. Entre novamente.', 401);
  if (+uid === 0) {
    if (await mastersAtivos(env)) throw new HttpError('A senha mestra foi desativada. Entre com seu e-mail.', 401);
    return MESTRE;
  }
  const u = await env.DB.prepare('SELECT id, nome, email, papel, ativo, trocar_senha, versao_sessao FROM usuarios WHERE id = ?').bind(+uid).first();
  if (!u || !u.ativo || u.versao_sessao !== +versao) throw new HttpError('Sessão encerrada. Entre novamente.', 401);
  return u;
}
function exigir(u, acao) {
  if (!pode(u.papel, acao)) throw new HttpError('Seu usuário não tem permissão para isso.', 403);
}
const publicoUsuario = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, papel_nome: PAPEIS[u.papel],
  ativo: !!u.ativo, trocar_senha: !!u.trocar_senha, ultimo_acesso: u.ultimo_acesso, criado_em: u.criado_em });

async function login(req, env) {
  const b = await req.json().catch(() => ({}));
  const email = texto(b.email, 120).toLowerCase();
  const senha = typeof b.senha === 'string' ? b.senha : '';
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const chaves = [`ip:${ip}`, ...(email ? [`email:${email}`] : [])];
  await new Promise((r) => setTimeout(r, 300));
  if (await bloqueado(env, chaves)) return erro('Muitas tentativas. Aguarde 15 minutos e tente de novo.', 429);

  if (!email) {
    // primeiro acesso: só com a senha mestra e só enquanto não houver Administrador master cadastrado
    if (await mastersAtivos(env)) return erro('Informe seu e-mail.', 400);
    if (!env.ADMIN_PASSWORD) return erro('Defina o segredo ADMIN_PASSWORD no Worker.', 500);
    if (!iguais(await hmac('cmp', senha), await hmac('cmp', env.ADMIN_PASSWORD))) { await registrarFalha(env, chaves); return erro('Senha incorreta.', 401); }
    await limparFalhas(env, chaves);
    await auditar(env, MESTRE, 'login.mestre', null, null, req);
    return json({ token: await criarToken(env, 0, 0) });
  }
  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();
  if (!u || !u.ativo || !(await conferirSenha(senha, u.senha_hash))) { await registrarFalha(env, chaves); return erro('E-mail ou senha incorretos.', 401); }
  await limparFalhas(env, chaves);
  await env.DB.prepare(`UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?`).bind(u.id).run();
  await auditar(env, u, 'login', null, null, req);
  return json({ token: await criarToken(env, u.id, u.versao_sessao) });
}

// ---------------------------------------------------------------- usuários (só o dono)
async function rotasUsuarios(req, env, u, id) {
  const m = req.method;
  if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM usuarios ORDER BY ativo DESC, nome').all()).results.map(publicoUsuario));
  const b = await req.json().catch(() => ({}));
  const papel = b.papel in PAPEIS ? b.papel : null;

  if (m === 'POST' && !id) {
    const nome = texto(b.nome, 80), email = texto(b.email, 120).toLowerCase();
    if (nome.length < 2) throw new HttpError('Informe o nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('E-mail inválido.');
    if (!papel) throw new HttpError('Escolha o papel.');
    if (u.mestre && papel !== 'master') throw new HttpError('Crie primeiro o Administrador master.');
    if (papel === 'master') exigir(u, 'usuarios.master');
    const ruim = validarSenha(b.senha); if (ruim) throw new HttpError(ruim);
    if (await env.DB.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) throw new HttpError('Já existe um usuário com esse e-mail.');
    const novo = await env.DB.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha) VALUES (?,?,?,?,?) RETURNING *`)
      .bind(nome, email, await gerarHash(b.senha), papel, u.mestre || b.trocar_senha === false ? 0 : 1).first();
    await auditar(env, u, 'usuario.criar', email, { papel }, req);
    return json(publicoUsuario(novo), 201);
  }
  const alvo = id && (await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(id).first());
  if (!alvo) throw new HttpError('Usuário não encontrado.', 404);

  if (m === 'PUT') {
    const ativo = b.ativo === undefined ? alvo.ativo : b.ativo ? 1 : 0;
    const novoPapel = papel || alvo.papel;
    // conta master só é alterada por outro master
    if (alvo.papel === 'master' || novoPapel === 'master') exigir(u, 'usuarios.master');
    // nunca deixar o sistema sem um Administrador master ativo
    if (alvo.papel === 'master' && alvo.ativo && (novoPapel !== 'master' || !ativo) && (await mastersAtivos(env)) <= 1)
      throw new HttpError('É preciso manter pelo menos um Administrador master ativo.');
    let hash = alvo.senha_hash, trocar = alvo.trocar_senha, versao = alvo.versao_sessao;
    if (b.senha) {
      const ruim = validarSenha(b.senha); if (ruim) throw new HttpError(ruim);
      hash = await gerarHash(b.senha); trocar = 1; versao++;
    }
    if (novoPapel !== alvo.papel || ativo !== alvo.ativo) versao++; // derruba sessões abertas
    const nome = texto(b.nome, 80) || alvo.nome;
    const r = await env.DB.prepare(`UPDATE usuarios SET nome = ?, papel = ?, ativo = ?, senha_hash = ?, trocar_senha = ?, versao_sessao = ?,
      atualizado_em = datetime('now') WHERE id = ? RETURNING *`).bind(nome, novoPapel, ativo, hash, trocar, versao, id).first();
    await auditar(env, u, 'usuario.editar', alvo.email, {
      ...(novoPapel !== alvo.papel ? { papel: [alvo.papel, novoPapel] } : {}),
      ...(ativo !== alvo.ativo ? { ativo: !!ativo } : {}), ...(b.senha ? { senha: 'redefinida' } : {}),
    }, req);
    return json(publicoUsuario(r));
  }
  return erro('Rota não encontrada.', 404);
}

async function trocarMinhaSenha(req, env, u) {
  if (u.mestre) throw new HttpError('A senha mestra é trocada no segredo ADMIN_PASSWORD da Cloudflare.');
  const b = await req.json().catch(() => ({}));
  const atual = await env.DB.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').bind(u.id).first('senha_hash');
  if (!(await conferirSenha(b.atual || '', atual))) throw new HttpError('Senha atual incorreta.');
  const ruim = validarSenha(b.nova); if (ruim) throw new HttpError(ruim);
  if (b.nova === b.atual) throw new HttpError('A nova senha precisa ser diferente da atual.');
  const v = await env.DB.prepare(`UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, versao_sessao = versao_sessao + 1,
    atualizado_em = datetime('now') WHERE id = ? RETURNING versao_sessao`).bind(await gerarHash(b.nova), u.id).first('versao_sessao');
  await auditar(env, u, 'senha.trocar', u.email, null, req);
  return json({ token: await criarToken(env, u.id, v) }); // sessão nova; as outras caem
}

// ---------------------------------------------------------------- leitura do catálogo
async function getConfig(env) {
  return env.DB.prepare('SELECT * FROM loja_config WHERE id = 1').first();
}

function configPublica(c) {
  return {
    nome: c.nome, slogan: c.slogan, segmento: c.segmento, logo: imgUrl(c.logo_key),
    cor_primaria: c.cor_primaria, cor_destaque: c.cor_destaque,
    whatsapp: numeroWhats(c.whatsapp), instagram: c.instagram, endereco_loja: c.endereco_loja,
    horario: c.horario, avisos: (c.aviso_topo || '').split('|').map((s) => s.trim()).filter(Boolean),
    pedido_minimo: c.pedido_minimo,
    permite_retirada: !!c.permite_retirada, permite_entrega: !!c.permite_entrega,
    pagamentos: {
      pix_chave: !!c.pix_ativo && !!c.pix_chave && c.pix_modo !== 'atendente',
      pix_atendente: !!c.pix_ativo && c.pix_modo !== 'chave',
      cartao: !!c.aceita_cartao,
      dinheiro: !!c.aceita_dinheiro,
    },
  };
}

// Monta produtos com imagens, variações e specs em 4 consultas (sem N+1)
async function carregarProdutos(env, { somenteAtivos = true, id = null } = {}) {
  const filtro = [];
  const binds = [];
  if (somenteAtivos) filtro.push('p.ativo = 1');
  if (id) { filtro.push('p.id = ?'); binds.push(id); }
  const where = filtro.length ? 'WHERE ' + filtro.join(' AND ') : '';
  const sub = `SELECT p.id FROM produtos p ${where}`;

  const [prod, imgs, vars, specs] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, c.nome AS categoria FROM produtos p
                    LEFT JOIN categorias c ON c.id = p.categoria_id ${where}
                    ORDER BY p.destaque DESC, p.nome`).bind(...binds),
    env.DB.prepare(`SELECT * FROM produto_imagens WHERE produto_id IN (${sub}) ORDER BY ordem, id`).bind(...binds),
    env.DB.prepare(`SELECT * FROM produto_variacoes WHERE produto_id IN (${sub})
                    ${somenteAtivos ? 'AND ativo = 1' : ''} ORDER BY ordem, id`).bind(...binds),
    env.DB.prepare(`SELECT * FROM produto_specs WHERE produto_id IN (${sub}) ORDER BY ordem, id`).bind(...binds),
  ]);

  const agrupar = (rows) => rows.results.reduce((m, r) => ((m[r.produto_id] ||= []).push(r), m), {});
  const gI = agrupar(imgs), gV = agrupar(vars), gS = agrupar(specs);

  return prod.results.map((p) => ({
    id: p.id, nome: p.nome, slug: p.slug, descricao: p.descricao, marca: p.marca, sku: p.sku,
    categoria_id: p.categoria_id, categoria: p.categoria,
    preco: p.preco, preco_antigo: p.preco_antigo, unidade: p.unidade,
    qtd_minima: p.qtd_minima, multiplo: p.multiplo, estoque: p.estoque,
    destaque: !!p.destaque, ativo: !!p.ativo,
    ...(somenteAtivos ? {} : { codigo: p.codigo, ncm: p.ncm, cest: p.cest, custo: p.custo, tagplus_id: p.tagplus_id, sincronizado_em: p.sincronizado_em }),
    imagens: (gI[p.id] || []).map((i) => ({ key: i.r2_key, url: imgUrl(i.r2_key) })),
    variacoes: (gV[p.id] || []).map((v) => ({
      id: v.id, nome: v.nome, sku: v.sku, preco: v.preco, estoque: v.estoque, ativo: !!v.ativo,
    })),
    specs: (gS[p.id] || []).map((s) => ({ rotulo: s.rotulo, valor: s.valor })),
  }));
}

// ---------------------------------------------------------------- pedido
async function criarPedido(req, env) {
  const b = await req.json().catch(() => null);
  if (!b || !Array.isArray(b.itens) || !b.itens.length) throw new HttpError('Carrinho vazio.');
  if (b.itens.length > 200) throw new HttpError('Itens demais em um único pedido.');

  const cfg = await getConfig(env);
  const pub = configPublica(cfg);

  const nome = texto(b.nome, 80);
  const telefone = digitos(b.telefone);
  if (nome.length < 2) throw new HttpError('Informe seu nome.');
  if (telefone.length < 10) throw new HttpError('Informe um telefone com DDD.');
  const cpfCnpj = digitos(b.cpf_cnpj);
  if (cpfCnpj && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) throw new HttpError('CPF ou CNPJ inválido.');

  const recebimento = b.recebimento === 'retirada' ? 'retirada' : 'entrega';
  if (recebimento === 'entrega' && !pub.permite_entrega) throw new HttpError('A loja não está fazendo entregas.');
  if (recebimento === 'retirada' && !pub.permite_retirada) throw new HttpError('A loja não oferece retirada.');

  const pagamento = b.pagamento;
  if (!pub.pagamentos[pagamento]) throw new HttpError('Forma de pagamento indisponível.');

  // Recalcula tudo pelo banco — nunca confia no preço vindo do navegador
  const prodIds = [...new Set(b.itens.map((i) => inteiro(i.produto_id)).filter(Boolean))];
  const ph = prodIds.map(() => '?').join(',');
  const [pr, vr] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM produtos WHERE ativo = 1 AND id IN (${ph})`).bind(...prodIds),
    env.DB.prepare(`SELECT * FROM produto_variacoes WHERE ativo = 1 AND produto_id IN (${ph})`).bind(...prodIds),
  ]);
  const P = Object.fromEntries(pr.results.map((p) => [p.id, p]));
  const V = Object.fromEntries(vr.results.map((v) => [v.id, v]));

  const itens = [];
  for (const it of b.itens) {
    const p = P[inteiro(it.produto_id)];
    if (!p) throw new HttpError('Um dos produtos não está mais disponível. Atualize a página.');
    const temVar = vr.results.some((v) => v.produto_id === p.id);
    const v = it.variacao_id ? V[inteiro(it.variacao_id)] : null;
    if (temVar && (!v || v.produto_id !== p.id)) throw new HttpError(`Escolha a opção de "${p.nome}".`);
    const qtd = inteiro(it.quantidade, 0);
    if (qtd < 1 || qtd > 9999) throw new HttpError(`Quantidade inválida em "${p.nome}".`);
    if (qtd < p.qtd_minima) throw new HttpError(`"${p.nome}": mínimo de ${p.qtd_minima} ${p.unidade}.`);
    if (p.multiplo > 1 && qtd % p.multiplo) throw new HttpError(`"${p.nome}": vendido de ${p.multiplo} em ${p.multiplo}.`);
    const estoque = v ? v.estoque : p.estoque;
    if (estoque !== null && estoque !== undefined && qtd > estoque)
      throw new HttpError(`"${p.nome}${v ? ' (' + v.nome + ')' : ''}": só temos ${estoque} em estoque.`);
    const preco = v && v.preco !== null ? v.preco : p.preco;
    itens.push({ p, v, qtd, preco, total: preco * qtd });
  }

  const subtotal = itens.reduce((s, i) => s + i.total, 0);
  let taxa = 0, regiao = null;
  const endereco = texto(b.endereco, 200);
  const referencia = texto(b.referencia, 200);
  if (recebimento === 'entrega') {
    regiao = await env.DB.prepare('SELECT * FROM regioes_entrega WHERE id = ? AND ativo = 1')
      .bind(inteiro(b.regiao_id)).first();
    const temRegioes = await env.DB.prepare('SELECT COUNT(*) n FROM regioes_entrega WHERE ativo = 1').first('n');
    if (temRegioes && !regiao) throw new HttpError('Escolha a região de entrega.');
    if (endereco.length < 5) throw new HttpError('Informe o endereço de entrega.');
    if (cfg.pedido_minimo && subtotal < cfg.pedido_minimo)
      throw new HttpError(`Pedido mínimo para entrega: ${brl(cfg.pedido_minimo)}.`);
    if (regiao) taxa = regiao.gratis_acima !== null && subtotal >= regiao.gratis_acima ? 0 : regiao.taxa;
  }
  const total = subtotal + taxa;
  const troco = pagamento === 'dinheiro' ? inteiro(b.troco_para) : null;
  const obs = texto(b.observacoes, 500);

  // cliente (upsert pelo telefone)
  const cli = await env.DB.prepare(
    `INSERT INTO clientes (nome, telefone, endereco, referencia, cpf_cnpj) VALUES (?,?,?,?,?)
     ON CONFLICT(telefone) DO UPDATE SET nome = excluded.nome,
       cpf_cnpj = COALESCE(excluded.cpf_cnpj, clientes.cpf_cnpj),
       endereco = COALESCE(excluded.endereco, clientes.endereco),
       referencia = COALESCE(excluded.referencia, clientes.referencia)
     RETURNING id`).bind(nome, telefone, endereco || null, referencia || null, cpfCnpj || null).first();

  const agora = new Date(Date.now() - 3 * 3600e3); // horário de Brasília
  const codigo = 'P' + agora.toISOString().slice(2, 10).replace(/-/g, '') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  const ped = await env.DB.prepare(
    `INSERT INTO pedidos (codigo, cliente_id, cliente_nome, cliente_telefone, recebimento, regiao_id, regiao_nome,
       endereco, referencia, pagamento, troco_para, observacoes, subtotal, taxa_entrega, total, cliente_cpf_cnpj)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(
    codigo, cli.id, nome, telefone, recebimento, regiao?.id ?? null, regiao?.nome ?? null,
    recebimento === 'entrega' ? endereco : null, recebimento === 'entrega' ? referencia : null,
    pagamento, troco, obs || null, subtotal, taxa, total, cpfCnpj || null).first();

  const stmts = itens.map((i) => env.DB.prepare(
    `INSERT INTO pedido_itens (pedido_id, produto_id, variacao_id, nome, variacao, unidade, preco_unit, quantidade, total)
     VALUES (?,?,?,?,?,?,?,?,?)`).bind(ped.id, i.p.id, i.v?.id ?? null, i.p.nome, i.v?.nome ?? null,
    i.p.unidade, i.preco, i.qtd, i.total));
  // baixa de estoque (só onde é controlado)
  for (const i of itens) {
    if (i.v && i.v.estoque !== null) stmts.push(env.DB.prepare('UPDATE produto_variacoes SET estoque = estoque - ? WHERE id = ?').bind(i.qtd, i.v.id));
    else if (!i.v && i.p.estoque !== null) stmts.push(env.DB.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?').bind(i.qtd, i.p.id));
  }
  await env.DB.batch(stmts);

  // ---- mensagem do WhatsApp
  const pagTxt = {
    pix_chave: 'Pix pela chave da loja (envio o comprovante aqui)',
    pix_atendente: 'Pix — quero finalizar com o atendente',
    cartao: 'Cartão na entrega',
    dinheiro: 'Dinheiro' + (troco ? ` (troco para ${brl(troco)})` : ' (sem troco)'),
  }[pagamento];

  const L = [];
  L.push(`*Novo pedido ${codigo}* — ${cfg.nome}`);
  L.push('');
  L.push(`*Cliente:* ${nome}`);
  L.push(`*Telefone:* ${fone(telefone)}`);
  if (cpfCnpj) L.push(`*CPF/CNPJ na nota:* ${cpfCnpj}`);
  L.push('');
  L.push('*Itens*');
  for (const i of itens)
    L.push(`• ${i.qtd} ${i.p.unidade} × ${i.p.nome}${i.v ? ' — ' + i.v.nome : ''} = ${brl(i.total)}`);
  L.push('');
  L.push(`Subtotal: ${brl(subtotal)}`);
  if (recebimento === 'entrega') L.push(`Entrega${regiao ? ' (' + regiao.nome + ')' : ''}: ${taxa ? brl(taxa) : 'grátis'}`);
  L.push(`*Total: ${brl(total)}*`);
  L.push('');
  if (recebimento === 'entrega') {
    L.push(`*Entrega:* ${endereco}`);
    if (referencia) L.push(`Referência: ${referencia}`);
  } else L.push('*Retirada na loja*');
  L.push(`*Pagamento:* ${pagTxt}`);
  if (obs) L.push(`*Observações:* ${obs}`);

  let pix = null;
  if (pagamento === 'pix_chave') {
    pix = {
      tipo: cfg.pix_tipo, chave: cfg.pix_chave, titular: cfg.pix_titular, banco: cfg.pix_banco,
      copia_e_cola: brCode({ tipo: cfg.pix_tipo, chave: cfg.pix_chave, titular: cfg.pix_titular || cfg.nome,
        cidade: cfg.pix_cidade, valorCentavos: total, txid: codigo }),
    };
  }
  const mensagem = L.join('\n');
  return json({
    codigo, subtotal, taxa_entrega: taxa, total, mensagem, pix,
    whatsapp_url: `https://wa.me/${numeroWhats(cfg.whatsapp)}?text=${encodeURIComponent(mensagem)}`,
  }, 201);
}

// ---------------------------------------------------------------- admin: produtos
async function salvarProduto(env, id, b) {
  const nome = texto(b.nome, 150);
  if (!nome) throw new HttpError('Nome é obrigatório.');
  const preco = inteiro(b.preco);
  if (preco === null || preco < 0) throw new HttpError('Preço inválido.');

  let slug = slugify(b.slug || nome);
  const conflito = await env.DB.prepare('SELECT id FROM produtos WHERE slug = ? AND id IS NOT ?').bind(slug, id).first();
  if (conflito) slug = slug + '-' + Math.random().toString(36).slice(2, 6);

  const campos = [inteiro(b.categoria_id), nome, slug, texto(b.descricao, 4000) || null, texto(b.marca, 80) || null,
    texto(b.sku, 60) || null, preco, inteiro(b.preco_antigo), texto(b.unidade, 10) || 'un',
    Math.max(1, inteiro(b.qtd_minima, 1)), Math.max(1, inteiro(b.multiplo, 1)), inteiro(b.estoque),
    b.destaque ? 1 : 0, b.ativo === false ? 0 : 1,
    texto(b.codigo, 60) || null, digitos(b.ncm).slice(0, 8) || null, digitos(b.cest).slice(0, 7) || null, inteiro(b.custo), inteiro(b.tagplus_id)];
  if (campos[14]) {
    const dup = await env.DB.prepare('SELECT id FROM produtos WHERE codigo = ? AND id IS NOT ?').bind(campos[14], id).first('id');
    if (dup) throw new HttpError('Já existe outro produto com esse código.');
  }

  if (id) {
    const r = await env.DB.prepare(`UPDATE produtos SET categoria_id=?, nome=?, slug=?, descricao=?, marca=?, sku=?, preco=?,
      preco_antigo=?, unidade=?, qtd_minima=?, multiplo=?, estoque=?, destaque=?, ativo=?, codigo=?, ncm=?, cest=?, custo=?,
      tagplus_id=?, atualizado_em=datetime('now')
      WHERE id = ?`).bind(...campos, id).run();
    if (!r.meta.changes) throw new HttpError('Produto não encontrado.', 404);
  } else {
    id = (await env.DB.prepare(`INSERT INTO produtos (categoria_id, nome, slug, descricao, marca, sku, preco, preco_antigo,
      unidade, qtd_minima, multiplo, estoque, destaque, ativo, codigo, ncm, cest, custo, tagplus_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .bind(...campos).first('id'));
  }

  // imagens: lista ordenada de chaves; remove do R2 as que saíram
  const antigas = (await env.DB.prepare('SELECT r2_key FROM produto_imagens WHERE produto_id = ?').bind(id).all())
    .results.map((r) => r.r2_key);
  const novas = (Array.isArray(b.imagens) ? b.imagens : []).map((k) => texto(k, 300)).filter(Boolean).slice(0, 12);
  const removidas = antigas.filter((k) => !novas.includes(k) && !/^https?:/.test(k));

  // variações: mantém ids existentes (para não quebrar pedidos antigos)
  const vars = (Array.isArray(b.variacoes) ? b.variacoes : []).filter((v) => texto(v.nome)).slice(0, 100);
  const idsMantidos = vars.map((v) => inteiro(v.id)).filter(Boolean);

  const st = [env.DB.prepare('DELETE FROM produto_imagens WHERE produto_id = ?').bind(id),
    ...novas.map((k, i) => env.DB.prepare('INSERT INTO produto_imagens (produto_id, r2_key, ordem) VALUES (?,?,?)').bind(id, k, i)),
    env.DB.prepare('DELETE FROM produto_specs WHERE produto_id = ?').bind(id),
    ...(Array.isArray(b.specs) ? b.specs : []).filter((s) => texto(s.rotulo) && texto(s.valor)).slice(0, 50)
      .map((s, i) => env.DB.prepare('INSERT INTO produto_specs (produto_id, rotulo, valor, ordem) VALUES (?,?,?,?)')
        .bind(id, texto(s.rotulo, 60), texto(s.valor, 300), i)),
    // variações que sumiram da lista são desativadas (preserva histórico)
    env.DB.prepare(`UPDATE produto_variacoes SET ativo = 0 WHERE produto_id = ?
      ${idsMantidos.length ? `AND id NOT IN (${idsMantidos.map(() => '?').join(',')})` : ''}`).bind(id, ...idsMantidos),
  ];
  vars.forEach((v, i) => {
    const vals = [texto(v.nome, 80), texto(v.sku, 60) || null, inteiro(v.preco), inteiro(v.estoque), i, v.ativo === false ? 0 : 1];
    if (inteiro(v.id)) st.push(env.DB.prepare('UPDATE produto_variacoes SET nome=?, sku=?, preco=?, estoque=?, ordem=?, ativo=? WHERE id=? AND produto_id=?').bind(...vals, inteiro(v.id), id));
    else st.push(env.DB.prepare('INSERT INTO produto_variacoes (nome, sku, preco, estoque, ordem, ativo, produto_id) VALUES (?,?,?,?,?,?,?)').bind(...vals, id));
  });
  await env.DB.batch(st);
  await fotos.del(env, removidas);
  return (await carregarProdutos(env, { somenteAtivos: false, id }))[0];
}

async function upload(req, env) {
  if (!fotos.ativo(env)) throw new HttpError('Armazenamento de imagens não configurado.', 500);
  const form = await req.formData();
  const f = form.get('arquivo');
  if (!f || typeof f === 'string') throw new HttpError('Envie um arquivo.');
  const tipos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if (!tipos[f.type]) throw new HttpError('Formato não suportado (use JPG, PNG ou WEBP).');
  if (f.size > 5 * 1024 * 1024) throw new HttpError('Imagem acima de 5 MB.');
  const key = `p/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${tipos[f.type]}`;
  await fotos.put(env, key, f);
  return json({ key, url: imgUrl(key) }, 201);
}

// ---------------------------------------------------------------- CRUD simples (categorias, regiões)
const TABELAS = {
  categorias: {
    campos: ['nome', 'slug', 'ordem', 'ativo'],
    prep: (b) => [texto(b.nome, 60), slugify(b.slug || b.nome), inteiro(b.ordem, 0), b.ativo === false ? 0 : 1],
    ordem: 'ordem, nome',
  },
  regioes: {
    tabela: 'regioes_entrega',
    campos: ['nome', 'taxa', 'gratis_acima', 'prazo', 'ordem', 'ativo'],
    prep: (b) => [texto(b.nome, 80), Math.max(0, inteiro(b.taxa, 0)), inteiro(b.gratis_acima), texto(b.prazo, 60) || null,
      inteiro(b.ordem, 0), b.ativo === false ? 0 : 1],
    ordem: 'ordem, nome',
  },
};

async function crud(req, env, nome, id) {
  const t = TABELAS[nome];
  const tabela = t.tabela || nome;
  if (req.method === 'GET') return json((await env.DB.prepare(`SELECT * FROM ${tabela} ORDER BY ${t.ordem}`).all()).results);
  if (req.method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM ${tabela} WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }
  const b = await req.json();
  const vals = t.prep(b);
  if (!vals[0]) throw new HttpError('Nome é obrigatório.');
  if (req.method === 'POST') {
    const row = await env.DB.prepare(`INSERT INTO ${tabela} (${t.campos.join(',')}) VALUES (${t.campos.map(() => '?').join(',')}) RETURNING *`)
      .bind(...vals).first();
    return json(row, 201);
  }
  const row = await env.DB.prepare(`UPDATE ${tabela} SET ${t.campos.map((c) => c + '=?').join(',')} WHERE id = ? RETURNING *`)
    .bind(...vals, id).first();
  return row ? json(row) : erro('Não encontrado', 404);
}

const CONFIG_CAMPOS = {
  nome: (v) => texto(v, 80) || 'Minha Loja', slogan: (v) => texto(v, 150) || null, segmento: (v) => texto(v, 20) || 'misto',
  logo_key: (v) => texto(v, 300) || null, cor_primaria: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#3b3fb6'),
  cor_destaque: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#f39c12'), whatsapp: (v) => numeroWhats(v),
  instagram: (v) => texto(v, 60).replace(/^@/, '') || null, endereco_loja: (v) => texto(v, 200) || null,
  horario: (v) => texto(v, 200) || null, aviso_topo: (v) => texto(v, 400) || null,
  pedido_minimo: (v) => Math.max(0, inteiro(v, 0)), permite_retirada: (v) => (v ? 1 : 0), permite_entrega: (v) => (v ? 1 : 0),
  pix_ativo: (v) => (v ? 1 : 0), pix_tipo: (v) => (['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'].includes(v) ? v : null),
  pix_chave: (v) => texto(v, 100) || null, pix_titular: (v) => texto(v, 80) || null, pix_banco: (v) => texto(v, 60) || null,
  pix_cidade: (v) => texto(v, 40) || null,
  pix_modo: (v) => (['chave', 'atendente', 'ambos'].includes(v) ? v : 'ambos'),
  aceita_cartao: (v) => (v ? 1 : 0), aceita_dinheiro: (v) => (v ? 1 : 0),
};

// ---------------------------------------------------------------- roteador
async function rotear(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  // imagens do R2
  if (path.startsWith('/img/') && m === 'GET') {
    const obj = await fotos.get(env, decodeURIComponent(path.slice(5)));
    if (!obj) return new Response('Não encontrada', { status: 404 });
    return new Response(obj.body, {
      headers: { 'content-type': obj.type, 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }

  // ---- público
  if (path === '/api/loja' && m === 'GET') {
    const [cfg, cats, regs] = await Promise.all([
      getConfig(env),
      env.DB.prepare('SELECT id, nome, slug FROM categorias WHERE ativo = 1 ORDER BY ordem, nome').all(),
      env.DB.prepare('SELECT id, nome, taxa, gratis_acima, prazo FROM regioes_entrega WHERE ativo = 1 ORDER BY ordem, nome').all(),
    ]);
    return json({ loja: configPublica(cfg), categorias: cats.results, regioes: regs.results });
  }
  if (path === '/api/produtos' && m === 'GET') {
    return new Response(JSON.stringify({ produtos: await carregarProdutos(env) }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' },
    });
  }
  if (path === '/api/pedidos' && m === 'POST') return criarPedido(req, env);

  // ---- TagPlus: retorno do OAuth e webhook (chamados pelo TagPlus, sem login do painel)
  if (path === '/api/tagplus/callback' && m === 'GET') return tagplusCallback(url, env);
  if (path === '/api/tagplus/webhook' && m === 'POST') {
    const segredoWebhook = env.TAGPLUS_WEBHOOK_SECRET;
    const recebido = req.headers.get('x-hub-secret') || '';
    if (!segredoWebhook || !iguais(await hmac('cmp', recebido), await hmac('cmp', segredoWebhook))) return erro('Não autorizado', 401);
    const corpo = await req.json().catch(() => null);
    if (!corpo) return erro('JSON inválido');
    return json(await receberWebhook(env, corpo));
  }

  // ---- admin
  if (path === '/api/admin/login' && m === 'POST') return login(req, env);
  if (!path.startsWith('/api/admin/')) return null;
  const u = await exigirAdmin(req, env);

  const seg = path.split('/').slice(3); // [recurso, id?]
  const [rec, idStr] = seg;
  const id = inteiro(idStr);

  // quem eu sou e o que posso fazer
  if (rec === 'eu' && m === 'GET') {
    return json({ ...(u.mestre ? MESTRE : publicoUsuario(u)), papel_nome: PAPEIS[u.papel], permissoes: permissoes(u.papel),
      configurar_usuarios: !!u.mestre });
  }
  if (rec === 'minha-senha' && m === 'POST') return trocarMinhaSenha(req, env, u);
  // senha provisória: nada além de trocar a senha
  if (u.trocar_senha) throw new HttpError('Troque sua senha provisória para continuar.', 403);

  if (rec === 'usuarios') { exigir(u, 'usuarios'); return rotasUsuarios(req, env, u, id); }
  if (rec === 'auditoria' && m === 'GET') {
    exigir(u, 'auditoria');
    const uid = inteiro(url.searchParams.get('usuario'));
    const r = await env.DB.prepare(`SELECT * FROM auditoria ${uid ? 'WHERE usuario_id = ?' : ''} ORDER BY id DESC LIMIT 300`).bind(...(uid ? [uid] : [])).all();
    return json(r.results);
  }

  if (rec === 'upload' && m === 'POST') { exigir(u, 'produtos.editar'); return upload(req, env); }

  if (rec === 'importar' && m === 'POST') {
    exigir(u, 'produtos.editar');
    const b = await req.json().catch(() => ({}));
    try {
      const r = await importarLinhas(env, b.linhas, { atualizarFotos: b.atualizar_fotos !== false });
      await auditar(env, u, 'produtos.importar', `${r.produtos} produto(s)`, { criados: r.criados, atualizados: r.atualizados, erros: r.erros.length }, req);
      return json(r);
    } catch (e) { throw new HttpError(e.message); }
  }

  if (rec === 'tagplus') { exigir(u, 'integracao'); return rotasTagplus(req, env, url, seg.slice(1), u); }

  if (rec === 'config') {
    if (m === 'GET') return json(await getConfig(env));
    if (m === 'PUT') {
      exigir(u, 'loja.editar');
      const b = await req.json();
      const antes = await getConfig(env);
      const ks = Object.keys(CONFIG_CAMPOS).filter((k) => k in b);
      if (ks.length) await env.DB.prepare(`UPDATE loja_config SET ${ks.map((k) => k + '=?').join(',')}, atualizado_em=datetime('now') WHERE id = 1`)
        .bind(...ks.map((k) => CONFIG_CAMPOS[k](b[k]))).run();
      const depois = await getConfig(env);
      const mudou = ks.filter((k) => String(antes[k] ?? '') !== String(depois[k] ?? ''));
      if (mudou.length) await auditar(env, u, 'loja.editar', 'configurações', { campos: mudou }, req);
      return json(depois);
    }
  }

  if (rec === 'produtos') {
    exigir(u, 'produtos.ver');
    const semCusto = (p) => (pode(u.papel, 'produtos.custo') ? p : { ...p, custo: undefined });
    if (m === 'GET' && !id) return json((await carregarProdutos(env, { somenteAtivos: false })).map(semCusto));
    if (m === 'GET') {
      const p = (await carregarProdutos(env, { somenteAtivos: false, id }))[0];
      return p ? json(semCusto(p)) : erro('Produto não encontrado.', 404);
    }
    exigir(u, 'produtos.editar');
    if (m === 'POST' && !id) {
      const p = await salvarProduto(env, null, await req.json());
      await auditar(env, u, 'produto.criar', `produto ${p.id}`, { nome: p.nome, preco: p.preco }, req);
      return json(p, 201);
    }
    if (m === 'PUT' && id) {
      const antes = await env.DB.prepare('SELECT nome, preco, estoque, ativo FROM produtos WHERE id = ?').bind(id).first();
      const p = await salvarProduto(env, id, await req.json());
      const dif = antes ? Object.fromEntries(['nome', 'preco', 'estoque'].filter((k) => antes[k] !== p[k]).map((k) => [k, [antes[k], p[k]]])) : {};
      if (antes && !!antes.ativo !== p.ativo) dif.ativo = p.ativo;
      await auditar(env, u, 'produto.editar', `produto ${id}`, { nome: p.nome, ...dif }, req);
      return json(p);
    }
    if (m === 'DELETE' && id) {
      const nome = await env.DB.prepare('SELECT nome FROM produtos WHERE id = ?').bind(id).first('nome');
      const keys = (await env.DB.prepare('SELECT r2_key FROM produto_imagens WHERE produto_id = ?').bind(id).all())
        .results.map((r) => r.r2_key).filter((k) => !/^https?:/.test(k));
      await env.DB.prepare('DELETE FROM produtos WHERE id = ?').bind(id).run();
      await fotos.del(env, keys);
      await auditar(env, u, 'produto.excluir', `produto ${id}`, { nome }, req);
      return json({ ok: true });
    }
  }

  if (rec in TABELAS) {
    if (m !== 'GET') exigir(u, 'cadastros.editar');
    const r = await crud(req, env, rec, id);
    if (m !== 'GET' && r.ok) await auditar(env, u, `${rec}.${m === 'POST' ? 'criar' : m === 'PUT' ? 'editar' : 'excluir'}`, id ? `${rec} ${id}` : rec, null, req);
    return r;
  }

  if (rec === 'pedidos') {
    exigir(u, 'pedidos.ver');
    const codigoPedido = async () => (await env.DB.prepare('SELECT codigo FROM pedidos WHERE id = ?').bind(id).first('codigo')) || `pedido ${id}`;
    if (m === 'GET' && !id) {
      const st = url.searchParams.get('status');
      const r = await env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) AS qtd_itens
        FROM pedidos p ${st ? 'WHERE status = ?' : ''} ORDER BY p.id DESC LIMIT 300`).bind(...(st ? [st] : [])).all();
      return json(r.results);
    }
    if (m === 'GET') {
      const [p, itens] = await env.DB.batch([
        env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id),
        env.DB.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id').bind(id),
      ]);
      return p.results[0] ? json({ ...p.results[0], itens: itens.results }) : erro('Pedido não encontrado.', 404);
    }
    if (m === 'POST' && seg[2] === 'enviar-erp') {
      exigir(u, 'pedidos.erp');
      exigirTagplus(env);
      await auditar(env, u, 'pedido.enviar_erp', await codigoPedido(), null, req);
      await env.DB.prepare(`UPDATE pedidos SET erp_status = 'pendente' WHERE id = ?`).bind(id).run();
      await enfileirar(env, 'enviar_pedido', id);
      return json({ ok: true, fila: await processarFila(env, 5) });
    }
    if (m === 'POST' && seg[2] === 'emitir-nota') {
      exigir(u, 'pedidos.erp');
      exigirTagplus(env);
      const { tipo } = await req.json().catch(() => ({}));
      await auditar(env, u, 'pedido.emitir_nota', await codigoPedido(), { tipo: tipo === 'nfe' ? 'nfe' : 'nfce' }, req);
      await env.DB.prepare(`UPDATE pedidos SET nf_status = 'solicitada', nf_erro = NULL WHERE id = ?`).bind(id).run();
      await enfileirar(env, 'emitir_nota', id, { tipo: tipo === 'nfe' ? 'nfe' : 'nfce' });
      return json({ ok: true, fila: await processarFila(env, 5) });
    }
    if (m === 'PUT') {
      exigir(u, 'pedidos.status');
      const { status } = await req.json();
      const atual = await env.DB.prepare('SELECT status FROM pedidos WHERE id = ?').bind(id).first('status');
      if (!atual) return erro('Pedido não encontrado.', 404);
      if (status !== atual) await auditar(env, u, 'pedido.status', await codigoPedido(), { de: atual, para: status }, req);
      const st = [env.DB.prepare(`UPDATE pedidos SET status = ?, atualizado_em = datetime('now') WHERE id = ?`).bind(status, id)];
      // cancelou → devolve estoque; reativou → baixa de novo
      if ((status === 'cancelado') !== (atual === 'cancelado')) {
        const sinal = status === 'cancelado' ? '+' : '-';
        st.push(env.DB.prepare(`UPDATE produto_variacoes SET estoque = estoque ${sinal} (SELECT SUM(quantidade) FROM pedido_itens i
          WHERE i.pedido_id = ? AND i.variacao_id = produto_variacoes.id) WHERE estoque IS NOT NULL AND id IN
          (SELECT variacao_id FROM pedido_itens WHERE pedido_id = ?)`).bind(id, id));
        st.push(env.DB.prepare(`UPDATE produtos SET estoque = estoque ${sinal} (SELECT SUM(quantidade) FROM pedido_itens i
          WHERE i.pedido_id = ? AND i.produto_id = produtos.id AND i.variacao_id IS NULL) WHERE estoque IS NOT NULL AND id IN
          (SELECT produto_id FROM pedido_itens WHERE pedido_id = ? AND variacao_id IS NULL)`).bind(id, id));
      }
      await env.DB.batch(st).catch(() => { throw new HttpError('Status inválido.'); });
      if (status === 'confirmado' && atual !== 'confirmado' && tagplusConfigurado(env)) {
        const opc = { ...OPCOES_PADRAO, ...((await lerChave(env, 'tagplus_opcoes')) || {}) };
        if (opc.enviar_ao_confirmar && (await lerChave(env, 'tagplus_token'))) {
          await env.DB.prepare(`UPDATE pedidos SET erp_status = 'pendente' WHERE id = ? AND tagplus_pedido_id IS NULL`).bind(id).run();
          await enfileirar(env, 'enviar_pedido', id);
          if (opc.emitir_nota_ao_confirmar) await enfileirar(env, 'emitir_nota', id, { tipo: opc.tipo_nota || 'nfce' });
        }
      }
      return json({ ok: true });
    }
  }
  return erro('Rota não encontrada.', 404);
}

// ---------------------------------------------------------------- TagPlus: conexão, opções, diagnóstico
function exigirTagplus(env) {
  if (!tagplusConfigurado(env)) throw new HttpError('Cadastre TAGPLUS_CLIENT_ID e TAGPLUS_CLIENT_SECRET nos segredos do Worker.', 400);
}

async function tagplusCallback(url, env) {
  const volta = (msg) => Response.redirect(new URL('/admin/#integracao=' + encodeURIComponent(msg), url).toString(), 302);
  const [exp, sig] = (url.searchParams.get('state') || '').split('.');
  if (!exp || +exp < Date.now() || !iguais(sig || '', await hmac(segredo(env), 'tagplus' + exp))) return volta('Link de autorização expirado. Tente conectar de novo.');
  const code = url.searchParams.get('code');
  if (!code) return volta('O TagPlus não autorizou a conexão.');
  try {
    await trocarCodigo(env, code);
    const eu = await tagplusApi(env, 'GET', '/me').catch(() => null);
    await gravarChave(env, 'tagplus_conta', { usuario: eu?.nome || eu?.login || null, sistema: eu?.sistema || null, conectado_em: new Date().toISOString() });
    await registrar(env, 'tagplus', 'conectado', { detalhe: { usuario: eu?.nome } });
    return volta('ok');
  } catch (e) {
    await registrar(env, 'tagplus', 'conexao_falhou', { ok: false, detalhe: e.message });
    return volta('Falha ao conectar: ' + e.message);
  }
}

const OPCOES_PADRAO = {
  enviar_ao_confirmar: true,        // status "confirmado" no painel envia o pedido ao TagPlus
  emitir_nota_ao_confirmar: false,  // e já pede a nota
  tipo_nota: 'nfce',
  sincronizar_automatico: true,     // a cada 10 min busca produtos alterados
  manter_preco_catalogo: false,     // true = preço do catálogo não é sobrescrito pelo ERP
  manter_nome_catalogo: false,
  novos_ocultos: true,              // produto novo do ERP sem foto entra oculto
  formas_pagamento: {},             // { pix_chave: <id TagPlus>, cartao: <id>, ... }
};

async function rotasTagplus(req, env, url, [acao], u) {
  if (req.method !== 'GET' && acao) await auditar(env, u, `integracao.${acao}`, 'TagPlus', null, req);
  const m = req.method;
  if (acao === 'status' && m === 'GET') {
    const [token, conta, opcoes, desde, fila, log] = await Promise.all([
      lerChave(env, 'tagplus_token'), lerChave(env, 'tagplus_conta'), lerChave(env, 'tagplus_opcoes'), lerChave(env, 'tagplus_produtos_desde'),
      env.DB.prepare(`SELECT status, COUNT(*) n FROM integracao_fila GROUP BY status`).all(),
      env.DB.prepare(`SELECT * FROM integracao_log ORDER BY id DESC LIMIT 40`).all(),
    ]);
    const vinculados = await env.DB.prepare('SELECT COUNT(*) n FROM produtos WHERE tagplus_id IS NOT NULL').first('n');
    return json({
      configurado: tagplusConfigurado(env), webhook_configurado: !!env.TAGPLUS_WEBHOOK_SECRET,
      conectado: !!token?.access_token, token_expira_em: token?.expira_em || null, refresh_expira_em: token?.refresh_expira_em || null,
      conta, opcoes: { ...OPCOES_PADRAO, ...(opcoes || {}) }, ultima_sincronizacao: desde, produtos_vinculados: vinculados,
      fila: Object.fromEntries(fila.results.map((f) => [f.status, f.n])),
      erros_fila: (await env.DB.prepare(`SELECT id, tipo, ref_id, erro, tentativas, atualizado_em FROM integracao_fila WHERE status = 'erro' ORDER BY id DESC LIMIT 20`).all()).results,
      log: log.results,
      urls: { retorno: new URL('/api/tagplus/callback', url).toString(), webhook: new URL('/api/tagplus/webhook', url).toString() },
    });
  }
  exigirTagplus(env);
  if (acao === 'conectar' && m === 'GET') {
    await auditar(env, u, 'integracao.conectar', 'TagPlus', null, req);
    const exp = String(Date.now() + 15 * 60 * 1000);
    return json({ url: urlAutorizacao(env, exp + '.' + (await hmac(segredo(env), 'tagplus' + exp))) });
  }
  if (acao === 'desconectar' && m === 'POST') {
    await env.DB.prepare(`DELETE FROM integracao WHERE chave IN ('tagplus_token','tagplus_conta')`).run();
    await registrar(env, 'tagplus', 'desconectado');
    return json({ ok: true });
  }
  if (acao === 'opcoes' && m === 'PUT') {
    const b = await req.json();
    const atual = { ...OPCOES_PADRAO, ...((await lerChave(env, 'tagplus_opcoes')) || {}) };
    for (const k of Object.keys(OPCOES_PADRAO)) if (k in b) atual[k] = k === 'formas_pagamento' ? b[k] || {} : k === 'tipo_nota' ? (b[k] === 'nfe' ? 'nfe' : 'nfce') : !!b[k];
    await gravarChave(env, 'tagplus_opcoes', atual);
    return json(atual);
  }
  if (acao === 'sincronizar' && m === 'POST') {
    const { completo } = await req.json().catch(() => ({}));
    try { return json(await sincronizarProdutos(env, { completo: !!completo })); }
    catch (e) { throw new HttpError('Sincronização falhou: ' + e.message, 502); }
  }
  if (acao === 'processar-fila' && m === 'POST') return json(await processarFila(env, 25));
  if (acao === 'reprocessar' && m === 'POST') {
    await env.DB.prepare(`UPDATE integracao_fila SET status = 'pendente', tentativas = 0, proxima_em = datetime('now') WHERE status = 'erro'`).run();
    return json(await processarFila(env, 25));
  }
  // Mostra o JSON real do TagPlus para conferir nomes de campos (src/tagplus/mapa.js)
  if (acao === 'diagnostico' && m === 'GET') {
    const recurso = url.searchParams.get('recurso') || 'produtos';
    if (!/^(produtos|pedidos|nfces|nfes|clientes|formas_pagamento|categorias|webhooks|me)$/.test(recurso)) throw new HttpError('Recurso não permitido.');
    const id = inteiro(url.searchParams.get('id'));
    try {
      const dados = recurso === 'me' ? await tagplusApi(env, 'GET', '/me')
        : id ? await tagplusApi(env, 'GET', `/${recurso}/${id}`)
        : await tagplusApi(env, 'GET', `/${recurso}`, { query: { per_page: 3, fields: '*' } });
      return json({ recurso, dados });
    } catch (e) { throw new HttpError(`TagPlus: ${e.message}`, 502); }
  }
  return erro('Rota não encontrada.', 404);
}

// Tarefa agendada (wrangler.toml → [triggers]): renova o token, processa a fila e busca produtos alterados
async function agendado(env) {
  if (!tagplusConfigurado(env)) return;
  const token = await lerChave(env, 'tagplus_token');
  if (!token?.refresh_token) return;
  try {
    // o refresh token vale 15 dias: renova com antecedência para nunca perder a conexão
    if (token.expira_em - Date.now() < 30 * 60 * 1000 || token.refresh_expira_em - Date.now() < 3 * 86400 * 1000) await renovarToken(env, token);
    await processarFila(env, 25);
    const opc = { ...OPCOES_PADRAO, ...((await lerChave(env, 'tagplus_opcoes')) || {}) };
    if (opc.sincronizar_automatico) await sincronizarProdutos(env, {});
  } catch (e) {
    await registrar(env, 'sistema', 'agendamento_falhou', { ok: false, detalhe: e.message });
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(agendado(env));
  },
  async fetch(req, env) {
    try {
      const r = await rotear(req, env);
      if (r) return r;
      return env.ASSETS.fetch(req); // vitrine e painel (arquivos estáticos)
    } catch (e) {
      if (e instanceof HttpError) return erro(e.message, e.status);
      console.error(e);
      return erro('Erro interno. Tente novamente.', 500);
    }
  },
};
