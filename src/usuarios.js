// Usuários do painel: senha com PBKDF2, sessão assinada, papéis e auditoria

// ---------------------------------------------------------------- papéis e permissões
// master: administra tudo, inclusive outros masters · dono: tudo da loja, menos contas master
// gerente: operação da loja, sem Loja & Pix, Integração e Usuários · vendedor: pedidos e consulta de produtos
export const PAPEIS = {
  master: 'Administrador master',
  dono: 'Dono',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
};
const MATRIZ = {
  'pedidos.ver':       ['master', 'dono', 'gerente', 'vendedor'],
  'pedidos.status':    ['master', 'dono', 'gerente', 'vendedor'],
  'pedidos.erp':       ['master', 'dono', 'gerente'],           // enviar ao TagPlus e emitir nota
  'produtos.ver':      ['master', 'dono', 'gerente', 'vendedor'],
  'produtos.editar':   ['master', 'dono', 'gerente'],           // inclui fotos e importação de planilha
  'produtos.custo':    ['master', 'dono', 'gerente'],           // ver custo de aquisição
  'cadastros.editar':  ['master', 'dono', 'gerente'],           // categorias e regiões de entrega
  'loja.editar':       ['master', 'dono'],                      // dados da loja, WhatsApp e Pix
  'integracao':        ['master', 'dono'],
  'usuarios':          ['master', 'dono'],
  'auditoria':         ['master', 'dono'],
  'usuarios.master':   ['master'],                    // criar, alterar ou desativar contas master
};
export const pode = (papel, acao) => !!MATRIZ[acao]?.includes(papel);
export const permissoes = (papel) => Object.keys(MATRIZ).filter((a) => pode(papel, a));

// ---------------------------------------------------------------- senha (PBKDF2-SHA256)
const ITERACOES = 100000; // limite do Workers para PBKDF2
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, chave, 256);
}
export async function gerarHash(senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(await derivar(senha, sal, ITERACOES))}`;
}
export async function conferirSenha(senha, guardado) {
  const [alg, it, sal, hash] = String(guardado || '').split('$');
  if (alg !== 'pbkdf2' || !hash) return false;
  const calc = b64(await derivar(senha, deB64(sal), +it));
  if (calc.length !== hash.length) return false;
  let r = 0;
  for (let i = 0; i < calc.length; i++) r |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return r === 0;
}
export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return 'Use letras e números na senha.';
  return null;
}

// ---------------------------------------------------------------- auditoria
export async function auditar(env, usuario, acao, alvo = null, detalhe = null, req = null) {
  try {
    await env.DB.prepare('INSERT INTO auditoria (usuario_id, usuario_nome, acao, alvo, detalhe, ip) VALUES (?,?,?,?,?,?)')
      .bind(usuario?.id || null, usuario?.nome || 'Sistema', acao, alvo == null ? null : String(alvo).slice(0, 120),
        detalhe == null ? null : JSON.stringify(detalhe).slice(0, 2000), req?.headers.get('cf-connecting-ip') || null).run();
  } catch (e) { console.error('auditoria', e); }
}

// ---------------------------------------------------------------- freio de tentativas
// 5 erros no mesmo e-mail travam esse e-mail; o IP só trava com 30 (loja com Wi-Fi único não bloqueia todo mundo)
const BLOQUEIO_MIN = 15;
const maxFalhas = (chave) => (chave.startsWith('ip:') ? 30 : 5);
export async function bloqueado(env, chaves) {
  const ph = chaves.map(() => '?').join(',');
  const r = await env.DB.prepare(`SELECT bloqueado_ate FROM login_tentativas WHERE chave IN (${ph}) AND bloqueado_ate > datetime('now') LIMIT 1`).bind(...chaves).first();
  return !!r;
}
export async function registrarFalha(env, chaves) {
  for (const c of chaves) {
    await env.DB.prepare(`INSERT INTO login_tentativas (chave, falhas, atualizado_em) VALUES (?, 1, datetime('now'))
      ON CONFLICT(chave) DO UPDATE SET falhas = CASE WHEN atualizado_em < datetime('now','-1 hour') THEN 1 ELSE falhas + 1 END,
        bloqueado_ate = CASE WHEN falhas + 1 >= ${maxFalhas(c)} THEN datetime('now','+${BLOQUEIO_MIN} minutes') ELSE bloqueado_ate END,
        atualizado_em = datetime('now')`).bind(c).run();
  }
}
export async function limparFalhas(env, chaves) {
  await env.DB.prepare(`DELETE FROM login_tentativas WHERE chave IN (${chaves.map(() => '?').join(',')})`).bind(...chaves).run();
}
