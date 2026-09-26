export type NoticeCodeSource = "barcode" | "matched" | "manual";
export type NoticeRecognition = { barcodes: string[]; texts: string[] };
export type NoticeCodeResult = {
  code: string;
  confirmed: boolean;
  source: NoticeCodeSource;
  message: string;
};

// Preserve leading zeroes. Length is a defensive bound, not a document contract.
export function normalizeNoticeCode(value: string) {
  const code = value.normalize("NFKC").replace(/\s/g, "");
  return /^\d{6,32}$/.test(code) ? code : "";
}

export function resolveNoticeRecognition(result: NoticeRecognition): NoticeCodeResult {
  const unique = (items: string[]) => [...new Set(items.map(normalizeNoticeCode).filter(Boolean))];
  const bars = unique(result.barcodes);
  const texts = unique(result.texts);
  if (bars.length === 1 && (texts.length === 0 || (texts.length === 1 && texts[0] === bars[0]))) {
    return { code: bars[0], confirmed: true, source: texts.length ? "matched" : "barcode", message: texts.length ? "条码与文字一致" : "条形码已识别" };
  }
  return {
    code: bars[0] ?? texts[0] ?? "", confirmed: false, source: "manual",
    message: bars.length > 1 || texts.length > 1 || (bars.length > 0 && texts.length > 0)
      ? `识别结果存在歧义，请核对：${[...new Set([...bars, ...texts])].join(" / ")}`
      : texts.length ? "仅识别到文字，请核对后确认编码" : "未识别到通知单编码，可手动填写或继续",
  };
}

export function noticeCodeConflict(
  code: string, woHeaderId: string,
  entries: readonly { code: string; woHeaderId: string; label: string }[],
) {
  return entries.find((entry) => entry.code === code && entry.woHeaderId !== woHeaderId);
}

export function boundedNoticeTask<T>(task: Promise<T>, signal: AbortSignal, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new Error("编码校验已取消")));
    const timer = setTimeout(() => finish(() => reject(new Error("编码识别超时，本张未完成编码校验，可继续"))), timeoutMs);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    task.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}
