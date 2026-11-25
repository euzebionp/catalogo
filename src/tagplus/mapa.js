// Mapeamento de campos catálogo ⇄ TagPlus
//
// ATENÇÃO: a referência de campos de cada endpoint (https://developers.tagplus.com.br/doc) só abre com
// login no portal de desenvolvedor. Os nomes abaixo marcados com "CONFIRMAR" seguem o padrão da API
// (português, snake_case, ids numéricos) e devem ser conferidos com:
//   Painel > Integração > Diagnóstico  (mostra o JSON real devolvido pelo seu TagPlus)
// Tudo que depende de nome de campo está neste arquivo; o resto do código não precisa mudar.

const primeiro = (obj, caminhos) => {
  for (const c of caminhos) {
    const v = c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
const centavos = (v) => (v == null || v === '' || isNaN(+v) ? null : Math.round(+v * 100));
const reais = (c) => (c == null ? null : Math.round(c) / 100);
const digitos = (s) => String(s || '').replace(/\D/g, '');

// ---------------------------------------------------------------- TagPlus → catálogo (produto)
export function produtoDoTagPlus(p) {
  const estoque = primeiro(p, ['estoque.qtd_revenda', 'qtd_revenda', 'estoque.quantidade', 'estoque', 'qtd_estoque']); // CONFIRMAR
  const imagens = (primeiro(p, ['imagens', 'fotos']) || [])                                                         // CONFIRMAR
    .map((i) => (typeof i === 'string' ? i : primeiro(i, ['url', 'link', 'src', 'arquivo.url'])))
    .filter((u) => /^https?:\/\//.test(u || ''));
  const imgUnica = primeiro(p, ['imagem_principal.url', 'imagem_principal', 'imagem.url', 'imagem']);
  if (!imagens.length && /^https?:\/\//.test(imgUnica || '')) imagens.push(imgUnica);
  return {
    tagplus_id: +p.id,
    codigo: primeiro(p, ['codigo', 'codigo_interno']) ? String(primeiro(p, ['codigo', 'codigo_interno'])) : null,
    nome: String(primeiro(p, ['descricao', 'nome']) || `Produto ${p.id}`).trim(),           // no TagPlus "descricao" é o nome
    descricao: primeiro(p, ['descricao_longa', 'descricao_complementar', 'observacoes']),       // CONFIRMAR
    preco: centavos(primeiro(p, ['valor_venda_varejo', 'valor_venda', 'preco', 'valor'])),      // CONFIRMAR
    preco_atacado: centavos(primeiro(p, ['valor_venda_atacado'])),                              // CONFIRMAR
    custo: centavos(primeiro(p, ['valor_custo', 'custo_medio', 'preco_custo'])),                // CONFIRMAR
    unidade: String(primeiro(p, ['unidade.sigla', 'unidade_saida.sigla', 'unidade']) || 'un').toLowerCase().slice(0, 10),
    categoria: primeiro(p, ['categoria.descricao', 'categoria.nome', 'categoria']),
    marca: primeiro(p, ['marca.descricao', 'marca.nome', 'marca']),
    ncm: primeiro(p, ['ncm.codigo', 'ncm']) ? digitos(primeiro(p, ['ncm.codigo', 'ncm'])) : null,
    cest: primeiro(p, ['cest.codigo', 'cest']) ? digitos(primeiro(p, ['cest.codigo', 'cest'])) : null,
    estoque: estoque == null || typeof estoque === 'object' ? null : Math.floor(+estoque),
    ativo: primeiro(p, ['ativo']) !== false && primeiro(p, ['ativo']) !== 0,
    imagens,
    // Grade (tamanho/cor): cada combinação vira uma variação no catálogo
    variacoes: (primeiro(p, ['grade', 'grades', 'variacoes']) || []).map((g) => ({            // CONFIRMAR
      tagplus_id: +primeiro(g, ['id', 'produto_id']) || null,
      nome: String(primeiro(g, ['descricao', 'nome', 'modalidade']) || '').trim(),
      preco: centavos(primeiro(g, ['valor_venda_varejo', 'valor_venda'])),
      estoque: primeiro(g, ['estoque.qtd_revenda', 'qtd_revenda', 'estoque']),
    })).filter((v) => v.nome),
  };
}

// ---------------------------------------------------------------- catálogo → TagPlus (cliente)
export function clienteParaTagPlus(pedido, cfg) {
  const doc = digitos(pedido.cliente_cpf_cnpj);
  return {
    razao_social: pedido.cliente_nome,                       // CONFIRMAR (pessoa física: "nome"?)
    tipo: doc.length === 14 ? 'J' : 'F',                     // CONFIRMAR
    ...(doc.length === 11 ? { cpf: doc } : doc.length === 14 ? { cnpj: doc } : {}),
    contatos: [{ tipo_contato: 'celular', descricao: digitos(pedido.cliente_telefone) }],   // CONFIRMAR
    ...(pedido.endereco ? {
      enderecos: [{ logradouro: pedido.endereco, complemento: pedido.referencia || '', principal: true }], // CONFIRMAR
    } : {}),
    observacoes: `Cadastrado pelo catálogo ${cfg?.nome || ''}`.trim(),
  };
}

// ---------------------------------------------------------------- catálogo → TagPlus (pedido de venda)
export function pedidoParaTagPlus(pedido, itens, { clienteId, formaPagamentoId } = {}) {
  const pag = { pix_chave: 'Pix', pix_atendente: 'Pix (atendente)', cartao: 'Cartão na entrega', dinheiro: 'Dinheiro' }[pedido.pagamento];
  return {
    cliente: clienteId,                                       // CONFIRMAR (id do cliente)
    numero_pedido_cliente: pedido.codigo,                     // CONFIRMAR: guarda o código do catálogo
    data_entrega: null,
    observacoes: [
      `Pedido ${pedido.codigo} via catálogo`,
      `Pagamento: ${pag}${pedido.troco_para ? ` (troco p/ R$ ${reais(pedido.troco_para)})` : ''}`,
      pedido.recebimento === 'entrega' ? `Entrega: ${pedido.endereco}${pedido.referencia ? ' — ' + pedido.referencia : ''}` : 'Retirada na loja',
      pedido.observacoes ? `Obs.: ${pedido.observacoes}` : '',
    ].filter(Boolean).join('\n'),
    valor_frete: reais(pedido.taxa_entrega) || 0,             // CONFIRMAR
    itens: itens.map((i) => ({
      produto_servico: i.tagplus_variacao_id || i.tagplus_produto_id,   // CONFIRMAR (id do produto no TagPlus)
      qtd: i.quantidade,                                                // CONFIRMAR
      valor_unitario: reais(i.preco_unit),                              // exige permissão "Modificar o Valor Unitário"
      detalhes: i.variacao || undefined,
    })),
    ...(formaPagamentoId ? { faturas: [{ forma_pagamento: formaPagamentoId, valor: reais(pedido.total) }] } : {}), // CONFIRMAR
  };
}

// ---------------------------------------------------------------- catálogo → TagPlus (nota fiscal)
// NFC-e para consumidor final (CPF opcional); NF-e quando houver CNPJ ou quando o lojista pedir.
export function notaParaTagPlus(pedido, { tagplusPedidoId, clienteId }) {
  return {
    pedido: tagplusPedidoId,                                  // CONFIRMAR: gerar a nota a partir do pedido
    ...(clienteId ? { cliente: clienteId } : {}),
    ...(pedido.cliente_cpf_cnpj ? { cpf_cnpj_consumidor: digitos(pedido.cliente_cpf_cnpj) } : {}),   // CONFIRMAR
    enviar_sefaz: true,                                       // CONFIRMAR: transmitir ao salvar
  };
}

// ---------------------------------------------------------------- TagPlus → catálogo (nota)
export function notaDoTagPlus(n) {
  const situacao = String(primeiro(n, ['status', 'situacao', 'status_sefaz']) || '').toLowerCase();  // CONFIRMAR
  const status = /autoriz|aprovad/.test(situacao) ? 'autorizada'
    : /cancel/.test(situacao) ? 'cancelada'
    : /rejeit|deneg|erro/.test(situacao) ? 'rejeitada' : 'solicitada';
  return {
    id: +n.id,
    numero: primeiro(n, ['numero', 'numero_nota']),
    chave: primeiro(n, ['chave_acesso', 'chave']),
    status,
    url: primeiro(n, ['link_danfe', 'url_danfe', 'danfe', 'link_consulta']),
    erro: status === 'rejeitada' ? primeiro(n, ['motivo', 'mensagem_sefaz', 'retorno_sefaz']) : null,
  };
}

// Webhook: evento → o que fazer
export function tarefaDoWebhook(evento) {
  if (/^produto_/.test(evento)) return 'atualizar_produto';
  if (/^(nfe|nfce|nota)/.test(evento)) return 'atualizar_nota';
  if (/^pedido_/.test(evento)) return 'atualizar_pedido';
  if (/estoque|ajuste/.test(evento)) return 'atualizar_produto';
  return null;
}
