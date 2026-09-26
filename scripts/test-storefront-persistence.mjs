import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

// Uses a dedicated browser profile and synthetic images, never the user's App data.
const profile = await mkdtemp(join(tmpdir(), "kidindin-photo-test-"));
const vite = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executable = process.env.EDGE_TEST_EXECUTABLE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let page;
let browserConnection;
let browserLog = "";

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = (event) => reject(new Error(`CDP connect ${url}: ${event.message ?? event.error?.message ?? "WebSocket failed"}`));
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      clearTimeout(callback.timer);
      message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
    }
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for CDP ${method}`));
        }, 60_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

async function launch() {
  browserLog = "";
  browser = spawn(executable, ["--headless=new", "--disable-gpu", "--in-process-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--remote-allow-origins=*", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let spawnError;
  browser.on("error", (error) => { spawnError = error; });
  let endpoint;
  browser.stderr.on("data", (data) => {
    browserLog += data.toString();
    const match = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) endpoint = match[1];
  });
  for (let attempt = 0; !endpoint && attempt < 200; attempt++) {
    if (spawnError) throw spawnError;
    await delay(100);
  }
  assert.ok(endpoint, "Edge debugging endpoint must start");
  const versionResponse = await fetch(`http://${new URL(endpoint).host}/json/version`);
  assert.equal(versionResponse.status, 200, "local Edge debugger must respond");
  browserConnection = await connect(endpoint);
  const { targetId } = await browserConnection.send("Target.createTarget", { url: origin });
  const debugOrigin = `http://${new URL(endpoint).host}`;
  const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
  page = await connect(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await page.send("Runtime.evaluate", { expression: "location.origin" });
    if (value.result.value === origin) return;
    await delay(50);
  }
  throw new Error("Test page did not navigate");
}

async function evaluate(fn) {
  const result = await page.send("Runtime.evaluate", {
    expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function closeBrowser() {
  page?.close();
  if (browserConnection) {
    await browserConnection.send("Browser.close").catch(() => undefined);
    browserConnection.close();
    browserConnection = null;
  }
  else if (browser && browser.exitCode === null) browser.kill();
  await delay(500);
}

try {
  await launch();
  console.log(await evaluate(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const dbName = "kidindin-unreachable-prefills";
    const canvas = document.createElement("canvas");
    canvas.width = 2400; canvas.height = 1800;
    const context = canvas.getContext("2d");
    context.fillStyle = "#caf"; context.fillRect(0, 0, 2400, 1800);
    context.fillStyle = "#111"; context.font = "90px sans-serif"; context.fillText("TEST 123 门牌", 80, 200);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    const image = new File([png], "capture.png", { type: "image/png" });
    const order = (id) => ({ woHeaderId: id, woNumber: id, resident: "test", unit: "test" });
    // Seed the exact legacy schema before importing the current store.
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("storefrontPhotos", { keyPath: "key" })
        .createIndex("accountKey", "accountKey");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = legacy.transaction("storefrontPhotos", "readwrite");
      transaction.objectStore("storefrontPhotos").put({ accountKey: "a", woHeaderId: "legacy", woNumber: "legacy",
        resident: "test", unit: "test", key: JSON.stringify(["a", "legacy"]), blob: jpeg, size: jpeg.size,
        fileName: "legacy.jpg", mimeType: "image/jpeg", savedAt: new Date().toISOString() });
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    legacy.close();
    const store = await import("/src/services/storefrontPrefillStore.ts");
    check((await store.getStorefrontPhotoPrefill("a", "legacy")).fileName === "legacy.jpg", "legacy migration lost photo");
    const saved = await store.saveStorefrontPhotoPrefill("a", order("saved"), image);
    check(saved.size <= 500 * 1024 && saved.mimeType === "image/jpeg", "wrong compressed output");
    check(await store.getStorefrontPhotoDraft("a", "saved") === null, "draft not cleared after verification");
    const restoredBitmap = await createImageBitmap(saved.blob);
    check(restoredBitmap.width === 2400 && restoredBitmap.height === 1800, "saved image dimensions changed");
    restoredBitmap.close();
    check(await store.getStorefrontPhotoPrefill("b", "saved") === null, "account isolation failed");
    const bad = new File(["broken image"], "bad.png", { type: "image/png" });
    let failed = false;
    try { await store.saveStorefrontPhotoPrefill("a", order("saved"), bad); } catch { failed = true; }
    check(failed, "corrupt input incorrectly succeeded");
    check((await store.getSavedStorefrontPhotoPrefill("a", "saved")).fileName === saved.fileName, "failed replacement destroyed old photo");
    check((await store.getStorefrontPhotoDraft("a", "saved")).size === bad.size, "failure lost recovery draft");
    await store.saveStorefrontPhotoPrefill("a", order("saved"), image);
    // Quota error before staging must not overwrite the saved photo or claim success.
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "storefrontPhotoDrafts") throw new DOMException("test quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    };
    failed = false;
    try { await store.saveStorefrontPhotoPrefill("a", order("saved"), image); } catch { failed = true; }
    IDBObjectStore.prototype.put = originalPut;
    check(failed && await store.getSavedStorefrontPhotoPrefill("a", "saved"), "quota failure damaged saved photo");
    // Abort the final transaction: retain the original draft and previous final record.
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      if (this.name === "storefrontPhotos") this.transaction.abort();
      return request;
    };
    failed = false;
    try { await store.saveStorefrontPhotoPrefill("a", order("saved"), image); } catch { failed = true; }
    IDBObjectStore.prototype.put = originalPut;
    check(failed && await store.getStorefrontPhotoDraft("a", "saved"), "transaction abort lost recovery draft");
    await store.getStorefrontPhotoPrefill("a", "saved");
    // Concurrent replacements are serialized; the latest call wins.
    await Promise.all([store.saveStorefrontPhotoPrefill("a", order("serial"), image),
      store.saveStorefrontPhotoPrefill("a", order("serial"), new File([png], "latest.png", { type: "image/png" }))]);
    check((await store.getStorefrontPhotoPrefill("a", "serial")).fileName === "latest.jpg", "older save overwrote latest");
    await Promise.all([store.saveStorefrontPhotoPrefill("a", order("deleted"), image), store.deleteStorefrontPhotoPrefill("a", "deleted")]);
    check(await store.getStorefrontPhotoPrefill("a", "deleted") === null, "pending save resurrected deletion");
    // The compatibility fallback must save when Worker creation is blocked.
    const OriginalWorker = Worker;
    window.Worker = class { constructor() { throw new Error("test worker unsupported"); } };
    await store.saveStorefrontPhotoPrefill("a", order("fallback"), image);
    window.Worker = OriginalWorker;
    // Suspend compression after durable staging, then terminate the JS context.
    window.Worker = class { postMessage() {} terminate() {} };
    void store.saveStorefrontPhotoPrefill("a", order("interrupted"), image).catch(() => undefined);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await store.getStorefrontPhotoDraft("a", "interrupted")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    check(await store.getStorefrontPhotoDraft("a", "interrupted"), "no durable draft before interruption");
    return "PASS: legacy migration, real JPEG encode/decode, account isolation, corruption, quota, transaction abort, retry, concurrent replacement, deletion ordering, Worker fallback, durable interruption draft";
  }));
  // End the process and reopen the same isolated profile, retaining IndexedDB.
  await closeBrowser();
  await launch();
  console.log(await evaluate(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const store = await import("/src/services/storefrontPrefillStore.ts");
    check(await store.getStorefrontPhotoDraft("a", "interrupted"), "draft lost across browser restart");
    const recovered = await store.getStorefrontPhotoPrefill("a", "interrupted");
    check(recovered?.size > 0 && recovered.size <= 500 * 1024, "interrupted save did not recover");
    check(await store.getStorefrontPhotoDraft("a", "interrupted") === null, "recovered draft not cleaned");
    const saved = await store.getStorefrontPhotoPrefill("a", "saved");
    const bitmap = await createImageBitmap(store.storefrontPhotoPrefillToFile(saved));
    check(bitmap.width > 0, "saved image unreadable after process restart"); bitmap.close();
    check(await store.getStorefrontPhotoPrefill("a", "deleted") === null, "deleted image returned after restart");
    const backup = await import("/src/services/fullBackup.ts");
    const plan = await backup.prepareFullBackupArchiveStream();
    check(plan.totalRecordCount > 0, "backup plan lost saved photos");
    // Test schema compatibility directly; the streaming plan also must succeed.
    const legacy = { name: "kidindin-unreachable-prefills", version: 1, stores: [{ name: "storefrontPhotos",
      keyPath: "key", autoIncrement: false, indexes: [{ name: "accountKey", keyPath: "accountKey", unique: false, multiEntry: false }], records: [] }] };
    backup.fullBackupArchiveInternals.assertDatabaseSchema(legacy, "test legacy backup");
    check(legacy.version === 2 && legacy.stores.length === 2, "legacy backup schema did not migrate");
    return "PASS: browser process restart, draft recovery, persisted image decode, durable deletion, backup export plan and legacy backup compatibility";
  }));
} catch (error) {
  console.error(`Edge exit: ${browser?.exitCode}; diagnostic: ${browserLog.slice(-3500)}`);
  throw error;
} finally {
  await closeBrowser();
  await vite.close();
  console.log(`Synthetic test profile retained for inspection: ${profile}`);
}
