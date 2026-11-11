# verify-ollama.ps1
# End-to-end check of the local Ollama stack used by Continue and Cline.
# Usage:  pwsh -File .\verify-ollama.ps1

$ErrorActionPreference = 'Continue'
$Base = 'http://localhost:11434'

function Section([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

Section '1. Server'
try {
    $v = Invoke-RestMethod "$Base/api/version" -TimeoutSec 8
    Write-Host "PASS - Ollama $($v.version) reachable at $Base" -ForegroundColor Green
} catch {
    Write-Host "FAIL - cannot reach $Base : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Start it with:  Start-Process 'D:\Ollama\ollama app.exe'"
    exit 1
}

Section '2. Installed models'
Invoke-RestMethod "$Base/api/tags" | Select-Object -ExpandProperty models |
    Select-Object name, @{ n = 'GB'; e = { [math]::Round($_.size / 1GB, 2) } } |
    Format-Table -AutoSize

Section '3. Native tool calling (required by Cline + Continue Agent)'
$toolBody = @{
    model    = 'qwen3:4b'
    stream   = $false
    messages = @(@{ role = 'user'; content = 'What is the weather in Dublin? Use the get_weather tool.' })
    tools    = @(@{
            type     = 'function'
            function = @{
                name        = 'get_weather'
                description = 'Get current weather for a city'
                parameters  = @{
                    type       = 'object'
                    properties = @{ city = @{ type = 'string' } }
                    required   = @('city')
                }
            }
        })
} | ConvertTo-Json -Depth 10

try {
    $r = Invoke-RestMethod "$Base/api/chat" -Method Post -ContentType 'application/json' `
        -Body $toolBody -TimeoutSec 600
    if ($r.message.tool_calls) {
        Write-Host 'PASS - native tool_calls returned:' -ForegroundColor Green
        $r.message.tool_calls | ConvertTo-Json -Depth 6
    } else {
        Write-Host 'FAIL - no tool_calls; model answered with plain text (Agent mode will not work).' -ForegroundColor Red
    }
    Write-Host ('   speed: {0:N1} tok/s' -f ($r.eval_count / ($r.eval_duration / 1e9)))
} catch {
    Write-Host "FAIL - $($_.Exception.Message)" -ForegroundColor Red
}

Section '4. Embeddings (Continue @codebase)'
try {
    $e = Invoke-RestMethod "$Base/api/embed" -Method Post -ContentType 'application/json' `
        -Body (@{ model = 'nomic-embed-text'; input = 'hello world' } | ConvertTo-Json) -TimeoutSec 60
    Write-Host "PASS - $($e.embeddings[0].Count) dimensions" -ForegroundColor Green
} catch {
    Write-Host "FAIL - $($_.Exception.Message)" -ForegroundColor Red
}

Section '5. Autocomplete / fill-in-the-middle (qwen2.5-coder)'
try {
    $fim = Invoke-RestMethod "$Base/api/generate" -Method Post -ContentType 'application/json' `
        -Body (@{
            model   = 'qwen2.5-coder:7b'
            prompt  = "def add(a, b):`n    return "
            suffix  = "`n`nprint(add(1, 2))"
            stream  = $false
            options = @{ num_predict = 24 }
        } | ConvertTo-Json) -TimeoutSec 600
    Write-Host "PASS - completion: $($fim.response)"
} catch {
    Write-Host "FAIL - $($_.Exception.Message)" -ForegroundColor Red
}

Section '6. Loading / keep-alive state'
$ps = Invoke-RestMethod "$Base/api/ps" -TimeoutSec 10
if ($ps.models) {
    $ps.models | Select-Object name, context_length, expires_at | Format-Table -AutoSize
} else {
    Write-Host 'No model currently loaded.'
}

Section '7. Editor settings'
Write-Host 'Continue  ->  C:\Users\CVF\.continue\config.yaml   (already configured)'
Write-Host 'Cline     ->  Settings > API Configuration:'
Write-Host '                 API Provider   : Ollama'
Write-Host '                 Base URL       : http://localhost:11434'
Write-Host '                 Model ID       : qwen3:4b'
Write-Host '                 Context Window : 16384'