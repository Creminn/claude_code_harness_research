# claude-harness installer for Windows (PowerShell 5.1 or 7+).
#
#   irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.ps1 | iex
#
# With options:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.ps1))) -Mode local
#
# It checks the prerequisites, installs the plugin into Claude Code and optionally sets up
# the knowledge graph. Your Claude Code settings are only changed when you say
# "enable harness architecture" inside Claude Code.
param(
    [ValidateSet('', 'anthropic', 'openai', 'local', 'off')]
    [string]$Mode = '',
    [string]$Ref = '',
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

$Repo = if ($env:HARNESS_REPO) { $env:HARNESS_REPO } else { 'Creminn/claude_code_harness_research' }
$Marketplace = 'claude-harness'
$Plugin = 'harness@claude-harness'
$MinNode = 20

function Have([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function CanPrompt { return (-not $Yes) -and [Environment]::UserInteractive }

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Setup-WithKey([string]$GraphMode, [string]$VarName, [string]$Harness) {
    $key = ''
    $fromEnv = [Environment]::GetEnvironmentVariable($VarName)
    if ($fromEnv) {
        if (-not (CanPrompt)) { $key = $fromEnv }
        else {
            $use = Read-Host "Use the $VarName from your environment? [Y/n]"
            if ($use -notmatch '^(n|no)$') { $key = $fromEnv }
        }
    }
    if (-not $key -and (CanPrompt)) { $key = Read-Secret "$VarName (input hidden)" }
    if (-not $key) {
        Write-Host "No $VarName given: skipping the knowledge graph. Set it up later with:"
        Write-Host '  node $HOME\.claude-harness\bin\harness.mjs graph setup'
        return
    }
    $key | & node $Harness graph setup --mode $GraphMode --key-stdin
}

# Everything runs inside a function so that a failure returns instead of closing the
# PowerShell window (this script is usually run with "irm | iex").
function Install-Harness {
    Write-Host 'claude-harness installer'
    Write-Host ''

    # 1. Prerequisites -----------------------------------------------------------
    if (-not (Have 'claude')) {
        Write-Host 'Claude Code is not installed. Install it first, then run this again:'
        Write-Host '  irm https://claude.ai/install.ps1 | iex'
        return
    }
    if (-not (Have 'node')) {
        Write-Host "Node.js $MinNode+ is required (the harness hooks and status line run on it)."
        Write-Host '  Install it with:  winget install OpenJS.NodeJS.LTS   (or from https://nodejs.org)'
        Write-Host '  Then open a new terminal and run this again.'
        return
    }
    $nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
    if ($nodeMajor -lt $MinNode) {
        Write-Host "Node.js $nodeMajor is too old: $MinNode or newer is required."
        Write-Host '  Update it with:  winget upgrade OpenJS.NodeJS.LTS'
        return
    }
    $docker = 'none'
    if (Have 'docker') {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) { $docker = 'running' } else { $docker = 'stopped' }
    }
    Write-Host ("  Claude Code: " + ((& claude --version) | Select-Object -First 1))
    Write-Host ("  Node.js:     " + (& node --version))
    switch ($docker) {
        'running' { Write-Host '  Docker:      running' }
        'stopped' { Write-Host '  Docker:      installed, not running (start Docker Desktop to use the knowledge graph)' }
        default   { Write-Host '  Docker:      not installed (optional: needed only for the knowledge graph)' }
    }
    Write-Host ''

    # 2. Plugin ------------------------------------------------------------------
    $source = $Repo
    if ($Ref) { $source = "$Repo#$Ref" }
    # HARNESS_SOURCE overrides the marketplace source (a local checkout or owner/repo#ref), for testing.
    if ($env:HARNESS_SOURCE) { $source = $env:HARNESS_SOURCE }
    Write-Host 'Installing the plugin ...'
    & claude plugin marketplace add $source | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not add the marketplace $source"; return }
    & claude plugin marketplace update $Marketplace *> $null
    & claude plugin install $Plugin --scope user | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not install $Plugin"; return }
    & claude plugin update $Plugin *> $null

    $installed = (& claude plugin list --json | Out-String | ConvertFrom-Json) | Where-Object { $_.id -eq $Plugin } | Select-Object -First 1
    if (-not $installed -or -not $installed.installPath) { Write-Host 'Could not find the installed plugin. Run: claude plugin list'; return }
    $harness = Join-Path $installed.installPath 'scripts\harness.mjs'
    & node $harness status *> $null
    Write-Host ("  Plugin installed: v" + $installed.version)
    Write-Host ''

    # 3. Knowledge graph ---------------------------------------------------------
    if (-not $Mode) {
        if (CanPrompt) {
            Write-Host 'Knowledge graph (optional). It remembers decisions across sessions; it needs Docker.'
            Write-Host '  1) anthropic  Claude Haiku extracts facts      (Anthropic API key, a few cents per session)'
            Write-Host '  2) openai     OpenAI extracts facts            (OpenAI API key)'
            Write-Host '  3) local      Ollama on this machine, no key   (experimental; ~5 GB download, 8 GB RAM)'
            Write-Host '  4) off        No knowledge graph (you can turn it on later)'
            $default = '4'
            if ($docker -ne 'none') { $default = '1' }
            $choice = Read-Host "Choose 1-4 [$default]"
            if (-not $choice) { $choice = $default }
            switch ($choice) {
                { $_ -in '1', 'anthropic' } { $Mode = 'anthropic' }
                { $_ -in '2', 'openai' } { $Mode = 'openai' }
                { $_ -in '3', 'local' } { $Mode = 'local' }
                default { $Mode = 'off' }
            }
        } else {
            $Mode = 'off'
        }
    }

    switch ($Mode) {
        'anthropic' { Setup-WithKey 'anthropic' 'ANTHROPIC_API_KEY' $harness }
        'openai' { Setup-WithKey 'openai' 'OPENAI_API_KEY' $harness }
        'local' { & node $harness graph setup --mode local }
        default { Write-Host 'Knowledge graph: off. Turn it on later with: node $HOME\.claude-harness\bin\harness.mjs graph setup' }
    }

    Write-Host ''
    Write-Host 'Done. Next:'
    Write-Host '  1. Open Claude Code in a project (restart it if it is already open).'
    Write-Host '  2. Say: enable harness architecture'
    Write-Host ''
    Write-Host 'Manage it from a terminal with: node $HOME\.claude-harness\bin\harness.mjs help'
}

Install-Harness
