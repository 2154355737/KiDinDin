[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(?!127\.)(?!169\.254\.)(?!198\.18\.)((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$')]
    [string]$ProxyHost,

    [string]$Serial = '127.0.0.1:7555',
    [int]$ProxyPort = 8080,
    [string]$DingTalkPackage = 'com.alibaba.android.rimet',
    [string]$MitmwebPath = 'C:\Program Files\mitmproxy\bin\mitmweb.exe'
)

$ErrorActionPreference = 'Stop'

function Invoke-Adb {
    param([string[]]$AdbArgs)

    $output = & $script:AdbPath @AdbArgs
    if ($LASTEXITCODE -ne 0) {
        throw "ADB command failed: adb $($AdbArgs -join ' ')`n$($output -join "`n")"
    }
    return $output
}

function Read-Asn1Tlv {
    param(
        [byte[]]$Bytes,
        [int]$Offset
    )

    $tag = $Bytes[$Offset]
    $cursor = $Offset + 1
    $firstLengthByte = $Bytes[$cursor]
    $cursor++
    if (($firstLengthByte -band 0x80) -eq 0) {
        $length = $firstLengthByte
    }
    else {
        $count = $firstLengthByte -band 0x7f
        $length = 0
        for ($index = 0; $index -lt $count; $index++) {
            $length = ($length -shl 8) -bor $Bytes[$cursor]
            $cursor++
        }
    }
    return [PSCustomObject]@{
        Tag = $tag
        Start = $Offset
        ContentStart = $cursor
        End = $cursor + $length
    }
}

function Get-AndroidSubjectHash {
    param([string]$CertificatePath)

    $raw = [System.IO.File]::ReadAllBytes($CertificatePath)
    $text = [System.Text.Encoding]::ASCII.GetString($raw)
    if ($text.Contains('-----BEGIN CERTIFICATE-----')) {
        $base64 = ($text -replace '-----BEGIN CERTIFICATE-----', '' -replace '-----END CERTIFICATE-----', '' -replace '\s', '')
        $bytes = [Convert]::FromBase64String($base64)
    }
    else {
        $bytes = $raw
    }

    $outer = Read-Asn1Tlv -Bytes $bytes -Offset 0
    $tbs = Read-Asn1Tlv -Bytes $bytes -Offset $outer.ContentStart
    $cursor = $tbs.ContentStart
    $field = Read-Asn1Tlv -Bytes $bytes -Offset $cursor
    if ($field.Tag -eq 0xa0) {
        $cursor = $field.End
    }

    # Skip serial, signature algorithm, issuer, and validity; the next field is subject.
    foreach ($unused in 1..4) {
        $field = Read-Asn1Tlv -Bytes $bytes -Offset $cursor
        $cursor = $field.End
    }
    $subject = Read-Asn1Tlv -Bytes $bytes -Offset $cursor
    $subjectDer = New-Object byte[] ($subject.End - $subject.Start)
    [Array]::Copy($bytes, $subject.Start, $subjectDer, 0, $subjectDer.Length)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $digest = $md5.ComputeHash($subjectDer)
    }
    finally {
        $md5.Dispose()
    }
    return ('{0:x2}{1:x2}{2:x2}{3:x2}.0' -f $digest[3], $digest[2], $digest[1], $digest[0])
}

$adb = Get-Command adb -ErrorAction Stop
$script:AdbPath = $adb.Source
$certificatePath = Join-Path $env:USERPROFILE '.mitmproxy\mitmproxy-ca-cert.cer'
if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw "mitmproxy CA is missing: $certificatePath. Start mitmweb once to generate it."
}

if (-not (Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath $MitmwebPath)) {
        throw "mitmweb is not listening and was not found: $MitmwebPath"
    }
    Start-Process -FilePath $MitmwebPath -ArgumentList '--listen-host', '0.0.0.0', '--listen-port', $ProxyPort -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 500
    } until ((Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue) -or (Get-Date) -gt $deadline)
    if (-not (Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue)) {
        throw "mitmweb did not start listening on port $ProxyPort."
    }
}

Invoke-Adb @('connect', $Serial) | Out-Null
Invoke-Adb @('-s', $Serial, 'wait-for-device') | Out-Null
if ((Invoke-Adb @('-s', $Serial, 'shell', 'getprop sys.boot_completed')).Trim() -ne '1') {
    throw 'MuMu has not completed booting.'
}
Invoke-Adb @('-s', $Serial, 'root') | Out-Null
if (-not ((Invoke-Adb @('-s', $Serial, 'shell', 'id')) -match 'uid=0\(root\)')) {
    throw 'ADB root is required for temporary CA mounts.'
}

$caHashFile = Get-AndroidSubjectHash -CertificatePath $certificatePath
$remoteCertificate = "/data/local/tmp/$caHashFile"
$remoteCaDirectory = '/data/local/tmp/cacerts-mitm'

Invoke-Adb @('-s', $Serial, 'push', $certificatePath, $remoteCertificate) | Out-Null

# Remove prior bind mounts before copying from the immutable versioned APEX source.
$unmountSystem = 'nsenter -t 1 -m -- umount /system/etc/security/cacerts 2>/dev/null || true; nsenter -t 1 -m -- umount /apex/com.android.conscrypt/cacerts 2>/dev/null || true; for p in /apex/com.android.conscrypt@*/cacerts; do nsenter -t 1 -m -- umount "$p" 2>/dev/null || true; done'
Invoke-Adb @('-s', $Serial, 'shell', $unmountSystem) | Out-Null

$sourceCaDirectory = (Invoke-Adb @('-s', $Serial, 'shell', 'find /apex -type d -path "/apex/com.android.conscrypt@*/cacerts" 2>/dev/null | head -n 1') | Where-Object { $_ -match '^/apex/' } | Select-Object -First 1).Trim()
if (-not $sourceCaDirectory) {
    throw 'Could not locate the versioned Conscrypt CA directory in MuMu.'
}

$buildCaDirectory = "rm -rf $remoteCaDirectory && mkdir -p $remoteCaDirectory && cp $sourceCaDirectory/* $remoteCaDirectory/ && cp $remoteCertificate $remoteCaDirectory/$caHashFile && chmod 644 $remoteCaDirectory/* && chown root:root $remoteCaDirectory/* && chcon -R u:object_r:system_security_cacerts_file:s0 $remoteCaDirectory"
Invoke-Adb @('-s', $Serial, 'shell', $buildCaDirectory) | Out-Null

$systemMounts = "nsenter -t 1 -m -- mount -o bind $remoteCaDirectory /apex/com.android.conscrypt/cacerts && nsenter -t 1 -m -- mount -o bind $remoteCaDirectory $sourceCaDirectory && nsenter -t 1 -m -- mount -o bind $remoteCaDirectory /system/etc/security/cacerts"
Invoke-Adb @('-s', $Serial, 'shell', $systemMounts) | Out-Null

Invoke-Adb @('-s', $Serial, 'shell', "settings put global http_proxy $ProxyHost`:$ProxyPort") | Out-Null
Invoke-Adb @('-s', $Serial, 'shell', "am force-stop $DingTalkPackage") | Out-Null
Invoke-Adb @('-s', $Serial, 'shell', "monkey -p $DingTalkPackage -c android.intent.category.LAUNCHER 1") | Out-Null
Start-Sleep -Seconds 6

$processIds = Invoke-Adb @('-s', $Serial, 'shell', "ps -A | grep $DingTalkPackage") |
    ForEach-Object {
        $columns = $_.ToString().Trim() -split '\s+'
        if ($columns.Length -ge 2) { $columns[1] }
    } |
    Where-Object { $_ -match '^\d+$' } |
    Select-Object -Unique
if (-not $processIds) {
    throw "No $DingTalkPackage processes appeared after restart."
}

$verifiedPids = @()
foreach ($processId in $processIds) {
    $mountForProcess = "nsenter -t $processId -m -- umount /system/etc/security/cacerts 2>/dev/null || true; nsenter -t $processId -m -- umount /apex/com.android.conscrypt/cacerts 2>/dev/null || true; nsenter -t $processId -m -- umount $sourceCaDirectory 2>/dev/null || true; nsenter -t $processId -m -- mount -o bind $remoteCaDirectory /apex/com.android.conscrypt/cacerts && nsenter -t $processId -m -- mount -o bind $remoteCaDirectory $sourceCaDirectory && nsenter -t $processId -m -- mount -o bind $remoteCaDirectory /system/etc/security/cacerts"
    Invoke-Adb @('-s', $Serial, 'shell', $mountForProcess) | Out-Null
    $verify = Invoke-Adb @('-s', $Serial, 'shell', "nsenter -t $processId -m -- sh -c 'test -f /apex/com.android.conscrypt/cacerts/$caHashFile && test -f $sourceCaDirectory/$caHashFile && test -f /system/etc/security/cacerts/$caHashFile && echo ready'")
    if (($verify -join "`n") -match 'ready') {
        $verifiedPids += $processId
    }
}

if ($verifiedPids.Count -ne $processIds.Count) {
    throw "CA verification failed for one or more DingTalk PIDs. Verified: $($verifiedPids -join ', ')"
}

[PSCustomObject]@{
    Serial = $Serial
    Proxy = "$ProxyHost`:$ProxyPort"
    CaHashFile = $caHashFile
    DingTalkPids = $processIds -join ','
    Status = 'ready'
}
