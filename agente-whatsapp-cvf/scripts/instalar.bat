@echo off
REM Instala o agente WhatsApp CVF no PC da clinica. 1 clique.
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Instale o Node.js LTS em https://nodejs.org e corra de novo.
  pause
  exit /b 1
)
call npm install
if not exist .env copy .env.exemplo .env
echo.
echo OK. Agora:
echo   1. Preencha o .env (telefone, morada, horario)
echo   2. npm run ligar-google
echo   3. npm start  (leia o QR com o WhatsApp Business)
pause
