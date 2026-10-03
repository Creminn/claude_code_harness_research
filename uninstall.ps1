# Removes claude-harness on Windows: restores the settings it changed in every project,
# stops the knowledge graph and uninstalls the plugin.
#
#   irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/uninstall.ps1 | iex
#   & ([scriptblock]::Create((irm .../uninstall.ps1))) -Purge    # also delete the graph data
param([switch]$Purge)

function Uninstall-Harness {
    $harnessDir = if ($env:HARNESS_HOME) { $env:HARNESS_HOME } else { Join-Path $HOME '.claude-harness' }
    $shim = Join-Path $harnessDir 'bin\harness.mjs'
    if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $shim)) {
        $uninstallArgs = @('uninstall', '--yes')
        if ($Purge) { $uninstallArgs += '--purge' }
        & node $shim @uninstallArgs
        if ($LASTEXITCODE -eq 0) { return }
    }

    Write-Host 'The harness command was not available; removing the plugin only.'
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        & claude plugin uninstall harness@claude-harness --scope user
        & claude plugin marketplace remove claude-harness
    }
    if ($Purge) { Remove-Item -Recurse -Force $harnessDir -ErrorAction SilentlyContinue }
    Write-Host 'Done. If you had enabled the harness, check the model, effortLevel, autoCompactWindow and statusLine keys in your settings files.'
}

Uninstall-Harness
