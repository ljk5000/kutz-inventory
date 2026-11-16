param([switch]$Watch)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Path (Join-Path $PSScriptRoot 'CredentialStore.cs')
$dataDirectory = Join-Path $env:LOCALAPPDATA 'KutzUI\Companion'
[IO.Directory]::CreateDirectory($dataDirectory) | Out-Null
$configFile = Join-Path $dataDirectory 'settings.json'
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'KutzUI Companion.lnk'
# One settings window per Windows user; the worker separately locks its output.
$mutex = New-Object Threading.Mutex($false, 'Local\KutzUICompanion')
if (-not $mutex.WaitOne(0)) {
    [Windows.Forms.MessageBox]::Show('KutzUI Companion is already open. Check the taskbar.') | Out-Null
    exit
}
$script:worker = $null
$script:readTask = $null
$script:pendingKey = ''
$script:pendingBase = ''
$script:sessionKey = ''
$script:sessionBase = ''
$script:busy = $false
$script:running = $false
function Credential-Target([string]$base) { return 'KutzUI.Companion/' + $base.TrimEnd('/').ToLowerInvariant() }
# WoW moved from cr0m.com to its own site. A saved https://cr0m.com follows it; a self-hosted origin is left alone.
function Move-SiteOrigin([string]$origin) { if ($origin -match '^\s*https://cr0m\.com/*\s*$') { return 'https://wow.cr0m.com' }; return $origin }
function Show-Error([string]$message) { $status.Text = $message }
function Save-Settings {
    @{ version=1; game=$game.Text; base=$base.Text; remember=$remember.Checked } |
        ConvertTo-Json | Set-Content -Encoding UTF8 ($configFile + '.tmp')
    Move-Item -Force ($configFile + '.tmp') $configFile
}
function Set-Startup {
    if ($startup.Checked) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupLink)
        $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
        $shortcut.Arguments = '-NoProfile -STA -File "' + (Join-Path $PSScriptRoot 'Companion.ps1') + '" -Watch'
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Save()
    } elseif (Test-Path $startupLink) { Remove-Item $startupLink }
}
function Ensure-Worker {
    if ($script:worker -and -not $script:worker.HasExited) { return }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Install Node.js 22 LTS or newer, then reopen Companion.' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node.Source
    $info.Arguments = '"' + (Join-Path $PSScriptRoot 'worker.js') + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    # No stderr containing private inventory paths is shown in the settings window.
    $info.RedirectStandardError = $true
    $script:worker = New-Object Diagnostics.Process
    $script:worker.StartInfo = $info
    $script:worker.Start() | Out-Null
    $script:errorDrain = $script:worker.StandardError.ReadToEndAsync()
    $script:readTask = $script:worker.StandardOutput.ReadLineAsync()
}
function Send-Command([string]$action) {
    Ensure-Worker
    if ($action -eq 'pause') {
        $script:worker.StandardInput.WriteLine('{"action":"pause"}')
        return
    }
    $origin = [Uri]$base.Text
    if (-not $origin.IsAbsoluteUri -or $origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or $origin.AbsolutePath -ne '/') {
        throw 'Enter an HTTPS site origin, for example https://wow.cr0m.com.'
    }
    $base.Text = $origin.GetLeftPart([UriPartial]::Authority)
    $secret = $key.Text
    if (-not $secret -and $script:sessionBase -eq $base.Text) { $secret = $script:sessionKey }
    if (-not $secret) { $secret = [KutzCredentialStore]::Get((Credential-Target $base.Text)) }
    if (-not $secret) { throw 'Paste your cr0m upload key. Create one with Get key.' }
    $script:pendingKey = $secret
    $script:pendingBase = $base.Text
    $script:busy = $true
    $connect.Enabled = $false; $start.Enabled = $false; $browse.Enabled = $false
    $game.Enabled = $false; $base.Enabled = $false; $key.Enabled = $false
    $script:worker.StandardInput.WriteLine((@{
        action=$action; game=$game.Text; base=$base.Text; key=$secret; dataDirectory=$dataDirectory
    } | ConvertTo-Json -Compress))
    $secret = $null
}
function Unlock-Settings {
    $script:busy = $false
    $connect.Enabled = -not $script:running; $start.Enabled = -not $script:running
    $browse.Enabled = -not $script:running; $game.Enabled = -not $script:running
    $base.Enabled = -not $script:running; $key.Enabled = -not $script:running
}
$form = New-Object Windows.Forms.Form
$form.Text = 'KutzUI Companion'; $form.ClientSize = New-Object Drawing.Size(570, 460)
$form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
function Label([string]$text, [int]$x, [int]$y, [int]$w=530, [int]$h=22) {
    $control = New-Object Windows.Forms.Label
    $control.Text=$text; $control.SetBounds($x,$y,$w,$h); $form.Controls.Add($control); return $control
}
function TextBox([int]$x,[int]$y,[int]$w) {
    $control=New-Object Windows.Forms.TextBox
    $control.SetBounds($x,$y,$w,24); $form.Controls.Add($control); return $control
}
function Button([string]$text,[int]$x,[int]$y,[int]$w=105) {
    $control=New-Object Windows.Forms.Button
    $control.Text=$text; $control.SetBounds($x,$y,$w,28); $form.Controls.Add($control); return $control
}
Label 'Inventory sync for cr0m' 20 15 | Out-Null
Label 'Game client folder (contains WTF and Interface)' 20 46 | Out-Null
$game=TextBox 20 70 410; $browse=Button 'Browse...' 440 68
$game.Text=Join-Path ${env:ProgramFiles(x86)} 'World of Warcraft\_forever_'
Label 'cr0m site' 20 108 | Out-Null
$base=TextBox 20 132 410; $base.Text='https://wow.cr0m.com'
$getKey=Button 'Get key' 440 130
Label 'API key (leave empty to use the key saved for this site)' 20 170 | Out-Null
$key=TextBox 20 194 525; $key.UseSystemPasswordChar=$true
$remember=New-Object Windows.Forms.CheckBox
$remember.Text='Remember securely in Windows Credential Manager'
$remember.SetBounds(20,228,525,24); $remember.Checked=$true; $form.Controls.Add($remember)
$startup=New-Object Windows.Forms.CheckBox
$startup.Text='Start uploading when I sign in to Windows (requires a saved key)'
$startup.SetBounds(20,256,530,24); $startup.Checked=Test-Path $startupLink; $form.Controls.Add($startup)
$connect=Button 'Connect / save' 20 294 125
$start=Button 'Start' 155 294
$pause=Button 'Pause' 270 294
$forget=Button 'Forget key' 385 294 160
$account=Label 'Account: not connected' 20 338
$status=Label 'Paused. Game saves on /reload or logout; closing this window stops uploads.' 20 366 530 48
Label 'Private exports stay in LocalAppData\KutzUI\Companion.' 20 425 | Out-Null
if (Test-Path $configFile) {
    try {
        $settings=Get-Content -Raw $configFile | ConvertFrom-Json
        $savedBase=[string]$settings.base
        $game.Text=$settings.game; $base.Text=Move-SiteOrigin $savedBase; $remember.Checked=[bool]$settings.remember
        if ($base.Text -cne $savedBase) {
            # Keys belong to an account on the new site, so the one saved for cr0m.com is not reused.
            $status.Text='Uploads moved to wow.cr0m.com. Click Get key to make a key there, then Connect / save.'
            try { Save-Settings } catch {} # not saved: moved again on the next start
        }
    } catch { Show-Error 'Settings could not be read. Select your folder and reconnect.' }
}
$browse.Add_Click({
    $dialog=New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description='Select the WoW client folder containing WTF and Interface'
    if ($dialog.ShowDialog() -eq 'OK') { $game.Text=$dialog.SelectedPath }
    $dialog.Dispose()
})
$getKey.Add_Click({
    try {
        $origin=[Uri]$base.Text
        if ($origin.Scheme -ne 'https' -or $origin.UserInfo) { throw 'Enter an HTTPS cr0m site.' }
        Start-Process ($origin.GetLeftPart([UriPartial]::Authority) + '/private/settings#wow-upload-key')
    } catch { Show-Error $_.Exception.Message }
})
$connect.Add_Click({ try { Send-Command 'connect' } catch { Unlock-Settings; Show-Error $_.Exception.Message } })
$start.Add_Click({ try { Send-Command 'start' } catch { Unlock-Settings; Show-Error $_.Exception.Message } })
$pause.Add_Click({
    try { $startup.Checked=$false; Set-Startup; Send-Command 'pause' }
    catch { Show-Error $_.Exception.Message }
})
$forget.Add_Click({
    try {
        $startup.Checked=$false; Set-Startup; Send-Command 'pause'
        [KutzCredentialStore]::Remove((Credential-Target $base.Text))
        $key.Clear(); $script:pendingKey=''; $script:sessionKey=''; $script:sessionBase=''; $account.Text='Account: not connected'
        Show-Error 'Key removed from this PC. Revoke it on cr0m to invalidate other copies.'
    } catch { Show-Error $_.Exception.Message }
})
$timer=New-Object Windows.Forms.Timer
$timer.Interval=150
$timer.Add_Tick({
    try {
        if ($script:readTask -and $script:readTask.IsCompleted) {
            $line=$script:readTask.GetAwaiter().GetResult()
            $script:readTask=$null
            if ($null -ne $line) {
                $event=$line | ConvertFrom-Json
                switch ($event.state) {
                    'connected' {
                        $script:running=[bool]$event.starting
                        $account.Text='Account: ' + $event.username
                        if ($event.legacy) { $account.Text += ' (legacy shared token)' }
                        if ($remember.Checked) { [KutzCredentialStore]::Set((Credential-Target $script:pendingBase), $event.username, $script:pendingKey) }
                        else { [KutzCredentialStore]::Remove((Credential-Target $script:pendingBase)) }
                        $script:sessionKey=$script:pendingKey; $script:sessionBase=$script:pendingBase
                        $key.Clear(); $script:pendingKey=''
                        Save-Settings
                        if ($startup.Checked -and -not $remember.Checked) { $startup.Checked=$false }
                        Set-Startup; Unlock-Settings
                    }
                    'watching' { $script:running=$true; Unlock-Settings }
                    'paused' { $script:running=$false; Unlock-Settings }
                    'attention' { if ($null -ne $event.running) { $script:running=[bool]$event.running }; $script:pendingKey=''; Unlock-Settings }
                }
                $status.Text=$event.state
                if ($event.message) { $status.Text += ': ' + $event.message }
                if ($event.acknowledgedAt) { $status.Text='Uploaded successfully at ' + ([DateTimeOffset]::Parse($event.acknowledgedAt)).ToLocalTime().ToString('g') }
                $script:readTask=$script:worker.StandardOutput.ReadLineAsync()
            } else {
                $script:running=$false; Unlock-Settings
                Show-Error 'Companion stopped. Check Node.js 22 or newer is installed, then reconnect.'
            }
        }
    } catch {
        $script:pendingKey=''
        if ($script:worker -and -not $script:worker.HasExited) { $script:worker.StandardInput.WriteLine('{"action":"pause"}') }
        $script:running=$false; Unlock-Settings
        Show-Error ('Could not save or read companion settings: ' + $_.Exception.Message)
    }
})
$form.Add_Shown({ if ($Watch) { try { Send-Command 'start' } catch { Unlock-Settings; Show-Error $_.Exception.Message } } })
$form.Add_FormClosing({
    $timer.Stop()
    if ($script:worker -and -not $script:worker.HasExited) {
        $script:worker.StandardInput.Close()
        if (-not $script:worker.WaitForExit(3000)) { $script:worker.Kill() }
    }
})
try { $timer.Start(); [Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $form.Dispose(); $mutex.ReleaseMutex(); $mutex.Dispose() }
