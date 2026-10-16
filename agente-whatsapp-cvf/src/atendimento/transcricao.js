/* Transcrição de áudio WhatsApp.
   O cliente envia áudio/voz; o agente tenta transformar em texto e tratar como mensagem normal.
   Sem serviço STT configurado devolve null (agente pede para escrever). */
const fs = require('fs');
const path = require('path');

async function transcreverAudio(buffer) {
  // --- Opção A: Whisper local (whisper.cpp) via linha de comando ---
  // Grava o buffer para um ficheiro temporário, corre whisper e lê o stdout.
  // Exemplo (adaptar ao caminho do teu whisper-cli):
  //   const tmp = path.join(__dirname, '..', 'dados', 'tmp-audio.ogg');
  //   fs.writeFileSync(tmp, buffer);
  //   const { execSync } = require('child_process');
  //   const out = execSync(`whisper-cli -m model.bin -f ${tmp} -otxt`, { encoding: 'utf8' });
  //   fs.unlinkSync(tmp);
  //   return out.trim() || null;

  // --- Opção B: OpenAI Whisper API (precisa de OPENAI_API_KEY) ---
  //   const { Configuration, OpenAIApi } = require('openai');
  //   ...

  return null; // não conseguiu transcrever
}

module.exports = { transcreverAudio };
