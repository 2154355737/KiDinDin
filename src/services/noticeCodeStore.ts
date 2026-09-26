import type { NoticeCodeSource } from "./noticeCodePolicy";

export type NoticeCodeRecord = {
  key: string;
  accountKey: string;
  woHeaderId: string;
  label: string;
  code: string;
  source: NoticeCodeSource;
  sha256: string;
  preview: Blob | null;
  status: "used" | "void";
  updatedAt: string;
};

const DATABASE = "kidindin-notice-codes";
const STORE = "noticeCodes";

// The deadline also aborts writes, so a timed-out write cannot appear later.
function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let settled = false;
    let value: T;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db?.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch { /* transaction may already be complete */ }
      finish(new Error("编码记录读写超时，本次未完成历史校验"));
    }, 2000);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("accountKey", "accountKey");
      };
      request.onerror = () => finish(new Error("无法打开本地编码记录"));
      request.onblocked = () => finish(new Error("编码数据库被占用，本次未完成历史校验"));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => db?.close();
        try {
          tx = db.transaction(STORE, mode);
          tx.oncomplete = () => finish();
          tx.onerror = tx.onabort = () => finish(new Error("本地编码记录读写失败"));
          action(tx.objectStore(STORE), (next) => { value = next; });
        } catch (error) { finish(error); }
      };
    } catch (error) { finish(error); }
  });
}

export function listNoticeCodes(accountKey: string) {
  return transaction<NoticeCodeRecord[]>("readonly", (store, result) => {
    const request = store.index("accountKey").getAll(accountKey);
    request.onsuccess = () => result(request.result);
  });
}

export function saveNoticeCode(record: NoticeCodeRecord) {
  return transaction<void>("readwrite", (store, result) => {
    store.put(record);
    result(undefined);
  });
}

export function voidNoticeCode(key: string) {
  return transaction<void>("readwrite", (store, result) => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, status: "void", updatedAt: new Date().toISOString() });
      result(undefined);
    };
  });
}
