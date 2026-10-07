/* Verificacao final: corre as suites, repete a simulacao para detectar
   nao-determinismo e confirma que a pasta de upload (picadeploy) esta
   sincronizada com o codigo fonte. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const linhas = [];
function registrar(t, e) { linhas.push(t + ': ' + e); }

/* Lista completa: a versao anterior deixava de fora
   _check_frontend_responsivo.js, _check_documentacao.js e _check_referencias.js
   — tres suites que nunca eram executadas por aqui. */
/* As duas auditorias de interligacao entram AQUI, e nao como scripts a
   correr a mao. Antes elas viviam de fora: a `_auditoria_prova_execucao.js`
   estava vermelha (FALHAS_PROVA:1) ha dias e nenhuma verificacao a via —
   o mesmo modo de falhar que a propria LEIA-ME descreve quando o
   `picadeploy` divergiu. Uma auditoria que ninguem executa no caminho
   normal nao e' uma auditoria. */
const SUITES = ['_check_sintaxe.js', '_check_duplicados.js', '_check_frontend.js',
  '_check_frontend_responsivo.js', '_check_interface.js', '_check_geral.js',
  '_check_documentacao.js', '_check_referencias.js', '_check_hardening.js', '_check_horas.js',
  '_auditoria_interligacoes.js', '_auditoria_prova_execucao.js', '_simular.js'];

let falhas = 0;
SUITES.forEach(function (s) {
  const p = path.join(dir, s);
  if (!fs.existsSync(p)) { registrar('AUSENTE ' + s, 'nao encontrado'); falhas++; return; }
  try {
    const out = execFileSync(process.execPath, [p], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const avisos = (out.match(/^\s*!!/gm) || []).length;
    registrar(s, 'OK' + (avisos ? ' (' + avisos + ' aviso(s))' : ''));
  } catch (e) {
    registrar(s, 'FALHOU exit=' + e.status);
    falhas++;
  }
});

/* Nao-determinismo: `_simular.js` usa geradores, `Utilities.getUuid` e
   relogios. Uma unica passagem verde nao prova que o resultado e estavel.
   Por omissao 3 repeticoes (cada uma demora dezenas de segundos com 1 ano
   de historico simulado) — a versao anterior fazia 100 e excedia o tempo
   maximo do terminal, sem dar resultado. Para mais: REPETICOES=20 node ... */
const REPETICOES = Math.max(1, Number(process.env.REPETICOES) || 3);
let instaveis = 0;
for (let i = 1; i <= REPETICOES; i++) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, '_simular.js')], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (out.indexOf('TODOS OS CENARIOS PASSARAM') === -1) instaveis++;
  } catch (e) { instaveis++; }
}
registrar('_simular.js x' + REPETICOES, instaveis === 0 ? 'ESTAVEL (0 falhas)' : 'INSTAVEL: ' + instaveis + ' execucoes');
if (instaveis) falhas++;

/* Pasta de upload. A versao anterior comparava contra a pasta
   `pica_upload_final`, que nunca existiu: a verificacao era saltada e a
   pasta desatualizada passava sem dar erro. Agora a comparacao e feita pelos
   bytes, por _comparar_pasta.js (pica <-> picadeploy). */
try {
  execFileSync(process.execPath, [path.join(dir, '_comparar_pasta.js')], { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  registrar('_comparar_pasta.js', 'SINCRONIZADO (pica = picadeploy)');
} catch (e) {
  registrar('_comparar_pasta.js', 'DIVERGENCIA — a pasta de upload NAO esta a par do codigo');
  String(e.stdout || '').split('\n').filter(function (l) { return /DIVERGENCIA|OK|DIFERENTE|ausente|não existe/i.test(l); })
    .forEach(function (l) { console.log('    ' + l.trim()); });
  falhas++;
}

console.log('\n===== VERIFICACAO FINAL =====');
linhas.forEach(function (l) { console.log('  ' + l); });
console.log('FALHAS_GLOBAIS:' + falhas);
process.exitCode = falhas ? 1 : 0;