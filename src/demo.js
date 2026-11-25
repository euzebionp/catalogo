// Loja de demonstração: dados fictícios que voltam ao original todo dia (cron 03:00 de Brasília)
import seed from '../seed-demo.sql';
import { gerarHash } from './usuarios.js';

export const DEMO_LOGIN = { email: 'demo@lojamodelo.com.br', senha: 'Demo2026' };
export const ehDemo = (env) => env.DEMO === '1';

const comandos = () => seed
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*\n/).map((c) => c.trim().replace(/;$/, '')).filter(Boolean);

export async function resetarDemo(env) {
  await env.DB.batch(comandos().map((c) => env.DB.prepare(c)));
  // usuário de demonstração (gerente): sempre com a mesma senha, sem troca obrigatória
  const hash = await gerarHash(DEMO_LOGIN.senha);
  await env.DB.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha) VALUES ('Visitante', ?, ?, 'gerente', 0)
    ON CONFLICT(email) DO UPDATE SET senha_hash = excluded.senha_hash, papel = 'gerente', ativo = 1, trocar_senha = 0,
      versao_sessao = usuarios.versao_sessao + 1`).bind(DEMO_LOGIN.email, hash).run();
  await env.DB.prepare(`DELETE FROM auditoria WHERE criado_em < datetime('now','-7 days')`).run();
}

// primeira visita depois do deploy: se a demo está vazia, carrega os dados
export async function garantirDemo(env) {
  const n = await env.DB.prepare('SELECT COUNT(*) n FROM produtos').first('n');
  if (!n) await resetarDemo(env);
}
