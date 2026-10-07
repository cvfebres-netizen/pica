/* Espelha o codigo de producao da pasta pica na pasta picadeploy, que e a
   pasta que se carrega no Apps Script.

   Motivo: existem duas copias do mesmo codigo (pica e picadeploy) e ja
   divergiram — o picadeploy tinha a versao antiga, com defeitos de cache e
   de bloqueio. Este script torna a divergencia impossivel: a pasta pica e a
   unica fonte; o picadeploy e gerado.

   Nao ha ZIP: os ficheiros sao copiados com os mesmos bytes, o que e o que
   o `clasp push` envia. */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PICA = __dirname;
const DEPLOY = path.join(RAIZ, 'picadeploy');

/* O Apps Script so aceita estes ficheiros, na RAIZ (sem subpastas).
   A lista e explicita de proposito: um .gs novo tem de ser adicionado aqui
   e na documentacao, para nao ser esquecido. */
const MANIFESTO = [
  'appsscript.json',
  'index.html',
  'Calendario.gs',
  'Config.gs',
  'Consultas.gs',
  'Gestao.gs',
  'Motor.gs',
  'Persistencia.gs',
  'Relatorios.gs',
  'ResumosBackups.gs',
  'RotacaoLeitura.gs',
  'Seguranca.gs',
  'Setup.gs',
  'Utilitarios.gs',
  'WebApp.gs'
];

let erro = 0;
function falhar(msg) { erro++; console.error('ERRO  ' + msg); }

/* ---- 1. Recolher e validar ---- */
const entradas = [];
MANIFESTO.forEach(function (nome) {
  const p = path.join(PICA, nome);

  if (!fs.existsSync(p)) return falhar('falta o ficheiro de producao: ' + nome);
  const dados = fs.readFileSync(p);
  /* UTF-8 sem BOM: o Apps Script le o manifesto como JSON estrito e um BOM
     faz o editor rejeitar o manifesto. */
  if (dados[0] === 0xEF && dados[1] === 0xBB && dados[2] === 0xBF)
    return falhar(nome + ' tem BOM UTF-8; gravar sem BOM');
  entradas.push({ nome: nome, dados: dados });
});

/* Trava de seguranca: o manifesto e o ficheiro que decide o que o Apps
   Script executa. Confere que nao entrou nada por engano. */
try {
  const m = JSON.parse(entradas.find(function (e) { return e.nome === 'appsscript.json'; }).dados.toString('utf8'));
  if (m.timeZone !== 'Europe/Lisbon') falhar('manifesto: timeZone = ' + m.timeZone + '; esperado Europe/Lisbon');
  if (m.runtimeVersion !== 'V8') falhar('manifesto: runtimeVersion = ' + m.runtimeVersion + '; esperado V8');
  if (!m.webapp || m.webapp.access !== 'ANYONE') falhar('manifesto: webapp.access tem de ser ANYONE');
} catch (e) { falhar('appsscript.json nao e JSON valido: ' + e.message); }

if (erro) { console.error('\nSINCRONIZACAO ABORTADA (' + erro + ' problema(s))'); process.exit(1); }

/* ---- 2. Espelhar em picadeploy (mesmos bytes, para o `clasp push`) ---- */
if (!fs.existsSync(DEPLOY)) {
  console.log('\npicadeploy nao existe; nada a sincronizar.');
  process.exit(0);
}

entradas.forEach(function (e) {
  const destino = path.join(DEPLOY, e.nome);
  const antigo = fs.existsSync(destino) ? fs.readFileSync(destino) : null;
  if (!antigo || !antigo.equals(e.dados)) {
    fs.writeFileSync(destino, e.dados);
    console.log('  picadeploy: ' + e.nome + (antigo ? ' (atualizado)' : ' (novo)'));
  }
});

/* Apagar do picadeploy o que nao e de producao: um .gs a mais ali seria
   enviado no proximo `clasp push` e duplicaria funcoes. O `.clasp.json`
   (scriptId) e o unico ficheiro preservado: e o que liga a pasta ao
   projecto do Apps Script. */
fs.readdirSync(DEPLOY).forEach(function (f) {
  if (MANIFESTO.indexOf(f) === -1) {
    const p = path.join(DEPLOY, f);
    if (fs.statSync(p).isFile() && f !== '.clasp.json') {
      fs.rmSync(p);
      console.log('  picadeploy: ' + f + ' (removido, nao e de producao)');
    }
  }
});

/* Subpastas nao sao enviadas pelo clasp e denunciam lixo esquecido. */
fs.readdirSync(DEPLOY).forEach(function (f) {
  if (fs.statSync(path.join(DEPLOY, f)).isDirectory()) {
    console.error('ERRO  picadeploy tem a subpasta ' + f + '; o Apps Script so aceita ficheiros na raiz');
    erro++;
  }
});

console.log('\n' + (erro ? 'SINCRONIZACAO COM ' + erro + ' PROBLEMA(S)' : 'picadeploy sincronizado: ' + entradas.length + ' ficheiros de producao'));
console.log('Pasta a carregar: ' + DEPLOY);
process.exit(erro ? 1 : 0);