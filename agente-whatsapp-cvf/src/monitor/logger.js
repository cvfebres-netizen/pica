/* Logger simples: escreve para consola e para ficheiro com rotação diária.
   Níveis: info, warn, error. Ficheiro: src/logs/app-YYYY-MM-DD.log */
const fs = require('fs');
const path = require('path');

const PASTA_LOGS = path.join(__dirname, '..', 'logs');

function garantirPasta() {
  if (!fs.existsSync(PASTA_LOGS)) {
    fs.mkdirSync(PASTA_LOGS, { recursive: true });
  }
}

function nomeFicheiro() {
  const hoje = new Date().toISOString().slice(0, 10);
  return path.join(PASTA_LOGS, 'app-' + hoje + '.log');
}

function formato(nivel, mensagem) {
  const ts = new Date().toISOString();
  return '[' + ts + '] [' + nivel.toUpperCase() + '] ' + mensagem;
}

function escrever(nivel, mensagem) {
  garantirPasta();
  const linha = formato(nivel, mensagem) + '\n';
  try {
    fs.appendFileSync(nomeFicheiro(), linha);
  } catch (e) { /* se não conseguir escrever ficheiro, ignora */ }
  if (nivel === 'error') {
    console.error(linha.trim());
  } else {
    console.log(linha.trim());
  }
}

module.exports = {
  info: (m) => escrever('info', m),
  warn: (m) => escrever('warn', m),
  error: (m) => escrever('error', m)
};