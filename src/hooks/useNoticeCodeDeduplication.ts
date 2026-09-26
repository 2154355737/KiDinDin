import { useEffect, useRef, useState } from "react";
import type { WorkOrder } from "../types/workOrder";
import { fingerprintImage } from "../services/imageDeduplication";
import { boundedNoticeTask, normalizeNoticeCode, noticeCodeConflict, resolveNoticeRecognition, type NoticeCodeResult } from "../services/noticeCodePolicy";
import { prepareNoticeImage, recognizeNoticeCode } from "../services/noticeCodeRecognition";
import { listNoticeCodes, saveNoticeCode, voidNoticeCode, type NoticeCodeRecord } from "../services/noticeCodeStore";

export type NoticeCodeEntry = NoticeCodeResult & {
  file: File;
  loading: boolean;
  sha256: string;
  preview: Blob | null;
};
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useNoticeCodeDeduplication(accountKey: string | null, enabled: boolean, files: Record<string, File>, orders: WorkOrder[]) {
  const [entries, setEntries] = useState<Record<string, NoticeCodeEntry>>({});
  const [records, setRecords] = useState<NoticeCodeRecord[]>([]);
  const [warning, setWarning] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const validationControllers = useRef(new Set<AbortController>());
  const entriesRef = useRef(entries);
  const jobs = useRef(new Map<string, { controller: AbortController; done: Promise<void>; file: File }>());
  const queue = useRef(Promise.resolve());
  const current = useRef({ accountKey, enabled, files, orders });
  current.current = { accountKey, enabled, files, orders };
  const scope = useRef(accountKey);

  function update(id: string, value: NoticeCodeEntry | null) {
    const next = { ...entriesRef.current };
    if (value) next[id] = value; else delete next[id];
    entriesRef.current = next;
    setEntries(next);
  }

  function cancel() {
    jobs.current.forEach((job) => job.controller.abort());
    jobs.current.clear();
    validationControllers.current.forEach((controller) => controller.abort());
  }

  async function refreshHistory() {
    const account = current.current.accountKey;
    if (!account) { setWarning("当前账号标识不可用，未完成历史编码校验"); return []; }
    try {
      const values = await listNoticeCodes(account);
      if (account === current.current.accountKey) setRecords(values);
      return values;
    } catch (error) {
      if (account === current.current.accountKey) setWarning(`${messageOf(error)}；可继续使用图片内容去重`);
      return null;
    }
  }

  useEffect(() => {
    if (scope.current !== accountKey) {
      cancel();
      scope.current = accountKey;
      entriesRef.current = {};
      setEntries({});
      setRecords([]);
      setWarning("");
    }
    for (const [id, job] of jobs.current) {
      if (!enabled || files[id] !== job.file || !orders.some((order) => order.id === id)) {
        job.controller.abort();
        jobs.current.delete(id);
      }
    }
    for (const [id, entry] of Object.entries(entriesRef.current)) {
      if (files[id] !== entry.file) update(id, null);
      else if (!enabled && entry.loading) update(id, { ...entry, loading: false, message: "编码校验已关闭，可继续" });
    }
    if (!enabled) return;
    for (const order of orders) {
      const id = order.id;
      const file = files[id];
      if (!file || jobs.current.has(id)) continue;
      const previous = entriesRef.current[id];
      if (previous?.file === file && !previous.loading) continue;
      const controller = new AbortController();
      const initial: NoticeCodeEntry = { file, loading: true, code: "", confirmed: false, source: "manual", message: "等待本地编码识别，可关闭开关跳过", sha256: "", preview: null };
      update(id, initial);
      const run = async () => {
        if (controller.signal.aborted) return;
        const valid = () => !controller.signal.aborted && current.current.accountKey === accountKey && current.current.files[id] === file && current.current.enabled;
        try {
          update(id, { ...initial, message: "正在本地识别编码，单张最多等待 5 秒" });
          const result = await boundedNoticeTask((async () => {
            const [{ base64, preview }, sha256] = await Promise.all([
              prepareNoticeImage(file, controller.signal), fingerprintImage(file),
            ]);
            if (valid()) update(id, { ...initial, preview, sha256, message: "正在本地识别编码，单张最多等待 5 秒" });
            const recognized = await recognizeNoticeCode(base64, controller.signal);
            return { ...resolveNoticeRecognition(recognized), preview, sha256 };
          })(), controller.signal);
          if (valid()) update(id, { ...initial, ...result, loading: false });
        } catch (error) {
          if (valid()) update(id, { ...(entriesRef.current[id] ?? initial), loading: false, message: messageOf(error) });
        } finally {
          controller.abort(); // also stops work that resumes after the deadline
          if (jobs.current.get(id)?.controller === controller) jobs.current.delete(id);
        }
      };
      const done = boundedNoticeTask(queue.current.then(run), controller.signal, 60_000).catch(() => {
        if (!controller.signal.aborted && current.current.accountKey === accountKey && current.current.files[id] === file) {
          update(id, { ...initial, loading: false, message: "编码识别排队超时，可重试或继续" });
          controller.abort();
        }
        if (jobs.current.get(id)?.controller === controller) jobs.current.delete(id);
      });
      jobs.current.set(id, { controller, done, file });
      queue.current = done;
    }
  }, [accountKey, enabled, files, orders, retryVersion]);

  useEffect(() => { if (enabled) void refreshHistory(); }, [accountKey, enabled]);

  useEffect(() => () => cancel(), []);

  function setEnabledImmediately(value: boolean) {
    current.current.enabled = value;
    if (!value) cancel();
  }

  function confirm(id: string, rawCode: string) {
    const entry = entriesRef.current[id];
    const code = normalizeNoticeCode(rawCode);
    if (!entry || !code) throw new Error("请输入 6–32 位数字编码，保留开头的 0");
    jobs.current.get(id)?.controller.abort();
    jobs.current.delete(id);
    update(id, { ...entry, code, confirmed: true, loading: false, source: "manual", message: "编码已经人工确认" });
  }

  function skip(id: string) {
    jobs.current.get(id)?.controller.abort();
    jobs.current.delete(id);
    const entry = entriesRef.current[id];
    if (entry) update(id, { ...entry, code: "", confirmed: false, loading: false, message: "本张已跳过编码校验，仍检查图片内容重复" });
  }

  function retry(id: string) {
    jobs.current.get(id)?.controller.abort();
    jobs.current.delete(id);
    const entry = entriesRef.current[id];
    if (entry) update(id, { ...entry, loading: true });
    setRetryVersion((value) => value + 1);
  }

  async function validate(batch: WorkOrder[]): Promise<string | null> {
    if (!current.current.enabled) return null;
    const account = current.current.accountKey;
    const snapshots = batch.map((order) => current.current.files[order.id]);
    const waitController = new AbortController();
    validationControllers.current.add(waitController);
    try {
    try {
      await boundedNoticeTask(Promise.all([...jobs.current.values()].map((job) => job.done)), waitController.signal);
    } catch {
      batch.forEach((order) => { if (entriesRef.current[order.id]?.loading) skip(order.id); });
      setWarning("部分图片识别等待超时，已跳过其编码校验");
    }
    if (!current.current.enabled) return null;
    let history: NoticeCodeRecord[] | null = null;
    try { history = await boundedNoticeTask(refreshHistory(), waitController.signal, 2500); }
    catch { if (current.current.enabled) setWarning("历史编码校验已跳过，可继续使用图片内容去重"); }
    if (!current.current.enabled) return null;
    if (account !== current.current.accountKey || batch.some((order, index) => snapshots[index] !== current.current.files[order.id])) return "账号或图片已变化，请重新确认提交";
    const seen = (history ?? []).filter((record) => record.status === "used").map(({ code, woHeaderId, label }) => ({ code, woHeaderId, label }));
    for (const order of batch) {
      const entry = entriesRef.current[order.id];
      if (!entry?.confirmed || entry.file !== current.current.files[order.id]) continue;
      const conflict = noticeCodeConflict(entry.code, order.woHeaderId, seen);
      if (conflict) return `通知单编码 ${entry.code} 与“${conflict.label}”重复，请更换照片、核对编码，或关闭编码去重后继续`;
      seen.push({ code: entry.code, woHeaderId: order.woHeaderId, label: `${order.woNumber} · ${order.address}` });
    }
    return null;
    } finally {
      waitController.abort();
      validationControllers.current.delete(waitController);
    }
  }

  async function recordClosed(order: WorkOrder, file: File | undefined, account: string | null) {
    const entry = entriesRef.current[order.id];
    if (!account || account !== current.current.accountKey || !entry?.confirmed || entry.file !== file) return;
    try {
      const controller = new AbortController();
      let sha256 = entry.sha256;
      try { if (!sha256) sha256 = await boundedNoticeTask(fingerprintImage(entry.file), controller.signal, 2000); }
      finally { controller.abort(); }
      await saveNoticeCode({ key: JSON.stringify([account, order.woHeaderId]), accountKey: account, woHeaderId: order.woHeaderId,
        label: `${order.woNumber} · ${order.address}`, code: entry.code, source: entry.source, sha256, preview: entry.preview,
        status: "used", updatedAt: new Date().toISOString() });
    } catch (error) {
      setWarning(`${order.woNumber} 已关闭，但本地编码记录失败：${messageOf(error)}`);
    }
  }

  function conflictFor(id: string) {
    const order = orders.find((value) => value.id === id);
    const entry = entries[id];
    if (!enabled || !order || !entry?.confirmed || entry.file !== files[id]) return null;
    return noticeCodeConflict(entry.code, order.woHeaderId, [
      ...records.filter((record) => record.status === "used"),
      ...orders.filter((other) => entries[other.id]?.confirmed && entries[other.id]?.file === files[other.id]).map((other) => ({
        woHeaderId: other.woHeaderId, label: `${other.woNumber} · ${other.address}`, code: entries[other.id].code,
      })),
    ]);
  }

  return { entries, records, warning, refreshHistory, confirm, skip, retry, validate, recordClosed, setEnabledImmediately, conflictFor,
    invalidate: async (key: string) => { await voidNoticeCode(key); await refreshHistory(); } };
}
