// Gera o "Pix Copia e Cola" (BR Code estático, padrão EMV do Banco Central)
// com valor e identificador do pedido. Funciona em qualquer app de banco.

function campo(id, valor) {
  return id + String(valor.length).padStart(2, '0') + valor;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function semAcento(s, max) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase().trim().slice(0, max);
}

// Normaliza a chave conforme o tipo cadastrado
export function normalizarChave(tipo, chave) {
  const c = (chave || '').trim();
  if (tipo === 'cpf' || tipo === 'cnpj') return c.replace(/\D/g, '');
  if (tipo === 'telefone') {
    const d = c.replace(/\D/g, '');
    return '+' + (d.startsWith('55') ? d : '55' + d);
  }
  if (tipo === 'email') return c.toLowerCase();
  return c; // aleatória (EVP)
}

export function brCode({ tipo, chave, titular, cidade, valorCentavos, txid }) {
  const gui = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChave(tipo, chave));
  const id = (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let payload =
    campo('00', '01') +
    campo('26', gui) +
    campo('52', '0000') +
    campo('53', '986') +
    (valorCentavos > 0 ? campo('54', (valorCentavos / 100).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', semAcento(titular, 25) || 'LOJA') +
    campo('60', semAcento(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', id)) +
    '6304';
  return payload + crc16(payload);
}
