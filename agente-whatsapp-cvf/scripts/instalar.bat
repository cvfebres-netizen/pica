@echo off
:: ============================================================
:: Instalador standalone — Agente WhatsApp Clínica Veterinária CVF
:: Executa: 1 clique para instalar dependências, validar sintaxe e preparar o .env
:: ============================================================
cd /d "%~dp0.."

echo [1/4] A verificar Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o LTS em https://nodejs.org e corra de novo.
  pause
  exit /b 1
)

echo [2/4] A instalar dependencias (npm install)...
call npm install
if errorlevel 1 (
  echo [ERRO] npm install falhou.
  pause
  exit /b 1
)

echo [3/4] A criar .env a partir do .env.exemplo...
if not exist .env (
  copy .env.exemplo .env >nul
  echo .env criado. Preencha agora as variaveis (TELEFONE_CLINICA, NOME_CLINICA, PAINEL_USER, PAINEL_PASS, etc.)
) else (
  echo .env ja existe — nao sobrescrevi.
)

echo [4/4] A validar sintaxe de todos os ficheiros JS...
setlocal enabledelayedexpansion
set ERRO=0
for %%f in (src\*.js src\atendimento\*.js src\agenda\*.js src\gateway\*.js src\monitor\*.js src\web\*.js src\config\*.js scripts\*.js test\*.js) do (
  node --check "%%f" >nul 2>&1
  if errorlevel 1 (
    echo [ERRO de sintaxe] %%f
    node --check "%%f"
    set ERRO=1
  )
)
if !ERRO! equ 1 (
  echo.
  echo Corrija os erros acima e volte a executar o instalador.
  pause
  exit /b 1
)
echo Todos os ficheiros validos.

endlocal
echo.
echo ============================================================
echo INSTALACAO CONCLUIDA COM SUCESSO
echo ============================================================
echo Proximos passos:
echo   1. Edite o ficheiro .env com os dados da clinica.
echo   2. Ligue o Google Calendar (1 vez):   npm run ligar-google
echo   3. Emparelhe o WhatsApp Business:      npm start  (leia o QR no telemovel)
echo   4. Opcional: inicie o painel web:      npm run painel
echo   5. Opcional: teste lembretes diarios:  npm run lembretes
echo   6. Opcional: verifique respostas:      node src/config/verificar-respostas.js
echo.
pause
