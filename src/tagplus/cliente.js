// Cliente da API do TagPlus (v2.0)
// Guia: https://developers.tagplus.com.br/  ·  Webhook: https://developers.tagplus.com.br/webhook
//
// - Autorização OAuth2 (Authorization Code). A URL de retorno é a cadastrada no app do portal.
// - Access token vale 24 h; refresh token vale 15 dias. Cada renovação invalida o par anterior,
//   então o par novo é gravado na hora (tabela `integracao`).
// - Toda chamada leva o cabeçalho X-Api-Version: 2.0.

export const TAGPLUS = {
  autorizar: 'https://developers.tagplus.com.br/authorize',
  api: 'https://api.tagplus.com.br',
  versao: '2.0',
  escopos: [
    'read:produtos', 'read:categorias', 'read:formas_pagamento', 'read:webhooks',
    'write:clientes', 'write:pedidos', 'write:nfces', 'write:nfes',
  ],
};

// TAGPLUS_API_URL só é usado em testes (servidor simulado); em produção fica o endereço oficial
const base = (env) => env.TAGPLUS_API_URL || TAGPLUS.api;

export class ErroTagPlus extends Error {
  constructor(status, corpo) {
    const msg = corpo?.message || corpo?.dev_message || corpo?.error_description || `TagPlus respondeu ${status}`;
    super(msg);
    this.status = status;
    this.codigo = corpo?.error_code || null;
    this.corpo = corpo;
  }
}

// ---------------------------------------------------------------- armazenamento (D1, tabela integracao)
export async function lerChave(env, chave) {
  const r = await env.DB.prepare('SELECT valor FROM integracao WHERE chave = ?').bind(chave).first('valor');
  if (r == null) return null;
  try { return JSON.parse(r); } catch { return r; }
}
export async function gravarChave(env, chave, valor) {
  await env.DB.prepare(`INSERT INTO integracao (chave, valor, atualizado_em) VALUES (?, ?, datetime('now'))
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`)
    .bind(chave, JSON.stringify(valor)).run();
}
export async function registrar(env, origem, evento, { ref = null, ok = true, detalhe = null } = {}) {
  const d = detalhe == null ? null : typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
  await env.DB.prepare('INSERT INTO integracao_log (origem, evento, ref, ok, detalhe) VALUES (?,?,?,?,?)')
    .bind(origem, evento, ref == null ? null : String(ref), ok ? 1 : 0, d ? d.slice(0, 4000) : null).run();
}

export const configurado = (env) => !!(env.TAGPLUS_CLIENT_ID && env.TAGPLUS_CLIENT_SECRET);

// ---------------------------------------------------------------- OAuth2
export function urlAutorizacao(env, state) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.TAGPLUS_CLIENT_ID, scope: TAGPLUS.escopos.join(' '), state,
  });
  return `${TAGPLUS.autorizar}?${q}`;
}

async function pedirToken(env, campos) {
  const r = await fetch(`${base(env)}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-version': TAGPLUS.versao },
    body: new URLSearchParams({ ...campos, client_id: env.TAGPLUS_CLIENT_ID, client_secret: env.TAGPLUS_CLIENT_SECRET }),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || !corpo.access_token) throw new ErroTagPlus(r.status, corpo);
  const token = {
    access_token: corpo.access_token,
    refresh_token: corpo.refresh_token,
    expira_em: Date.now() + (Number(corpo.expires_in) || 86400) * 1000,
    refresh_expira_em: Date.now() + 15 * 86400 * 1000,
  };
  await gravarChave(env, 'tagplus_token', token);
  return token;
}

export const trocarCodigo = (env, code) => pedirToken(env, { grant_type: 'authorization_code', code });

export async function renovarToken(env, token) {
  token ||= await lerChave(env, 'tagplus_token');
  if (!token?.refresh_token) throw new ErroTagPlus(401, { message: 'TagPlus não conectado.' });
  try {
    return await pedirToken(env, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
  } catch (e) {
    await registrar(env, 'tagplus', 'token_renovacao_falhou', { ok: false, detalhe: e.message });
    throw e;
  }
}

async function tokenValido(env) {
  let t = await lerChave(env, 'tagplus_token');
  if (!t?.access_token) throw new ErroTagPlus(401, { message: 'TagPlus não conectado. Conecte em Painel > Integração.' });
  if (t.expira_em - Date.now() < 10 * 60 * 1000) t = await renovarToken(env, t); // renova com 10 min de folga
  return t;
}

// ---------------------------------------------------------------- chamadas
// api(env, 'GET', '/produtos', { query: { page: 1, per_page: 100, fields: '*' } })
export async function api(env, metodo, caminho, { query, corpo, cabecalhos = {} } = {}) {
  const url = new URL(base(env) + caminho);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const t = await tokenValido(env);
    const r = await fetch(url, {
      method: metodo,
      headers: {
        authorization: `Bearer ${t.access_token}`,
        'x-api-version': TAGPLUS.versao,
        accept: 'application/json',
        ...(corpo ? { 'content-type': 'application/json' } : {}),
        ...cabecalhos,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 && tentativa === 0) { await renovarToken(env, t); continue; }   // token expirado antes da hora
    if ((r.status === 429 || r.status >= 500) && tentativa < 2) { await new Promise((s) => setTimeout(s, 800 * (tentativa + 1))); continue; }
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { message: texto.slice(0, 300) }; }
    if (!r.ok) throw new ErroTagPlus(r.status, dados);
    return dados;
  }
}

// Percorre todas as páginas de uma coleção
export async function* paginas(env, caminho, query = {}, cabecalhos = {}) {
  const porPagina = 100;
  for (let page = 1; page < 1000; page++) {
    const lista = await api(env, 'GET', caminho, { query: { ...query, page, per_page: porPagina }, cabecalhos });
    const itens = Array.isArray(lista) ? lista : lista?.data || lista?.itens || [];
    if (!itens.length) return;
    yield itens;
    if (itens.length < porPagina) return;
  }
}
