/* Primeiro contacto: regista números já atendidos para mostrar o menu
   de boas-vindas só a quem chega com saudação/menu.
   Ficheiro: src/dados/primeiro-contacto.json (só dígitos, sem conteúdo sensível). */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'primeiro-contacto.json');

const SAUDACAO = /^(ol[aá]|oi|o[ií]|bom dia|boa tarde|boa noite|menu|ajuda|help|come[cç]ar|iniciar|start|in[ií]cio|op[cç][oõ]es)$/i;

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardar(obj) {
  try { fs.writeFileSync(FICHA, JSON.stringify(obj)); } catch (e) {}
}
function chave(jid) { return String(jid).replace(/\D/g, ''); }

function jaViu(jid) { return !!ler()[chave(jid)]; }
function marcarVisto(jid) {
  const obj = ler();
  obj[chave(jid)] = new Date().toISOString().slice(0, 10);
  guardar(obj);
}
function ehSaudacao(texto) { return SAUDACAO.test(String(texto || '').trim()); }

module.exports = { jaViu, marcarVisto, ehSaudacao };