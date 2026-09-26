import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoticeCode, resolveNoticeRecognition, noticeCodeConflict, boundedNoticeTask } from "./noticeCodePolicy.ts";

test("preserves leading zeroes and rejects unrelated text", () => {
  assert.equal(normalizeNoticeCode("００１２３４５６７８"), "0012345678");
  assert.equal(normalizeNoticeCode("26000 27013"), "2600027013");
  assert.equal(normalizeNoticeCode("https://example.test/123456"), "");
  assert.equal(normalizeNoticeCode("C7-2104"), "");
});
test("barcode and OCR agreement automatically confirms the code", () => {
  const result = resolveNoticeRecognition({ barcodes: ["2600027013"], texts: ["2600027013"] });
  assert.equal(result.confirmed, true);
  assert.equal(result.source, "matched");
});
test("OCR alone, conflicting results and multiple barcodes require confirmation", () => {
  for (const value of [
    { barcodes: [], texts: ["2600027013"] },
    { barcodes: ["2600027013"], texts: ["2600027018"] },
    { barcodes: ["2600027013", "2600027018"], texts: [] },
    { barcodes: [], texts: [] },
  ]) assert.equal(resolveNoticeRecognition(value).confirmed, false);
});
test("a valid single barcode can supplement failed OCR", () => {
  assert.equal(resolveNoticeRecognition({ barcodes: ["0012345678"], texts: [] }).confirmed, true);
});
test("different photos of the same notice conflict across orders, but retries do not", () => {
  const history = [{ code: "0012345678", woHeaderId: "first", label: "Original order" }];
  assert.equal(noticeCodeConflict("0012345678", "retry-other", history)?.woHeaderId, "first");
  assert.equal(noticeCodeConflict("0012345678", "first", history), undefined);
  assert.equal(noticeCodeConflict("12345678", "other", history), undefined);
});
test("an unresponsive recognizer times out", async () => {
  await assert.rejects(boundedNoticeTask(new Promise(() => {}), new AbortController().signal, 10), /超时/);
});
test("disabling immediately releases an in-flight task and ignores its late result", async () => {
  let complete;
  const controller = new AbortController();
  const result = boundedNoticeTask(new Promise((resolve) => { complete = resolve; }), controller.signal, 5000);
  controller.abort();
  await assert.rejects(result, /取消/);
  complete("late code");
  await assert.rejects(result, /取消/);
});
test("already cancelled and rejected operations also settle", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(boundedNoticeTask(Promise.resolve("late"), controller.signal), /取消/);
  await assert.rejects(boundedNoticeTask(Promise.reject(new Error("unavailable")), new AbortController().signal), /unavailable/);
});
