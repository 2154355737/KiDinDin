import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the actual React handler with isolated state/network dependencies.
// No server, session, or real work order is used.
const text = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function sourceOf(name) {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `missing actual application function ${name}`);
  return found;
}
function instantiate(name, env) {
  const code = ts.transpileModule(`(${sourceOf(name)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(env), `return ${code}`)(...Object.values(env));
}
const registeredWatermarkAddress = instantiate("registeredWatermarkAddress", {});
const isReusableWatermarkedUpload = instantiate("isReusableWatermarkedUpload", { registeredWatermarkAddress });

function harness(addWatermark, { missing = false, attachmentCount = 2 } = {}) {
  const photo = new File(["synthetic"], "photo.jpg", { type: "image/jpeg" });
  const orders = [{ id: "one", woNumber: "one", address: "1栋101" }, { id: "two", woNumber: "two", address: "2栋101" }];
  const state = {};
  const calls = { upload: [], download: 0, list: 0, wait: 0 };
  const setter = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key] ?? {}) : value; };
  const env = {
    appSettings: { unreachableVisit: { addWatermark }, diagnostics: { showWatermarkGenerationDebug: true } },
    watermarkPreparationSequenceRef: { current: 0 }, watermarkedUploads: {},
    historyFiles: { one: photo, two: photo }, detailCloseupFiles: missing ? {} : { one: photo, two: photo },
    setWatermarkedUploads: setter("uploads"), setWatermarkPreparationByOrder: setter("statuses"),
    setWatermarkPreparationRunning: setter("running"), setWatermarkPreparationMessage: setter("message"),
    isReusableWatermarkedUpload, registeredWatermarkAddress,
    submitIntervalMaxSeconds: 2, submitIntervalMinSeconds: 1,
    randomIntervalSeconds: () => 1, wait: async () => { calls.wait++; },
    messageOf: (error) => error.message,
    uploadWorkOrderFiles: async (files, bizId, options) => {
      calls.upload.push({ files, bizId, options });
      return { data: { bizId: "uploaded", sysAttachList: Array.from({ length: attachmentCount }, (_, index) => ({ downloadFilePath: `test-${index}` })) } };
    },
    fetchWorkOrderFiles: async () => { calls.list++; return []; },
    downloadWorkOrderFile: async () => { calls.download++; return photo; },
  };
  return { state, calls, photo, orders, env, run: instantiate("prepareWatermarkedUploads", env) };
}

test("watermark off prepares local previews with zero network calls or interval waits", async () => {
  const h = harness(false);
  await h.run(h.orders);
  assert.deepEqual(h.calls, { upload: [], download: 0, list: 0, wait: 0 });
  assert.equal(h.state.running, false);
  for (const order of h.orders) {
    assert.equal(h.state.statuses[order.id].status, "ready");
    const prepared = h.state.uploads[order.id];
    assert.equal(prepared.watermarked, false);
    assert.equal(prepared.bizId, "");
    assert.equal(prepared.previewFiles[0], h.photo);
    assert.ok(isReusableWatermarkedUpload(order, prepared, h.photo, h.photo, false));
    assert.equal(isReusableWatermarkedUpload(order, prepared, h.photo, h.photo, true), false);
  }
});

test("missing photos cannot become ready or trigger requests", async () => {
  const h = harness(false, { missing: true });
  await h.run(h.orders);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.state.statuses.one.status, "error");
  assert.equal(Object.keys(h.state.uploads).length, 0);
});

test("watermark on retains upload, two attachment previews and configured interval", async () => {
  const h = harness(true);
  await h.run(h.orders);
  assert.equal(h.calls.upload.length, 2);
  assert.equal(h.calls.download, 4);
  assert.equal(h.calls.wait, 1);
  assert.equal(h.state.statuses.one.status, "ready");
  for (const call of h.calls.upload) {
    assert.equal(call.options.securityWatermark, true);
    assert.equal(call.options.compressBeforeUpload, false, "must not resize before upload");
  }
});

test("invalid attachment groups cannot become ready", async () => {
  const h = harness(true, { attachmentCount: 3 });
  await h.run(h.orders);
  assert.equal(h.state.statuses.one.status, "error");
  assert.equal(h.calls.download, 0);
});
