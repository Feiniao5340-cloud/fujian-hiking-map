# Single offline entry: one explicitly selected private source manifest.
# Without -WriteFiles: validate only. With -WriteFiles: refuse existing outputs.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [switch]$WriteFiles
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRaw = (Resolve-Path -LiteralPath (Join-Path $taskRoot 'data/raw/gpx')).Path
$taskManifestPath = if ([System.IO.Path]::IsPathRooted($Manifest)) { $Manifest } else { Join-Path $taskRoot $Manifest }
$taskManifestPath = (Resolve-Path -LiteralPath $taskManifestPath).Path
if ((Split-Path -Parent $taskManifestPath) -ne $taskRaw -or -not $taskManifestPath.EndsWith('.source.json')) {
    throw 'Select one source manifest directly in data/raw/gpx'
}
$taskSource = Get-Content -LiteralPath $taskManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([System.IO.Path]::GetFileName($taskSource.archivedFileName) -ne $taskSource.archivedFileName) { throw 'Invalid archive basename' }
$taskGpx = Join-Path $taskRaw $taskSource.archivedFileName
if ((Get-FileHash -LiteralPath $taskGpx -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskSource.sha256) { throw 'Original hash mismatch' }
$taskCfg = [System.Xml.XmlReaderSettings]::new()
$taskCfg.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$taskCfg.XmlResolver = $null
$taskCfg.MaxCharactersInDocument = 8388608
$taskDoc = [System.Xml.XmlDocument]::new()
$taskDoc.XmlResolver = $null
$taskReader = $null
try {
    $taskReader = [System.Xml.XmlReader]::Create($taskGpx, $taskCfg)
    $taskDoc.Load($taskReader)
} catch {
    throw 'Safe GPX parsing failed; source untouched; XML details suppressed'
} finally {
    if ($null -ne $taskReader) { $taskReader.Dispose() }
}
if ($taskDoc.DocumentElement.LocalName -ne 'gpx' -or $taskDoc.DocumentElement.GetAttribute('version') -ne '1.1' -or $taskDoc.DocumentElement.NamespaceURI -ne 'http://www.topografix.com/GPX/1/1') { throw 'GPX 1.1 required' }
$taskNs = [System.Xml.XmlNamespaceManager]::new($taskDoc.NameTable)
$taskNs.AddNamespace('g', 'http://www.topografix.com/GPX/1/1')
$taskTracks = @($taskDoc.SelectNodes('/g:gpx/g:trk', $taskNs))
$taskSegments = @($taskDoc.SelectNodes('/g:gpx/g:trk/g:trkseg', $taskNs))
$taskRoutes = @($taskDoc.SelectNodes('/g:gpx/g:rte', $taskNs))
if ($taskTracks.Count -eq 1 -and $taskSegments.Count -eq 1 -and $taskRoutes.Count -eq 0) {
    $taskKind = 'trkpt'
    $taskNodes = @($taskDoc.SelectNodes('/g:gpx/g:trk/g:trkseg/g:trkpt', $taskNs))
} elseif ($taskTracks.Count -eq 0 -and $taskRoutes.Count -eq 1) {
    $taskKind = 'rtept'
    $taskNodes = @($taskDoc.SelectNodes('/g:gpx/g:rte/g:rtept', $taskNs))
} else { throw 'Expected one unambiguous track segment or one route; no concatenation' }
$taskPoints = @($taskNodes | ForEach-Object { [ordered]@{latitude = $_.GetAttribute('lat'); longitude = $_.GetAttribute('lon')} })
$taskArgs = @($taskManifestPath)
if ($WriteFiles) { $taskArgs += '--write' }
$taskPreviousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [ordered]@{pointType = $taskKind; points = $taskPoints} | ConvertTo-Json -Depth 4 -Compress | & node (Join-Path $PSScriptRoot 'prepare-gpx-route.cjs') @taskArgs
    if ($LASTEXITCODE -ne 0) { throw 'Route preparation rejected; no cloud operation performed' }
} finally { $OutputEncoding = $taskPreviousEncoding }
