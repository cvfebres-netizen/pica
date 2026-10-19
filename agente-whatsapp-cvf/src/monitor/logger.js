/* Logger simples: escreve para consola e para ficheiro com rotação diária.
   Níveis: info, warn, error. Ficheiro: src/logs/app-YYYY-MM-DD.log
   Rotação: ao escrever, apaga logs com mais de LOG_RETENCAO_DIAS (por defeito 30).
   Também corre standalone: node src/monitor/logger.js --limpar */
const fs = require('fs');
const path = require('path');

const PASTA_LOGS = path.join(__dirname, '..', 'logs');
const RETENCAO_DIAS = Number(process.env.LOG_RETENCAO_DIAS || 30);

function limparAntigos() {
  try {
    if (!fs.existsSync(PASTA_LOGS)) return 0;
    const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
    let removidos = 0;
    for (const nome of fs.readdirSync(PASTA_LOGS)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(nome)) continue;
      const p = path.join(PASTA_LOGS, nome);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs < limite) { fs.unlinkSync(p); removidos++; }
      } catch (e) {}
    }
    return removidos;
  } catch (e) { return 0; }
}

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
  error: (m) => escrever('error', m),
  limparAntigos
};

if (process.argv.includes('--limpar')) {
  const n = limparAntigos();
  console.log('Logs antigos removidos: ' + n);
}