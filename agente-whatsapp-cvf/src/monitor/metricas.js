/* Métricas simples em JSON local: contadores de mensagens, erros, formulários, etc.
   Guardado em src/dados/metricas.json. Não é base de dados, só contadores. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'metricas.json');

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardar(obj) { fs.writeFileSync(FICHA, JSON.stringify(obj, null, 1)); }

function chaveDia() { return new Date().toISOString().slice(0, 10); }

function inc(campo, quantidade) {
  const dados = ler();
  const dia = chaveDia();
  if (!dados[dia]) dados[dia] = {};
  if (!dados[dia][campo]) dados[dia][campo] = 0;
  dados[dia][campo] += quantidade || 1;
  guardar(dados);
  return dados[dia][campo];
}

function obter(campo) {
  const dados = ler();
  const dia = chaveDia();
  return (dados[dia] && dados[dia][campo]) || 0;
}

function resumo() {
  return ler();
}

module.exports = { inc, obter, resumo };