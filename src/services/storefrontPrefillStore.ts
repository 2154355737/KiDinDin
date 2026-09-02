import type { WorkOrder } from "../types/workOrder";
import { compressStorefrontPhoto } from "./storefrontPhotoCompression";

export type StorefrontPhotoPrefill = {
  accountKey: string;
  blob: Blob;
  fileName: string;
  key: string;
  mimeType: string;
  resident: string;
  savedAt: string;
  size: number;
  unit: string;
  woHeaderId: string;
  woNumber: string;
};

const DATABASE_NAME = "kidindin-unreachable-prefills";
const DATABASE_VERSION = 1;
const STORE_NAME = "storefrontPhotos";
const ACCOUNT_INDEX = "accountKey";

type UnknownRecord = Record<string, unknown>;

function errorDetail(error: unknown) {
  if (error instanceof Error && error.message) return `：${error.message}`;
  return "";
}

function databaseError(action: string, error: unknown) {
  return new Error(`${action}失败${errorDetail(error)}`);
}

function assertIdentifier(value: string, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName}不能为空`);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: UnknownRecord,
  field: string,
  location: string,
  allowEmpty = true,
) {
  const value = record[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(
      `${location}.${field} 必须是${allowEmpty ? "字符串" : "非空字符串"}`,
    );
  }
  return value;
}

function makeStorefrontPrefillKey(accountKey: string, woHeaderId: string) {
  assertIdentifier(accountKey, "账号标识");
  assertIdentifier(woHeaderId, "工单标识");
  return JSON.stringify([accountKey, woHeaderId]);
}

function parsePrefill(value: unknown, location: string) {
  if (!isRecord(value)) throw new Error(`${location}必须是对象`);
  if (!(value.blob instanceof Blob)) {
    throw new Error(`${location}.blob 必须是本地图片`);
  }
  const accountKey = requireString(value, "accountKey", location, false);
  const woHeaderId = requireString(value, "woHeaderId", location, false);
  const key = requireString(value, "key", location, false);
  if (key !== makeStorefrontPrefillKey(accountKey, woHeaderId)) {
    throw new Error(`${location}.key 与账号和工单标识不匹配`);
  }
  const size = value.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    throw new Error(`${location}.size 必须是有效的图片大小`);
  }
  const savedAt = requireString(value, "savedAt", location, false);
  if (Number.isNaN(Date.parse(savedAt))) {
    throw new Error(`${location}.savedAt 必须是有效时间`);
  }
  return {
    accountKey,
    blob: value.blob,
    fileName: requireString(value, "fileName", location, false),
    key,
    mimeType: requireString(value, "mimeType", location),
    resident: requireString(value, "resident", location),
    savedAt,
    size,
    unit: requireString(value, "unit", location),
    woHeaderId,
    woNumber: requireString(value, "woNumber", location),
  } satisfies StorefrontPhotoPrefill;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法持久保存门头照片"));
      return;
    }

    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction?.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "key" });
        if (!store) throw new Error("无法创建门头照片数据表");
        if (!store.indexNames.contains(ACCOUNT_INDEX)) {
          store.createIndex(ACCOUNT_INDEX, "accountKey", { unique: false });
        }
      } catch (error) {
        request.transaction?.abort();
        if (!settled) {
          settled = true;
          reject(databaseError("初始化门头照片数据库", error));
        }
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(databaseError("打开门头照片数据库", request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("门头照片数据库升级被其他页面阻止，请关闭其他 KiDinDin 页面后重试"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
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
    let settled = false;
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(databaseError(action, transaction.error));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(databaseError(action, transaction.error));
    };
  });
}

function validateImage(file: File) {
  if (!file.size) throw new Error("门头照片为空，请重新拍照或选择图片");
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("门头预填只支持图片文件");
  }
}

export async function getStorefrontPhotoPrefill(
  accountKey: string,
  woHeaderId: string,
) {
  const key = makeStorefrontPrefillKey(accountKey, woHeaderId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    const [value] = await Promise.all([
      requestResult<unknown>(request, "读取门头预填照片"),
      transactionDone(transaction, "读取门头预填照片"),
    ]);
    return value === undefined ? null : parsePrefill(value, "门头预填照片");
  } finally {
    database.close();
  }
}

export async function getStorefrontPhotoPrefills(
  accountKey: string,
  woHeaderIds: string[],
) {
  assertIdentifier(accountKey, "账号标识");
  const uniqueIds = Array.from(
    new Set(woHeaderIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (!uniqueIds.length) return {} as Record<string, StorefrontPhotoPrefill>;

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const done = transactionDone(transaction, "批量读取门头预填照片");
    const values = await Promise.all(
      uniqueIds.map((woHeaderId) =>
        requestResult<unknown>(
          store.get(makeStorefrontPrefillKey(accountKey, woHeaderId)),
          "批量读取门头预填照片",
        ),
      ),
    );
    await done;
    return Object.fromEntries(
      values.flatMap((value, index) =>
        value === undefined
          ? []
          : [
              [
                uniqueIds[index],
                parsePrefill(value, `门头预填照片 ${index + 1}`),
              ],
            ],
      ),
    ) as Record<string, StorefrontPhotoPrefill>;
  } finally {
    database.close();
  }
}

export async function getStorefrontPhotoPrefillHeaderIds(
  accountKey: string,
  woHeaderIds?: readonly string[],
) {
  assertIdentifier(accountKey, "账号标识");
  const requestedIds = woHeaderIds
    ? new Set(woHeaderIds.map((value) => value.trim()).filter(Boolean))
    : null;
  if (requestedIds && !requestedIds.size) return [];

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction
      .objectStore(STORE_NAME)
      .index(ACCOUNT_INDEX)
      .getAllKeys(accountKey);
    const [keys] = await Promise.all([
      requestResult<IDBValidKey[]>(request, "读取门头预填索引"),
      transactionDone(transaction, "读取门头预填索引"),
    ]);
    return Array.from(
      new Set(
        keys.flatMap((key) => {
          if (typeof key !== "string") return [];
          try {
            const parsed: unknown = JSON.parse(key);
            if (
              !Array.isArray(parsed) ||
              parsed.length !== 2 ||
              parsed[0] !== accountKey ||
              typeof parsed[1] !== "string" ||
              !parsed[1].trim() ||
              (requestedIds && !requestedIds.has(parsed[1]))
            ) {
              return [];
            }
            return [parsed[1]];
          } catch {
            return [];
          }
        }),
      ),
    );
  } finally {
    database.close();
  }
}

export async function saveStorefrontPhotoPrefill(
  accountKey: string,
  order: WorkOrder,
  file: File,
) {
  assertIdentifier(accountKey, "账号标识");
  assertIdentifier(order.woHeaderId, "工单标识");
  validateImage(file);
  const compressedFile = await compressStorefrontPhoto(file);
  const mimeType = compressedFile.type || "image/jpeg";
  const savedAt = new Date().toISOString();
  const prefill = parsePrefill(
    {
      accountKey,
      blob: compressedFile.slice(0, compressedFile.size, mimeType),
      fileName:
        compressedFile.name.trim() || `storefront-${order.woHeaderId}.jpg`,
      key: makeStorefrontPrefillKey(accountKey, order.woHeaderId),
      mimeType,
      resident: order.resident,
      savedAt,
      size: compressedFile.size,
      unit: order.unit,
      woHeaderId: order.woHeaderId,
      woNumber: order.woNumber,
    },
    "门头预填照片",
  );

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(prefill);
    await transactionDone(transaction, "保存门头预填照片");
    return prefill;
  } finally {
    database.close();
  }
}

export async function deleteStorefrontPhotoPrefill(
  accountKey: string,
  woHeaderId: string,
) {
  const key = makeStorefrontPrefillKey(accountKey, woHeaderId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionDone(transaction, "删除门头预填照片");
  } finally {
    database.close();
  }
}

export function storefrontPhotoPrefillToFile(
  prefill: StorefrontPhotoPrefill,
) {
  return new File([prefill.blob], prefill.fileName, {
    lastModified: Date.parse(prefill.savedAt),
    type: prefill.mimeType || prefill.blob.type || "image/jpeg",
  });
}
