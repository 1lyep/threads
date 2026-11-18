$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$arch = $env:PROCESSOR_ARCHITEW6432
if (!$arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
switch ($arch) {
    'ARM64' { $target = 'arm64' }
    'AMD64' { $target = 'x64' }
    default { throw "Unsupported Windows architecture: $arch" }
}
$version = 'v24.22.3'
$name = "node-$version-win-$target"
$file = "$name.zip"
$entry = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-shasums.txt') |
    Where-Object { ($_ -split '\s+')[1] -eq $file }
if (!$entry) { throw "Missing pinned checksum for $file" }
$expected = ($entry -split '\s+')[0]
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = Join-Path $tmp $file
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$file" -OutFile $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js checksum mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($part in 'LICENSE','node.exe') {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry("$name/$part"), (Join-Path $tmp $part))
        }
    } finally { $archive.Dispose() }
    $runtime = Join-Path $root 'runtime'
    [IO.Directory]::CreateDirectory($runtime) | Out-Null
    foreach ($part in 'LICENSE','node.exe') {
        Move-Item -LiteralPath (Join-Path $tmp $part) -Destination (Join-Path $runtime $part) -Force
    }
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
