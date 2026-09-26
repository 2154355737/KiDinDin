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
const DATABASE_VERSION = 2;
const STORE_NAME = "storefrontPhotos";
const DRAFT_STORE_NAME = "storefrontPhotoDrafts";
const ACCOUNT_INDEX = "accountKey";
type PhotoDraft = StorefrontPhotoPrefill & { revision: string };
const operations = new Map<string, Promise<unknown>>();

function inPhotoOrder<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (operations.get(key) ?? Promise.resolve()).then(action, action);
  const tail = result.then(() => undefined, () => undefined);
  operations.set(key, tail);
  void tail.then(() => { if (operations.get(key) === tail) operations.delete(key); });
  return result;
}

function durableWrite(database: IDBDatabase, stores: string | string[]) {
  try {
    return database.transaction(stores, "readwrite", { durability: "strict" });
  } catch (error) {
    if (!(error instanceof TypeError) &&
        !(error instanceof DOMException && error.name === "NotSupportedError")) throw error;
    return database.transaction(stores, "readwrite");
  }
}

type UnknownRecord = Record<string, unknown>;

function errorDetail(error: unknown) {
  if (error instanceof Error && error.message) return `：${error.message}`;
  return "";
}

function databaseError(action: string, error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new Error(`${action}失败：本机存储空间不足，请释放空间后重试；不要清除 App 数据`);
  }
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
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size !== value.blob.size) {
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
        if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
          const drafts = database.createObjectStore(DRAFT_STORE_NAME, { keyPath: "key" });
          drafts.createIndex(ACCOUNT_INDEX, "accountKey", { unique: false });
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

export async function ensureStorefrontPhotoDatabase() {
  const database = await openDatabase();
  database.close();
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

export async function getSavedStorefrontPhotoPrefill(
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

  // Do not silently use an older photo when a confirmed replacement needs recovery.
  for (const id of uniqueIds) await recoverStorefrontPhotoPrefill(accountKey, id);

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

export async function listStorefrontPhotoPrefills(accountKey: string) {
  assertIdentifier(accountKey, "账号标识");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(ACCOUNT_INDEX).getAll(accountKey);
    const [values] = await Promise.all([
      requestResult<unknown[]>(request, "读取门头预填照片"),
      transactionDone(transaction, "读取门头预填照片"),
    ]);
    return values
      .map((value, index) => parsePrefill(value, `门头预填照片 ${index + 1}`))
      .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
  } finally {
    database.close();
  }
}

async function stageStorefrontPhoto(
  accountKey: string,
  order: WorkOrder,
  file: File,
) {
  assertIdentifier(accountKey, "账号标识");
  assertIdentifier(order.woHeaderId, "工单标识");
  validateImage(file);
  // Detach camera/provider-backed files before any background processing.
  const bytes = await file.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength !== file.size) {
    throw new Error("门头照片读取不完整，请重新拍照或选择图片");
  }
  const mimeType = file.type;
  const savedAt = new Date().toISOString();
  const prefill = parsePrefill(
    {
      accountKey,
      blob: new Blob([bytes], { type: mimeType }),
      fileName:
        file.name.trim() || `storefront-${order.woHeaderId}.jpg`,
      key: makeStorefrontPrefillKey(accountKey, order.woHeaderId),
      mimeType,
      resident: order.resident,
      savedAt,
      size: bytes.byteLength,
      unit: order.unit,
      woHeaderId: order.woHeaderId,
      woNumber: order.woNumber,
    },
    "门头预填照片",
  );

  const database = await openDatabase();
  try {
    const draft: PhotoDraft = { ...prefill, revision: crypto.randomUUID() };
    const transaction = durableWrite(database, DRAFT_STORE_NAME);
    const done = transactionDone(transaction, "保存门头照片恢复草稿");
    transaction.objectStore(DRAFT_STORE_NAME).put(draft);
    await done;
    return draft;
  } finally {
    database.close();
  }
}

async function deletePhoto(
  accountKey: string,
  woHeaderId: string,
) {
  const key = makeStorefrontPrefillKey(accountKey, woHeaderId);
  const database = await openDatabase();
  try {
    const transaction = durableWrite(database, [STORE_NAME, DRAFT_STORE_NAME]);
    const done = transactionDone(transaction, "删除门头预填照片");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.objectStore(DRAFT_STORE_NAME).delete(key);
    await done;
  } finally {
    database.close();
  }
}

async function readDraft(accountKey: string, woHeaderId: string): Promise<PhotoDraft | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
    const [value] = await Promise.all([
      requestResult<unknown>(transaction.objectStore(DRAFT_STORE_NAME).get(
        makeStorefrontPrefillKey(accountKey, woHeaderId)), "读取照片恢复草稿"),
      transactionDone(transaction, "读取照片恢复草稿"),
    ]);
    if (value === undefined) return null;
    const prefill = parsePrefill(value, "照片恢复草稿");
    return { ...prefill, revision: requireString(value as UnknownRecord, "revision", "照片恢复草稿", false) };
  } finally {
    database.close();
  }
}

export async function getStorefrontPhotoDraft(accountKey: string, woHeaderId: string) {
  const draft = await readDraft(accountKey, woHeaderId);
  return draft ? storefrontPhotoPrefillToFile(draft) : null;
}

async function finishDraft(draft: PhotoDraft) {
  const compressed = await compressStorefrontPhoto(storefrontPhotoPrefillToFile(draft));
  const expectedBytes = new Uint8Array(await compressed.arrayBuffer());
  if (compressed.type !== "image/jpeg" ||
      expectedBytes.length < 3 || expectedBytes[0] !== 0xff ||
      expectedBytes[1] !== 0xd8 || expectedBytes[2] !== 0xff) {
    throw new Error("压缩结果不是有效的 JPEG 图片");
  }
  const prefill = parsePrefill({
    ...draft,
    blob: compressed.slice(),
    size: compressed.size,
    mimeType: compressed.type,
    fileName: compressed.name,
  }, "压缩后的门头照片");
  const database = await openDatabase();
  try {
    const transaction = durableWrite(database, [STORE_NAME, DRAFT_STORE_NAME]);
    const done = transactionDone(transaction, "保存门头预填照片");
    const request = transaction.objectStore(DRAFT_STORE_NAME).get(draft.key);
    request.onsuccess = () => {
      // A newer capture or deletion from another window supersedes this task.
      if (request.result?.revision !== draft.revision) {
        transaction.abort();
        return;
      }
      transaction.objectStore(STORE_NAME).put(prefill);
    };
    await done;
  } finally {
    database.close();
  }
  // Confirm the persisted Blob, not the in-memory preview, before reporting success.
  const saved = await getSavedStorefrontPhotoPrefill(draft.accountKey, draft.woHeaderId);
  const actualBytes = saved ? new Uint8Array(await saved.blob.arrayBuffer()) : null;
  if (!saved || saved.savedAt !== prefill.savedAt || !actualBytes ||
      actualBytes.length !== expectedBytes.length ||
      actualBytes.some((byte, index) => byte !== expectedBytes[index])) {
    throw new Error("照片写入后回读校验失败，恢复草稿仍会保留，请重试");
  }
  const cleanupDatabase = await openDatabase();
  try {
    const transaction = durableWrite(cleanupDatabase, DRAFT_STORE_NAME);
    const done = transactionDone(transaction, "完成照片保存校验");
    const request = transaction.objectStore(DRAFT_STORE_NAME).get(draft.key);
    request.onsuccess = () => {
      if (request.result?.revision === draft.revision) {
        transaction.objectStore(DRAFT_STORE_NAME).delete(draft.key);
      } else {
        transaction.abort();
      }
    };
    await done;
  } finally {
    cleanupDatabase.close();
  }
  return saved;
}

export function saveStorefrontPhotoPrefill(accountKey: string, order: WorkOrder, file: File) {
  const key = makeStorefrontPrefillKey(accountKey, order.woHeaderId);
  const orderSnapshot = { ...order };
  return inPhotoOrder(key, async () => {
    const draft = await stageStorefrontPhoto(accountKey, orderSnapshot, file);
    try {
      return await finishDraft(draft);
    } catch (error) {
      throw new Error(`照片尚未完成保存；原图恢复草稿已写入本机，重新打开此工单可重试${errorDetail(error)}`);
    }
  });
}

export function recoverStorefrontPhotoPrefill(accountKey: string, woHeaderId: string) {
  return inPhotoOrder(makeStorefrontPrefillKey(accountKey, woHeaderId), async () => {
    const draft = await readDraft(accountKey, woHeaderId);
    if (draft) await finishDraft(draft);
  });
}

export async function getStorefrontPhotoPrefill(accountKey: string, woHeaderId: string) {
  await recoverStorefrontPhotoPrefill(accountKey, woHeaderId);
  return getSavedStorefrontPhotoPrefill(accountKey, woHeaderId);
}

export function deleteStorefrontPhotoPrefill(accountKey: string, woHeaderId: string) {
  return inPhotoOrder(makeStorefrontPrefillKey(accountKey, woHeaderId),
    () => deletePhoto(accountKey, woHeaderId));
}

export function storefrontPhotoPrefillToFile(
  prefill: StorefrontPhotoPrefill,
) {
  return new File([prefill.blob], prefill.fileName, {
    lastModified: Date.parse(prefill.savedAt),
    type: prefill.mimeType || prefill.blob.type || "image/jpeg",
  });
}
