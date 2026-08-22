import type { WorkOrder } from "../types/workOrder";

export type SignatureRecord = {
  accountKey: string;
  address: string;
  blob: Blob;
  building: string;
  key: string;
  resident: string;
  signedAt: string;
  signerName: string;
  unit: string;
  woHeaderId: string;
  woNumber: string;
};

const DATABASE_NAME = "kidindin-signatures";
const DATABASE_VERSION = 1;
const STORE_NAME = "signatures";
const ACCOUNT_INDEX = "accountKey";

function detail(error: unknown) {
  return error instanceof Error && error.message ? `：${error.message}` : "";
}

function databaseError(action: string, error: unknown) {
  return new Error(`${action}失败${detail(error)}`);
}

function requireIdentifier(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label}不能为空`);
}

function signatureKey(accountKey: string, woHeaderId: string) {
  requireIdentifier(accountKey, "账号标识");
  requireIdentifier(woHeaderId, "工单标识");
  return JSON.stringify([accountKey, woHeaderId]);
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法保存离线签字"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "key" });
      if (store && !store.indexNames.contains(ACCOUNT_INDEX)) {
        store.createIndex(ACCOUNT_INDEX, "accountKey", { unique: false });
      }
    };
    request.onerror = () => reject(databaseError("打开签字数据库", request.error));
    request.onblocked = () => reject(new Error("签字数据库升级被其他页面阻止，请关闭其他 KiDinDin 页面后重试"));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function requestResult<T>(request: IDBRequest<T>, action: string) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(databaseError(action, request.error));
  });
}

function transactionDone(transaction: IDBTransaction, action: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(databaseError(action, transaction.error));
    transaction.onabort = () => reject(databaseError(action, transaction.error));
  });
}

function normalizeRecord(value: unknown): SignatureRecord {
  if (!value || typeof value !== "object") throw new Error("本地签字记录格式无效");
  const record = value as Record<string, unknown>;
  if (!(record.blob instanceof Blob)) throw new Error("本地签字图片格式无效");
  const stringFields = [
    "accountKey",
    "address",
    "building",
    "key",
    "resident",
    "signedAt",
    "signerName",
    "unit",
    "woHeaderId",
    "woNumber",
  ] as const;
  for (const field of stringFields) {
    if (typeof record[field] !== "string") throw new Error(`本地签字记录缺少 ${field}`);
  }
  const normalized = record as SignatureRecord;
  if (normalized.key !== signatureKey(normalized.accountKey, normalized.woHeaderId)) {
    throw new Error("本地签字记录与账号或工单不匹配");
  }
  if (!normalized.signerName.trim()) throw new Error("本地签字记录缺少签字人姓名");
  if (Number.isNaN(Date.parse(normalized.signedAt))) throw new Error("本地签字时间无效");
  return normalized;
}

export async function getSignatureRecord(accountKey: string, woHeaderId: string) {
  const key = signatureKey(accountKey, woHeaderId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    const [value] = await Promise.all([
      requestResult<unknown>(request, "读取签字记录"),
      transactionDone(transaction, "读取签字记录"),
    ]);
    return value === undefined ? null : normalizeRecord(value);
  } finally {
    database.close();
  }
}

export async function listSignatureRecords(accountKey: string) {
  requireIdentifier(accountKey, "账号标识");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(ACCOUNT_INDEX).getAll(accountKey);
    const [values] = await Promise.all([
      requestResult<unknown[]>(request, "读取签字记录"),
      transactionDone(transaction, "读取签字记录"),
    ]);
    return values
      .map(normalizeRecord)
      .sort((left, right) => Date.parse(right.signedAt) - Date.parse(left.signedAt));
  } finally {
    database.close();
  }
}

export async function getSignedWorkOrderHeaderIds(
  accountKey: string,
  woHeaderIds?: readonly string[],
) {
  requireIdentifier(accountKey, "账号标识");
  const requested = woHeaderIds
    ? new Set(woHeaderIds.map((value) => value.trim()).filter(Boolean))
    : null;
  if (requested && !requested.size) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(ACCOUNT_INDEX).getAllKeys(accountKey);
    const [keys] = await Promise.all([
      requestResult<IDBValidKey[]>(request, "读取签字工单索引"),
      transactionDone(transaction, "读取签字工单索引"),
    ]);
    return Array.from(new Set(keys.flatMap((key) => {
      if (typeof key !== "string") return [];
      try {
        const parsed: unknown = JSON.parse(key);
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 2 ||
          parsed[0] !== accountKey ||
          typeof parsed[1] !== "string" ||
          !parsed[1].trim() ||
          (requested && !requested.has(parsed[1]))
        ) return [];
        return [parsed[1]];
      } catch {
        return [];
      }
    })));
  } finally {
    database.close();
  }
}

export async function saveSignatureRecord(
  accountKey: string,
  order: WorkOrder,
  signerName: string,
  blob: Blob,
) {
  requireIdentifier(accountKey, "账号标识");
  requireIdentifier(order.woHeaderId, "工单标识");
  requireIdentifier(signerName, "签字人姓名");
  if (!blob.size || !blob.type.startsWith("image/")) throw new Error("签字图片为空，请重新签字");
  const record: SignatureRecord = {
    accountKey,
    address: order.address,
    blob: blob.slice(0, blob.size, "image/png"),
    building: order.building,
    key: signatureKey(accountKey, order.woHeaderId),
    resident: order.resident,
    signedAt: new Date().toISOString(),
    signerName: signerName.trim(),
    unit: order.unit,
    woHeaderId: order.woHeaderId,
    woNumber: order.woNumber || order.id,
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction, "保存签字记录");
    return record;
  } finally {
    database.close();
  }
}

export async function deleteSignatureRecord(accountKey: string, woHeaderId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(signatureKey(accountKey, woHeaderId));
    await transactionDone(transaction, "删除签字记录");
  } finally {
    database.close();
  }
}
