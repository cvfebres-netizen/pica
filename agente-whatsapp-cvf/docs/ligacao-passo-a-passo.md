# Ligação passo a passo — WhatsApp Business + Google Calendar (grátis)

## A. WhatsApp Business (5 min, 0 €)

1. No PC: `npm start`. Aparece um **QR no terminal**.
2. No telemóvel com o WhatsApp Business: **Definições → Aparelhos ligados → Ligar aparelho** → ler o QR.
3. A sessão fica guardada em `src/dados/auth_info/`. Da próxima vez liga sozinho.
4. Sessão caiu? Apague `src/dados/auth_info/` e leia novo QR.

Regras anti-ban (importantes):
- O agente **só responde a quem escreve primeiro**.
- 1 mensagem curta de cada vez, com pausa (~1,5 s).
- Sem difusão, sem spam, sem grupos.

## B. Google Calendar (10 min, 0 €, 1 vez)

**Página pública da clínica (já existe):**
https://calendar.app.google/6ZPswU6ftN2VKuUC9 — "Agendamento cliente".
É este link que o agente envia ao cliente. O cliente escolhe dia/hora,
o agente confirma e lança o evento via API. Não mexer na página,
só garantir que os horários livres estão certos.

**API (para o agente criar/mover/apagar eventos):**

1. Ir a [Google Cloud Console](https://console.cloud.google.com) → criar projeto → ativar **Google Calendar API**.
2. Criar credenciais **OAuth client ID → Desktop app**. Copiar Client ID + Secret para o `.env`.
3. Na pasta: `npm run ligar-google` → abre link no browser → login com a conta da clínica → **Permitir** → colar o código no terminal.
4. Token guardado em `src/dados/google-token.json`. Nunca publicar.
5. `GOOGLE_CALENDAR_ID`: `primary` ou o ID do calendário da clínica.

## C. Teste final (2 min)

1. `npm start` com o QR lido.
2. Do seu telemóvel pessoal, escreva ao número Business: "quero marcar consulta para o cão Rex amanhã às 10:30".
3. Confirme: resposta curta + evento no Google Calendar.
4. Teste remarcar e cancelar.

## D. Rotina diária

- PC ligado no horário da clínica, terminal com `npm start` aberto.
- Fim do dia: Ctrl+C. De manhã: `npm start`.
- `.env`, `auth_info/` e `google-token.json` nunca vão para o git nem se partilham.
