---
name: mumu-mitm-capture
description: Restore authorized HTTPS capture for a DingTalk mini program in MuMu on Windows using mitmweb, ADB root, and temporary system CA bind mounts. Use when MuMu or DingTalk was restarted, mitmproxy traffic shows only CONNECT, or Java reports a missing trust anchor.
---

# MuMu DingTalk HTTPS capture

Run only in an authorized test environment. Never save or paste access tokens, refresh tokens, cookies, request signatures, or unredacted business payloads.

## Restore

1. Start MuMu and wait for the Android desktop.
2. Obtain the computer IPv4 address reachable from MuMu. Do not use loopback, APIPA, or Clash addresses such as `198.18.*`.
3. Run the bundled script from this skill directory. Pass the verified IPv4 explicitly:

```powershell
.\scripts\Restore-MuMuMitmCapture.ps1 -ProxyHost "192.168.x.x"
```

The script connects to `127.0.0.1:7555`, starts mitmweb only if port `8080` is not already listening, calculates the current mitmproxy CA's Android subject hash, installs it in a temporary CA directory, sets the emulator HTTP proxy, restarts DingTalk, and verifies the CA in every DingTalk process.

## Verify and capture

Use mitmweb with `~d cis.whng.com.cn` to isolate the business traffic. First open the target mini program and confirm a decrypted HTTPS request appears. Treat analytics domains such as `px.effirst.com` only as proof that interception works, not as CIS business API evidence.

For endpoint discovery, perform one reversible action at a time and record only redacted method, URL, non-sensitive headers, request structure, HTTP status, and response structure. Do not submit a real work order just to capture a request.

## Diagnose trust failures

For `java.security.cert.CertPathValidatorException: Trust anchor for certification path not found`, rerun the script. Android 15 images may expose both a versioned and an unversioned Conscrypt CA directory; the script mounts the CA into all of these locations for each current DingTalk PID:

- `/apex/com.android.conscrypt/cacerts`
- `/apex/com.android.conscrypt@<version>/cacerts`
- `/system/etc/security/cacerts`

If DingTalk crashes, updates, or is force-stopped after the script runs, rerun it because its PIDs and mount namespaces change. If the mitmproxy CA was regenerated, rerun it as well; the script derives the new hash filename instead of reusing an old one.

## Stop capture

Clear the emulator proxy when finished:

```powershell
adb -s 127.0.0.1:7555 shell settings put global http_proxy :0
adb -s 127.0.0.1:7555 shell settings delete global http_proxy
```
