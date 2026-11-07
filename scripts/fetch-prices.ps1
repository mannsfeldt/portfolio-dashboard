# Downloads price history for every symbol in symbols.txt from Yahoo Finance and writes data/prices.json.
# Works in Windows PowerShell 5.1 and PowerShell 7+ (GitHub's Ubuntu runners have pwsh).
# Run locally:  powershell -ExecutionPolicy Bypass -File scripts/fetch-prices.ps1
param(
  [string]$SymbolsFile = (Join-Path $PSScriptRoot '..\symbols.txt'),
  [string]$Out = (Join-Path $PSScriptRoot '..\data\prices.json')
)
$ErrorActionPreference = 'Stop'
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }

function Get-Chart([string]$Symbol, [string]$Range, [string]$Interval) {
  $enc = [uri]::EscapeDataString($Symbol)
  foreach ($h in 'query1', 'query2') {
    for ($try = 1; $try -le 3; $try++) {
      try {
        $url = "https://$h.finance.yahoo.com/v8/finance/chart/${enc}?range=$Range&interval=$Interval&includePrePost=false"
        $r = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 30
        if ($r.chart.result) { return $r.chart.result[0] }
      } catch { Start-Sleep -Seconds (2 * $try) }
    }
  }
  throw "Could not download $Symbol ($Range/$Interval) from Yahoo Finance"
}

function Get-LocalDate([long]$Ts, [int]$Off) {
  return [DateTimeOffset]::FromUnixTimeSeconds($Ts + $Off).UtcDateTime.ToString('yyyy-MM-dd')
}

$symbols = Get-Content $SymbolsFile | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ } | Select-Object -Unique
if (-not $symbols) { throw "No symbols found in $SymbolsFile" }

$result = [ordered]@{}
$marketDates = @()
foreach ($sym in $symbols) {
  Write-Host "Fetching $sym ..."
  $chart = Get-Chart $sym '5y' '1d'
  $meta = $chart.meta
  $off = [int]$meta.gmtoffset
  $mdate = Get-LocalDate ([long]$meta.regularMarketTime) $off
  $closes = $chart.indicators.quote[0].close
  $d = New-Object System.Collections.Generic.List[string]
  $c = New-Object System.Collections.Generic.List[double]
  for ($i = 0; $i -lt $chart.timestamp.Count; $i++) {
    if ($null -eq $closes[$i]) { continue }
    $ld = Get-LocalDate ([long]$chart.timestamp[$i]) $off
    if ([string]::CompareOrdinal($ld, $mdate) -lt 0) { $d.Add($ld); $c.Add([math]::Round([double]$closes[$i], 4)) }   # completed days only
  }
  $it = New-Object System.Collections.Generic.List[long]
  $ic = New-Object System.Collections.Generic.List[double]
  try {
    $intra = Get-Chart $sym '5d' '15m'
    $q = $intra.indicators.quote[0].close
    for ($i = 0; $i -lt $intra.timestamp.Count; $i++) {
      if ($null -ne $q[$i]) { $it.Add([long]$intra.timestamp[$i]); $ic.Add([math]::Round([double]$q[$i], 4)) }
    }
  } catch { Write-Warning "No intraday data for ${sym}: $($_.Exception.Message)" }

  $result[$sym] = [ordered]@{
    name = $meta.longName; currency = $meta.currency; off = $off
    price = [math]::Round([double]$meta.regularMarketPrice, 4); time = [long]$meta.regularMarketTime; marketDate = $mdate
    d = $d.ToArray(); c = $c.ToArray(); it = $it.ToArray(); ic = $ic.ToArray()
  }
  if ($sym -notmatch '=X$') { $marketDates += $mdate }
  Start-Sleep -Milliseconds 300
}

$refDate = if ($marketDates) { ($marketDates | Sort-Object | Select-Object -Last 1) } else { (Get-Date).ToString('yyyy-MM-dd') }
$doc = [ordered]@{ generated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); marketDate = $refDate; symbols = $result }
$json = $doc | ConvertTo-Json -Depth 6 -Compress
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
[IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote {0} ({1:N0} KB, {2} symbols, market date {3})" -f $Out, ((Get-Item $Out).Length / 1KB), $symbols.Count, $refDate)
