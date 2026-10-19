/* Backup automático dos ficheiros JSON de dados.
   Copia src/dados/*.json para src/backups/YYYY-MM-DD/ com timestamp.
   Uso: node scripts/backup-dados.js   (pode ser chamado por cron ou no encerramento) */
const fs = require('fs');
const path = require('path');

const PASTA_DADOS = path.join(__dirname, '..', 'src', 'dados');
const PASTA_BACKUP = path.join(__dirname, '..', 'src', 'backups');

const FICHEIROS = [
  'pendentes.json',
  'historico.json',
  'listaEspera.json',
  'formulario-estados.json',
  'escalation.json',
  'metricas.json',
  'gateway-state.json'
];

function garantirPasta(pasta) {
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
}

function copiar(ficheiro) {
  const origem = path.join(PASTA_DADOS, ficheiro);
  if (!fs.existsSync(origem)) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  const agora = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
  const destinoPasta = path.join(PASTA_BACKUP, hoje);
  garantirPasta(destinoPasta);
  const destino = path.join(destinoPasta, agora + '-' + ficheiro);
  fs.copyFileSync(origem, destino);
  return true;
}

function executar() {
  garantirPasta(PASTA_BACKUP);
  let copiados = 0;
  for (const f of FICHEIROS) {
    if (copiar(f)) copiados++;
  }
  console.log('Backup concluído: ' + copiados + '/' + FICHEIROS.length + ' ficheiros copiados para ' + PASTA_BACKUP);
  return copiados;
}

if (require.main === module) executar();
module.exports = { executar };
