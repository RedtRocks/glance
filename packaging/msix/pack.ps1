# Builds Glance's Microsoft Store package (see packaging/README.md).
#
#   pack.ps1 -Exe <glance.exe> -ContextMenu <glance_context_menu.dll> -Arch x64|arm64 -Out <Glance-x64.msix>
#   pack.ps1 -BundleFrom <folder of .msix files> -Out <Glance.msixbundle>
#
# The package identity comes from MSIX_IDENTITY_NAME, MSIX_PUBLISHER and
# MSIX_PUBLISHER_DISPLAY_NAME (scripts/packaging.ts). The Store signs what it
# publishes, so these packages are uploaded unsigned.
[CmdletBinding(DefaultParameterSetName = 'Pack')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Pack')][string]$Exe,
  # Windows 11's top-level right-click menu (src-tauri/context-menu), built for the same -Arch.
  [Parameter(Mandatory, ParameterSetName = 'Pack')][string]$ContextMenu,
  [Parameter(Mandatory, ParameterSetName = 'Pack')][ValidateSet('x64', 'arm64')][string]$Arch,
  [Parameter(Mandatory, ParameterSetName = 'Bundle')][string]$BundleFrom,
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."

# Newest Windows SDK that has the packaging tools.
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*" -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64' } |
  Where-Object { Test-Path (Join-Path $_ 'makeappx.exe') } |
  Select-Object -First 1
if (-not $sdk) { throw 'Windows SDK packaging tools (makeappx.exe) not found' }

function Run($tool, [string[]]$arguments) {
  & (Join-Path $sdk $tool) @arguments
  if ($LASTEXITCODE -ne 0) { throw "$tool failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null

if ($PSCmdlet.ParameterSetName -eq 'Bundle') {
  $version = (Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
  Run 'makeappx.exe' @('bundle', '/d', $BundleFrom, '/p', $Out, '/bv', "$version.0", '/o')
  return
}

$work = Join-Path ([IO.Path]::GetTempPath()) "glance-msix-$Arch"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
$layout = Join-Path $work 'layout'
New-Item -ItemType Directory -Force $layout | Out-Null
Copy-Item $Exe (Join-Path $layout 'Glance.exe')
Copy-Item $ContextMenu (Join-Path $layout 'glance_context_menu.dll')
# No glance-mcp.exe: its alias starts Glance.exe, which relays for AI apps (scripts/packaging.ts).
Copy-Item -Recurse (Join-Path $PSScriptRoot 'Assets') (Join-Path $layout 'Assets')

Push-Location $root
try {
  node scripts/packaging.ts msix $Arch (Join-Path $layout 'AppxManifest.xml')
  if ($LASTEXITCODE -ne 0) { throw 'generating AppxManifest.xml failed' }
} finally { Pop-Location }

# resources.pri lets Windows pick the unplated taskbar and Start icons (targetsize-*).
$priconfig = Join-Path $work 'priconfig.xml'
Run 'makepri.exe' @('createconfig', '/cf', $priconfig, '/dq', 'en-US', '/pv', '10.0.0', '/o')
Run 'makepri.exe' @('new', '/pr', $layout, '/cf', $priconfig, '/mn', (Join-Path $layout 'AppxManifest.xml'), '/of', (Join-Path $layout 'resources.pri'), '/o')
Run 'makeappx.exe' @('pack', '/d', $layout, '/p', $Out, '/o')
Write-Host "Packed $Out"
