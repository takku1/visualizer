# Streams the Windows media session (what the volume flyout shows: Spotify,
# browsers, most players) as one JSON line per change, plus a heartbeat.
# Started once by electron/main.cjs; runs until stdin closes or it is killed.
# Local only: reads the OS media session, no network.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/media-session.ps1 [-Once]
param([switch]$Once)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

# WinRT IAsyncOperation -> .NET Task, the standard PowerShell 5 bridge.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$last = ''
$beat = [DateTime]::UtcNow
while ($true) {
  $out = @{ ok = $false }
  try {
    $s = $manager.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $out = @{
        ok = $true
        app = $s.SourceAppUserModelId
        title = $p.Title
        artist = $p.Artist
        album = $p.AlbumTitle
        playing = ($pb.PlaybackStatus -eq 'Playing')
        # Position as of lastUpdated; the reader extrapolates while playing.
        position = $tl.Position.TotalSeconds
        duration = ($tl.EndTime - $tl.StartTime).TotalSeconds
        lastUpdated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
    }
  } catch {
    $out = @{ ok = $false; error = $_.Exception.Message }
  }
  $json = $out | ConvertTo-Json -Compress
  $now = [DateTime]::UtcNow
  if ($json -ne $last -or ($now - $beat).TotalSeconds -ge 5) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
    $beat = $now
  }
  if ($Once) { break }
  Start-Sleep -Milliseconds 500
}
