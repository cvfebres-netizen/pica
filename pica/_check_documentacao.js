/* Verifica que a documentacao diz o que o codigo faz.
   Cada numero citado na LEIA-ME e no todo.txt e extraido do codigo e
   comparado. Se alguem mudar o codigo e esquecer a documentacao, este
   script falha em vez de deixar o texto errado passar. */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const L = f => fs.readFileSync(path.join(dir, f), 'utf8');

const cfg = L('Config.gs');
const leia = L('LEIA-ME.md');
const todo = L('todo.txt');

let erros = 0, avisos = 0;
function falha(msg) { erros++; console.log('ERRO  ' + msg); }
function aviso(msg) { avisos++; console.log('AVISO ' + msg); }
function ok(msg) { console.log('ok    ' + msg); }

/* ---- 1. Numeros de configuracao que a documentacao cita ---- */
const regras = [
  ['VERSAO', /VERSAO:\s*'([^']+)'/, () => cfg, null],
  ['MAX_TENTATIVAS_LOGIN', /MAX_TENTATIVAS_LOGIN:\s*(\d+)/, () => cfg, 8],
  ['BLOQUEIO_MINUTOS', /BLOQUEIO_MINUTOS:\s*(\d+)/, () => cfg, 15],
  ['BLOQUEIO_MINUTOS_REINCIDENTE', /BLOQUEIO_MINUTOS_REINCIDENTE:\s*(\d+)/, () => cfg, 60],
  ['BLOQUEIO_LONGO_A_PARTIR_DE', /BLOQUEIO_LONGO_A_PARTIR_DE:\s*(\d+)/, () => cfg, 2],
  ['RECINCIDENCIA_ESQUECE_APOS_HORAS', /RECINCIDENCIA_ESQUECE_APOS_HORAS:\s*(\d+)/, () => cfg, 24],
  ['SESSAO_MINUTOS', /SESSAO_MINUTOS:\s*(\d+)/, () => cfg, 480]
];
regras.forEach(function(r) {
  const m = r[1].exec(r[2]());
  if (!m) return falha(r[0] + ': nao encontrado em Config.gs');
  if (r[3] !== null && m[1] !== String(r[3])) return falha(r[0] + ': codigo=' + m[1] + ' doc=' + r[3]);
  if (leia.indexOf(m[1]) === -1) return aviso(r[0] + ' (' + m[1] + ') nao aparece na LEIA-ME');
  ok(r[0] + ' = ' + m[1]);
});

/* ---- 2. Sabado = dia normal completo (a regra do cliente) ---- */
const sabBloco = /SABADO:\s*\[([\s\S]*?)\]/.exec(cfg);
if (!sabBloco) falha('HORARIO.SABADO nao encontrado');
else {
  const turnos = sabBloco[1].match(/inicio:/g) || [];
  if (turnos.length !== 2) falha('SABADO tem ' + turnos.length + ' turno(s); esperado 2 (dia normal completo)');
  else ok('SABADO = dia normal completo (2 turnos)');
}
const semanaTurnos = (HOR = {}) => { const b = /SEMANA:\s*\[([\s\S]*?)\]\s*,\s*\/\*[\s\S]*?\*\/\s*SABADO/.exec(cfg); return b ? (b[1].match(/inicio:/g) || []).length : -1; };
if (semanaTurnos() !== 2) falha('SEMANA nao tem 2 turnos');
else ok('SEMANA = 2 turnos');

/* ---- 3. Credenciais: os 4 logins do cliente, sem alteracoes ---- */
const cred = /CREDENCIAIS_INICIAIS\s*=\s*\[([\s\S]*?)\];/.exec(cfg);
if (!cred) falha('CREDENCIAIS_INICIAIS nao encontrado');
else {
  const linhas = cred[1].split('\n').map(l => l.trim()).filter(l => l.startsWith("['"));
  if (linhas.length !== 4) falha('CREDENCIAIS_INICIAIS tem ' + linhas.length + ' entradas; esperado 4');
  linhas.forEach(function(l) {
    const partes = l.match(/'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/);
    if (!partes) return falha('linha de credencial ilegivel: ' + l);
    const email = partes[2], pass = partes[3];
    if (leia.indexOf(email) === -1) return falha('email ausente da LEIA-ME: ' + email);
    if (leia.indexOf(pass) === -1) return falha('password ausente da LEIA-ME: ' + email);
  });
  if (erros === 0) ok('4 credenciais presentes e intactas na LEIA-ME');
}

/* ---- 4. Numeros de folhas e de separadores ---- */
const folhaNomes = /const SHEETS\s*=\s*\{([\s\S]*?)\n\};/.exec(cfg);
const nFolhas = folhaNomes ? (folhaNomes[1].match(/:\s*'/g) || []).length : -1;
if (nFolhas !== 19) falha('SHEETS tem ' + nFolhas + ' entradas; LEIA-ME diz 19');
else if (leia.indexOf('Sheets criadas (19)') === -1) falha('LEIA-ME nao diz "Sheets criadas (19)"');
else ok('19 sheets, declarado na LEIA-ME');

const html = L('index.html');
const tabBloco = /TAB_ORDER\s*=\s*\[([\s\S]*?)\n\];/.exec(html);
const nTabs = tabBloco ? (tabBloco[1].match(/id:\s*'/g) || []).length : -1;
const nAdmin = tabBloco ? (tabBloco[1].match(/adminOnly:\s*true/g) || []).length : -1;
/* Os numeros saem da LEIA-ME, e nao de uma constante colada aqui. Com "23" e
   "16" escritos a mao, acrescentar um separador obrigava a mexer em tres
   sítios ao mesmo tempo — e o teste era o terceiro deles, ou seja, o
   ultimo a ser lembrado. Agora a LEIA-ME e' a verdade: se o texto nao
   bater com o codigo, falha. */
const docTabs = /(\d+) separadores\.\s*Os (\d+) primeiros/.exec(leia.replace(/\s+/g, ' '));
if (!docTabs) falha('a LEIA-ME nao diz "N separadores. Os M primeiros so para ADMIN"');
else if (nTabs !== Number(docTabs[1])) falha('TAB_ORDER tem ' + nTabs + ' separadores; LEIA-ME diz ' + docTabs[1]);
else if (nAdmin !== Number(docTabs[2])) falha('separadores adminOnly=' + nAdmin + '; LEIA-ME diz ' + docTabs[2]);
else ok(nTabs + ' separadores (' + nAdmin + ' admin + ' + (nTabs - nAdmin) + ' colaborador), declarado na LEIA-ME');

/* ---- 5. Suites e cenarios ---- */
const suites = fs.readdirSync(dir).filter(f => /^_check_.*\.js$/.test(f) || f === '_simular.js');
const nCen = new Set((L('_simular.js').match(/CENARIO \d+/g) || []).map(s => s.split(' ')[1]));
/* Este proprio ficheiro conta-se: a documentacao deve listar todas as suites.
 * A contagem vem das linhas da tabela da LEIA-ME, nao de um numero fixo: assim
 * acrescentar uma suite e a respetiva linha na doc passa, e esquecer a linha
 * falha — sem nunca mais haver um "8" magico para atualizar a mao.
 */
const linhasSuite = (leia.match(/^\| `_(?:check_[a-z_]+|simular)\.js` \|/gm) || []).length;
if (linhasSuite !== suites.length) falha('existem ' + suites.length + ' suites mas a LEIA-ME lista ' + linhasSuite);
else ok(suites.length + ' suites, todas listadas na LEIA-ME');
suites.forEach(function(s) {
  if (leia.indexOf(s) === -1) return falha('suite nao documentada: ' + s);
  if (todo.indexOf(s) === -1) return aviso('suite ausente do todo.txt: ' + s);
});
/* O numero vem da propria tabela da LEIA-ME, nao de uma constante aqui:
   acrescentar um cenario obriga a actualizar a frase da doc, e o checker
   deixa de ter um "18" magico para se desactualizar sozinho. */
const cenDoc = (leia.match(/`_simular\.js` \| (\d+) cenarios/) || [])[1];
if (cenDoc === undefined) falha('LEIA-ME nao diz quantos cenarios tem o _simular.js');
else if (Number(cenDoc) !== nCen.size)
  falha('_simular.js tem ' + nCen.size + ' cenarios; LEIA-ME diz ' + cenDoc);
else ok(nCen.size + ' cenarios de simulacao, declarado na LEIA-ME');

/* TODO o texto que diz "N cenarios" ou "N suites", e nao so a linha da tabela.
   A LEIA-ME anunciava 20 cenarios na tabela e 18 no corpo do texto, e o
   todo.txt dizia 19 cenarios + 8 suites: tres numeros errados em tres sitios,
   nenhum apanhado porque a verificacao so olhava para a tabela. Aqui cada
   mencao e conferida contra o que existe mesmo em disco.

   O texto e normalizado antes da busca porque no Markdown o numero e o
   substantivo caem muitas vezes em linhas diferentes ("corre 20\ncenarios"):
   um padrao que exige um espaco entre os dois nao via nada. Foi exatamente o
   que aconteceu na primeira versao deste bloco. */
[[leia, 'LEIA-ME.md'], [todo, 'todo.txt']].forEach(function (par) {
  const plano = par[0].replace(/\s+/g, ' '), nome = par[1];
  (plano.match(/\b\d+ cenarios?\b/g) || []).forEach(function (m) {
    const n = Number(/\d+/.exec(m)[0]);
    if (n !== nCen.size) falha(nome + ': diz "' + m.trim() + '" mas _simular.js tem ' + nCen.size);
  });
  (plano.match(/\b\d+ suites\b/g) || []).forEach(function (m) {
    const n = Number(/\d+/.exec(m)[0]);
    if (n !== suites.length) falha(nome + ': diz "' + m.trim() + '" mas existem ' + suites.length);
  });
});
ok('contagens de cenarios e suites conferidas em todo o texto');

/* ---- 5b. Ferramentas de sincronizacao: tem de existir e estar documentada ----
   Estas ferramentas sao o que impede a divergencia entre as duas copias. Se
   uma delas desaparecer sem a doc dizer, o problema volta em silencio. */
['_sincronizar.js', '_comparar_pasta.js', '_verificacao_final.js', '_layout_probe.js'].forEach(function (f) {
  if (!fs.existsSync(path.join(dir, f))) return falha('ferramenta de sincronizacao ausente: ' + f);
  if (leia.indexOf('`' + f + '`') === -1) return falha('ferramenta nao documentada na LEIA-ME: ' + f);
});
ok('ferramentas de sincronizacao presentes e documentadas');

/* Nenhuma referencia a um ZIP: a entrega e uma PASTA de ficheiros. Se voltar
   a aparecer, e porque a documentacao ficou a descrever um artefacto antigo. */
[['LEIA-ME.md', leia], ['todo.txt', todo]].forEach(function (par) {
  if (par[1].indexOf('Pica_upload') !== -1) falha(par[0] + ' ainda fala em Pica_upload (a entrega e uma pasta, nao um ZIP)');
  if (par[1].indexOf('_empacotar') !== -1) falha(par[0] + ' ainda fala em _empacotar (a ferramenta agora e _sincronizar)');
  if (par[1].indexOf('_comparar_zip') !== -1) falha(par[0] + ' ainda fala em _comparar_zip (a ferramenta agora e _comparar_pasta)');
});
ok('documentacao sem referencias ao ZIP antigo');

/* ---- 6. Ficheiros de producao documentados ---- */
const prod = fs.readdirSync(dir).filter(f => f.endsWith('.gs') || f === 'index.html' || f === 'appsscript.json');
const docTab = L('LEIA-ME.md').match(/\| `([^`]+\.gs)` \||\| `index\.html` \||\| `appsscript\.json` \|/g) || [];
prod.forEach(function(f) {
  if (leia.indexOf('`' + f + '`') === -1) return falha('ficheiro de producao nao documentado: ' + f);
});
if (erros === 0) ok(prod.length + ' ficheiros de producao documentados');

/* ---- 7. Nao deixar lixo deUTF/encoding nem ingles baralhado ---- */
['LEIA-ME.md', 'todo.txt'].forEach(function(f) {
  const t = L(f);
  if (/\uFFFD/.test(t)) falha(f + ': carater invalido (encoding)');
  if (/[\u4e00-\u9fff]/.test(t)) falha(f + ': caracteres CJK nao pertencem');
});
ok('encoding dos documentos');

console.log('');
console.log(erros ? 'RESULTADO: ' + erros + ' erro(s), ' + avisos + ' aviso(s)' : 'RESULTADO: 0 erro(s), ' + avisos + ' aviso(s)');
process.exit(erros ? 1 : 0);
