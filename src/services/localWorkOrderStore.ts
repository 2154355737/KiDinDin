export type LocalWorkOrderSnapshot = {
  woNumber: string;
  resident: string;
  unit: string;
  address: string;
  building: string;
  unitNumber: string;
  backendStatusCode: string;
  status: string;
  time: string;
};

export type LocalWorkOrderMeta = {
  key: string;
  accountKey: string;
  woHeaderId: string;
  favorite: boolean;
  pinned: boolean;
  note: string;
  appointmentAt: string | null;
  sourceDate: string;
  updatedAt: string;
  snapshot: LocalWorkOrderSnapshot;
};

const DATABASE_NAME = "kidindin-local-work-orders";
const DATABASE_VERSION = 1;
const STORE_NAME = "workOrderMeta";
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

function requireString(record: UnknownRecord, field: string, location: string, allowEmpty = true) {
  const value = record[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${location}.${field} 必须是${allowEmpty ? "字符串" : "非空字符串"}`);
  }
  return value;
}

function requireBoolean(record: UnknownRecord, field: string, location: string) {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new Error(`${location}.${field} 必须是布尔值`);
  }
  return value;
}

function requireDateTime(value: string, location: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`${location} 必须是有效的日期时间`);
  }
  return value;
}

function requireDateOnly(value: string, location: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${location} 必须使用 YYYY-MM-DD 格式`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${location} 必须是有效日期`);
  }
  return value;
}

function parseSnapshot(value: unknown, location: string): LocalWorkOrderSnapshot {
  if (!isRecord(value)) throw new Error(`${location} 必须是对象`);
  return {
    woNumber: requireString(value, "woNumber", location),
    resident: requireString(value, "resident", location),
    unit: requireString(value, "unit", location),
    address: requireString(value, "address", location),
    building: requireString(value, "building", location),
    unitNumber: requireString(value, "unitNumber", location),
    backendStatusCode: requireString(value, "backendStatusCode", location),
    status: requireString(value, "status", location),
    time: requireString(value, "time", location),
  };
}

function parseMeta(value: unknown, location: string): LocalWorkOrderMeta {
  if (!isRecord(value)) throw new Error(`${location} 必须是对象`);

  const appointmentValue = value.appointmentAt;
  if (appointmentValue !== null && typeof appointmentValue !== "string") {
    throw new Error(`${location}.appointmentAt 必须是日期时间字符串或 null`);
  }
  const appointmentAt = appointmentValue === null || !appointmentValue.trim()
    ? null
    : requireDateTime(appointmentValue, `${location}.appointmentAt`);

  return {
    key: requireString(value, "key", location, false),
    accountKey: requireString(value, "accountKey", location, false),
    woHeaderId: requireString(value, "woHeaderId", location, false),
    favorite: requireBoolean(value, "favorite", location),
    pinned: requireBoolean(value, "pinned", location),
    note: requireString(value, "note", location),
    appointmentAt,
    sourceDate: requireDateOnly(requireString(value, "sourceDate", location, false), `${location}.sourceDate`),
    updatedAt: requireDateTime(requireString(value, "updatedAt", location, false), `${location}.updatedAt`),
    snapshot: parseSnapshot(value.snapshot, `${location}.snapshot`),
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法使用本地工单功能"));
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
        if (!store) throw new Error("无法创建本地工单数据表");
        if (!store.indexNames.contains(ACCOUNT_INDEX)) {
          store.createIndex(ACCOUNT_INDEX, "accountKey", { unique: false });
        }
      } catch (error) {
        request.transaction?.abort();
        if (!settled) {
          settled = true;
          reject(databaseError("初始化本地工单数据库", error));
        }
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(databaseError("打开本地工单数据库", request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("本地工单数据库升级被其他页面阻止，请关闭其他 KiDinDin 页面后重试"));
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

function sortMeta(items: LocalWorkOrderMeta[]) {
  return items.sort((left, right) => {
    const byUpdatedAt = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return byUpdatedAt || left.key.localeCompare(right.key);
  });
}

function validateStoredItems(values: unknown[], accountKey: string) {
  return sortMeta(values.map((value, index) => {
    const item = parseMeta(value, `本地工单第 ${index + 1} 条`);
    if (item.accountKey !== accountKey) {
      throw new Error(`本地工单第 ${index + 1} 条账号标识不一致`);
    }
    if (item.key !== makeLocalWorkOrderKey(item.accountKey, item.woHeaderId)) {
      throw new Error(`本地工单第 ${index + 1} 条主键不正确`);
    }
    return item;
  }));
}

export function makeLocalWorkOrderKey(accountKey: string, woHeaderId: string) {
  assertIdentifier(accountKey, "账号标识");
  assertIdentifier(woHeaderId, "工单标识");
  return JSON.stringify([accountKey, woHeaderId]);
}

export async function listLocalWorkOrderMeta(accountKey: string) {
  assertIdentifier(accountKey, "账号标识");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(ACCOUNT_INDEX).getAll(accountKey);
    const [items] = await Promise.all([
      requestResult<unknown[]>(request, "读取本地工单"),
      transactionDone(transaction, "读取本地工单"),
    ]);
    return validateStoredItems(items, accountKey);
  } finally {
    database.close();
  }
}

export async function saveLocalWorkOrderMeta(meta: LocalWorkOrderMeta) {
  const item = parseMeta(meta, "本地工单");
  const expectedKey = makeLocalWorkOrderKey(item.accountKey, item.woHeaderId);
  if (item.key !== expectedKey) throw new Error("本地工单.key 与账号和工单标识不匹配");

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(item);
    await Promise.all([
      requestResult(request, "保存本地工单"),
      transactionDone(transaction, "保存本地工单"),
    ]);
    return item;
  } finally {
    database.close();
  }
}

export async function deleteLocalWorkOrderMeta(key: string) {
  assertIdentifier(key, "本地工单主键");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(key);
    await Promise.all([
      requestResult(request, "删除本地工单"),
      transactionDone(transaction, "删除本地工单"),
    ]);
  } finally {
    database.close();
  }
}

export async function clearLocalWorkOrderMeta(accountKey: string) {
  assertIdentifier(accountKey, "账号标识");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const index = transaction.objectStore(STORE_NAME).index(ACCOUNT_INDEX);
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(accountKey));
    const cursorDone = new Promise<void>((resolve, reject) => {
      cursorRequest.onerror = () => reject(databaseError("清空本地工单", cursorRequest.error));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
    });
    await Promise.all([cursorDone, transactionDone(transaction, "清空本地工单")]);
  } finally {
    database.close();
  }
}

export async function exportLocalWorkOrderMeta(accountKey: string) {
  const items = await listLocalWorkOrderMeta(accountKey);
  return JSON.stringify(items, null, 2);
}

export async function importLocalWorkOrderMeta(accountKey: string, payload: string) {
  assertIdentifier(accountKey, "账号标识");
  if (typeof payload !== "string" || !payload.trim()) throw new Error("导入内容不能为空");

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw databaseError("解析导入 JSON", error);
  }
  if (!Array.isArray(parsed)) throw new Error("导入 JSON 顶层必须是数组");

  const seenWorkOrders = new Set<string>();
  const items = parsed.map((value, index) => {
    const item = parseMeta(value, `导入数据第 ${index + 1} 条`);
    if (seenWorkOrders.has(item.woHeaderId)) {
      throw new Error(`导入数据包含重复工单：${item.woHeaderId}`);
    }
    seenWorkOrders.add(item.woHeaderId);
    return {
      ...item,
      accountKey,
      key: makeLocalWorkOrderKey(accountKey, item.woHeaderId),
    };
  });

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const writes = items.map((item) => requestResult(store.put(item), `导入工单 ${item.woHeaderId}`));
    const listRequest = store.index(ACCOUNT_INDEX).getAll(accountKey);
    const results = await Promise.all([
      ...writes,
      requestResult<unknown[]>(listRequest, "读取导入后的本地工单"),
      transactionDone(transaction, "导入本地工单"),
    ]);
    const storedItems = results[items.length] as unknown[];
    return validateStoredItems(storedItems, accountKey);
  } finally {
    database.close();
  }
}
