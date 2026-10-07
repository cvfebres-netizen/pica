/* Verificação de sintaxe dos ficheiros .gs (uso local, não vai para o Apps Script). */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = path.join(__dirname);
const files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.gs'); });
let maus = 0;

files.forEach(function(f) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    new vm.Script(src, { filename: f });
    console.log('OK     ' + f);
  } catch (e) {
    maus++;
    console.log('ERRO   ' + f + ' :: ' + e.message);
  }
});

console.log(maus === 0
  ? 'RESULTADO: todos os ficheiros .gs tem sintaxe valida'
  : 'RESULTADO: ' + maus + ' ficheiro(s) com erro de sintaxe');

/* Sem isto o script|reportava o erro e saía com 0 — ou seja, uma
   verificação que nunca pode falhar não serve de verificação. Qualquer
   chamada em cadeia (foreach de suites) viava o ficheiro partido. */
process.exitCode = maus === 0 ? 0 : 1;
