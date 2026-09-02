import {
  exportNativeDatabaseBackup,
  importNativeDatabaseBackup,
  isNativeRuntime,
  saveNativeBackupFile,
  validateNativeDatabaseBackup,
  type NativeDatabaseImportResult,
} from "./tauri";

export const FULL_BACKUP_KIND = "kidindin-full-backup";
export const FULL_BACKUP_VERSION = 1;
export const MAX_FULL_BACKUP_FILE_BYTES = 96 * 1024 * 1024;

const KNOWN_DATABASE_NAMES = [
  "kidindin-local-work-orders",
  "kidindin-signatures",
  "kidindin-unreachable-prefills",
  "kidindin-upload-file-names",
] as const;

const SAFE_DATABASE_NAMES = new Set<string>(KNOWN_DATABASE_NAMES);
const TRANSIENT_BACKUP_DATABASE_PREFIXES = [
  "kidindin-backup-staging-",
  "kidindin-backup-rollback-",
] as const;
const SAFE_LOCAL_STORAGE_KEYS = new Set([
  "kidindin.appearance-settings.v3",
  "kidindin.theme-settings.v2",
  "kidindin.app-settings.v1",
  "kidindin.default-operator-name",
  "kidindin.home-floor-grouping-state.v1",
  "kidindin.backup-history.v1",
]);
const SAFE_LOCAL_STORAGE_PREFIXES = [
  "kidindin.auto-refresh-at:",
  "kidindin.pending-log-retries:",
  "kidindin.employee-badge.v1:",
] as const;
const EXCLUDED_LOCAL_STORAGE_KEYS = new Set([
  "kidindin.auto-login-history-id",
]);
const MAX_DATABASE_NAME_LENGTH = 200;
const MAX_STORE_NAME_LENGTH = 200;
const MAX_RECORDS_PER_STORE = 200_000;
const MAX_LOCAL_STORAGE_ENTRIES = 2_000;
const MAX_LOCAL_STORAGE_VALUE_CHARACTERS = 8 * 1024 * 1024;
const MAX_ENCODED_VALUE_DEPTH = 64;
const MAX_ENCODED_VALUE_NODES = 1_000_000;
const MAX_ENCODED_TEXT_CHARACTERS = 24 * 1024 * 1024;
const MAX_SINGLE_BINARY_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BINARY_BYTES = 48 * 1024 * 1024;
const NATIVE_DATABASE_NAME = "kidindin_work_order_index.db";
const NATIVE_DATABASE_VERSION = 2;
const MAX_NATIVE_BACKUP_CHARACTERS = 64 * 1024 * 1024;
const MAX_NATIVE_ROWS_PER_TABLE = 200_000;

type ValueBudget = {
  binaryBytes: number;
  nodes: number;
  textCharacters: number;
};

type AccountHint = {
  accountKey: string;
  current: boolean;
  label: string;
};

type EncodedValue =
  | { type: "null" }
  | { type: "undefined" }
  | { type: "boolean"; value: boolean }
  | { type: "string"; value: string }
  | { type: "number"; value: number | "NaN" | "Infinity" | "-Infinity" }
  | { type: "bigint"; value: string }
  | { type: "date"; value: string }
  | { type: "regexp"; source: string; flags: string }
  | { type: "array"; value: EncodedValue[] }
  | { type: "object"; value: Array<[string, EncodedValue]> }
  | { type: "map"; value: Array<[EncodedValue, EncodedValue]> }
  | { type: "set"; value: EncodedValue[] }
  | { type: "array-buffer"; base64: string }
  | { type: "typed-array"; constructor: string; base64: string }
  | { type: "data-view"; base64: string }
  | {
      type: "blob" | "file";
      base64: string;
      mimeType: string;
      name?: string;
      lastModified?: number;
    };

type IndexedDbIndexBackup = {
  keyPath: string | string[];
  multiEntry: boolean;
  name: string;
  unique: boolean;
};

type IndexedDbRecordBackup = {
  key: EncodedValue;
  value: EncodedValue;
};

type IndexedDbStoreBackup = {
  autoIncrement: boolean;
  indexes: IndexedDbIndexBackup[];
  keyPath: string | string[] | null;
  name: string;
  records: IndexedDbRecordBackup[];
};

type IndexedDbDatabaseBackup = {
  name: string;
  stores: IndexedDbStoreBackup[];
  version: number;
};

type RegisteredDatabaseSchema = {
  stores: Array<Omit<IndexedDbStoreBackup, "records">>;
  version: number;
};

const DATABASE_SCHEMAS: Record<string, RegisteredDatabaseSchema> = {
  "kidindin-local-work-orders": {
    version: 1,
    stores: [{
      autoIncrement: false,
      indexes: [{ keyPath: "accountKey", multiEntry: false, name: "accountKey", unique: false }],
      keyPath: "key",
      name: "workOrderMeta",
    }],
  },
  "kidindin-signatures": {
    version: 1,
    stores: [{
      autoIncrement: false,
      indexes: [{ keyPath: "accountKey", multiEntry: false, name: "accountKey", unique: false }],
      keyPath: "key",
      name: "signatures",
    }],
  },
  "kidindin-unreachable-prefills": {
    version: 1,
    stores: [{
      autoIncrement: false,
      indexes: [{ keyPath: "accountKey", multiEntry: false, name: "accountKey", unique: false }],
      keyPath: "key",
      name: "storefrontPhotos",
    }],
  },
  "kidindin-upload-file-names": {
    version: 1,
    stores: [{
      autoIncrement: false,
      indexes: [{ keyPath: "generatedAt", multiEntry: false, name: "generatedAt", unique: false }],
      keyPath: "name",
      name: "usedUploadFileNames",
    }],
  },
};

type DecodedStoreBackup = Omit<IndexedDbStoreBackup, "records"> & {
  records: Array<{ key: IDBValidKey; value: unknown }>;
};

type DecodedDatabaseBackup = Omit<IndexedDbDatabaseBackup, "stores"> & {
  stores: DecodedStoreBackup[];
};

type FullBackupData = {
  accountHints?: AccountHint[];
  indexedDatabases: IndexedDbDatabaseBackup[];
  localStorage: Array<{ key: string; value: string }>;
  nativeSqlite: unknown | null;
};

export type FullBackupDocument = {
  data: FullBackupData;
  exportedAt: string;
  integrity: {
    algorithm: "SHA-256";
    sha256: string;
  };
  kind: typeof FULL_BACKUP_KIND;
  security: {
    authenticationCredentialsIncluded: false;
    note: string;
  };
  source: {
    runtime: "native" | "web";
    userAgent: string;
  };
  version: typeof FULL_BACKUP_VERSION;
};

export type FullBackupSummary = {
  databaseCount: number;
  indexedDbRecordCount: number;
  localStorageEntryCount: number;
  nativeSqliteRecordCount: number;
  nativeSqliteSupported: boolean;
};

export type FullBackupInspection = FullBackupSummary & {
  accountKeys: string[];
  historyAccountKeys: string[];
  nativeSqliteCanRestore: boolean;
  nativeSqlitePresent: boolean;
  sourceAccountKey: string | null;
  sourceAccountLabel: string | null;
};

export type FullBackupExport = {
  document: FullBackupDocument;
  fileName: string;
  json: string;
  summary: FullBackupSummary;
};

export type FullBackupRestoreResult = FullBackupSummary & {
  nativeSqlite: NativeDatabaseImportResult | null;
};

export type FullBackupCreateOptions = {
  activeAccountKey?: string | null;
  activeAccountLabel?: string | null;
};

export type FullBackupRestoreOptions = {
  accountKeyMapping?: Record<string, string>;
};

export type SavedBackupFile = {
  destination: string;
  fileName: string;
  method: "browser" | "native";
  size: number;
};

type DatabaseInfoFactory = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string; version?: number }>>;
};

function detail(error: unknown) {
  return error instanceof Error && error.message ? `：${error.message}` : "";
}

function backupError(action: string, error: unknown) {
  return new Error(`${action}失败${detail(error)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, location: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${location} 必须是${allowEmpty ? "字符串" : "非空字符串"}`);
  }
  return value;
}

function requireInteger(value: unknown, location: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${location} 必须是大于等于 ${minimum} 的整数`);
  }
  return value;
}

function emptyValueBudget(): ValueBudget {
  return { binaryBytes: 0, nodes: 0, textCharacters: 0 };
}

function consumeNode(budget: ValueBudget, location: string, depth: number) {
  if (depth > MAX_ENCODED_VALUE_DEPTH) {
    throw new Error(`${location} 的嵌套深度超过 ${MAX_ENCODED_VALUE_DEPTH} 层安全上限`);
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_ENCODED_VALUE_NODES) {
    throw new Error(`WebDB 编码值超过 ${MAX_ENCODED_VALUE_NODES} 个节点安全上限`);
  }
}

function consumeText(budget: ValueBudget, value: string, location: string) {
  budget.textCharacters += value.length;
  if (budget.textCharacters > MAX_ENCODED_TEXT_CHARACTERS) {
    throw new Error(`${location} 使 WebDB 文本总量超过 24MB 安全上限`);
  }
}

function consumeBinary(budget: ValueBudget, size: number, location: string) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SINGLE_BINARY_BYTES) {
    throw new Error(`${location} 超过单个二进制对象 24MB 安全上限`);
  }
  budget.binaryBytes += size;
  if (budget.binaryBytes > MAX_TOTAL_BINARY_BYTES) {
    throw new Error("WebDB 图片、签字和二进制数据总量超过 48MB 安全上限");
  }
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function assertBackupPayloadSize(payload: string) {
  if (payload.length > MAX_FULL_BACKUP_FILE_BYTES) {
    throw new Error("完整备份超过 96MB 安全上限");
  }
  const size = utf8Size(payload);
  if (size > MAX_FULL_BACKUP_FILE_BYTES) {
    throw new Error("完整备份超过 96MB 安全上限");
  }
  return size;
}

function shouldIncludeLocalStorageKey(key: string) {
  return SAFE_LOCAL_STORAGE_KEYS.has(key) ||
    SAFE_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function shouldIncludeDatabase(name: string) {
  return SAFE_DATABASE_NAMES.has(name);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodedBase64Size(value: string, location: string) {
  const maximumEncodedLength = Math.ceil(MAX_SINGLE_BINARY_BYTES / 3) * 4;
  if (value.length > maximumEncodedLength) {
    throw new Error(`${location} 超过单个二进制对象 Base64 安全上限`);
  }
  if (value.length % 4 === 1 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${location} 不是标准 Base64`);
  }
  if (!value.length) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function base64ToBytes(value: string, location: string, budget: ValueBudget) {
  consumeBinary(budget, decodedBase64Size(value, location), location);
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    throw backupError(`${location} Base64 解码`, error);
  }
}

async function encodeValue(
  value: unknown,
  location: string,
  budget: ValueBudget,
  ancestors = new WeakSet<object>(),
  depth = 0,
): Promise<EncodedValue> {
  consumeNode(budget, location, depth);
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "undefined" };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "string") {
    consumeText(budget, value, location);
    return { type: "string", value };
  }
  if (typeof value === "bigint") {
    const encoded = value.toString();
    consumeText(budget, encoded, location);
    return { type: "bigint", value: encoded };
  }
  if (typeof value === "number") {
    const encoded = Number.isNaN(value)
      ? "NaN"
      : value === Infinity
        ? "Infinity"
        : value === -Infinity
          ? "-Infinity"
          : value;
    return { type: "number", value: encoded };
  }
  if (typeof value !== "object") {
    throw new Error(`${location} 包含 IndexedDB 备份不支持的 ${typeof value} 值`);
  }
  if (ancestors.has(value)) throw new Error(`${location} 包含循环引用，无法写入 JSON 备份`);

  if (typeof File !== "undefined" && value instanceof File) {
    consumeBinary(budget, value.size, location);
    consumeText(budget, value.name, `${location}.name`);
    consumeText(budget, value.type, `${location}.mimeType`);
    return {
      type: "file",
      base64: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      mimeType: value.type,
      name: value.name,
      lastModified: value.lastModified,
    };
  }
  if (value instanceof Blob) {
    consumeBinary(budget, value.size, location);
    consumeText(budget, value.type, `${location}.mimeType`);
    return {
      type: "blob",
      base64: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      mimeType: value.type,
    };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${location} 包含无效日期`);
    return { type: "date", value: value.toISOString() };
  }
  if (value instanceof RegExp) {
    consumeText(budget, value.source, `${location}.source`);
    consumeText(budget, value.flags, `${location}.flags`);
    return { type: "regexp", source: value.source, flags: value.flags };
  }
  if (value instanceof ArrayBuffer) {
    consumeBinary(budget, value.byteLength, location);
    return { type: "array-buffer", base64: bytesToBase64(new Uint8Array(value)) };
  }
  if (value instanceof DataView) {
    consumeBinary(budget, value.byteLength, location);
    return {
      type: "data-view",
      base64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  if (ArrayBuffer.isView(value)) {
    consumeBinary(budget, value.byteLength, location);
    return {
      type: "typed-array",
      constructor: value.constructor.name,
      base64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return {
        type: "array",
        value: await Promise.all(
          value.map((item, index) => encodeValue(item, `${location}[${index}]`, budget, ancestors, depth + 1)),
        ),
      };
    }
    if (value instanceof Map) {
      const entries: Array<[EncodedValue, EncodedValue]> = [];
      let index = 0;
      for (const [key, item] of value) {
        entries.push([
          await encodeValue(key, `${location}.mapKey[${index}]`, budget, ancestors, depth + 1),
          await encodeValue(item, `${location}.mapValue[${index}]`, budget, ancestors, depth + 1),
        ]);
        index += 1;
      }
      return { type: "map", value: entries };
    }
    if (value instanceof Set) {
      const entries: EncodedValue[] = [];
      let index = 0;
      for (const item of value) {
        entries.push(await encodeValue(item, `${location}.set[${index}]`, budget, ancestors, depth + 1));
        index += 1;
      }
      return { type: "set", value: entries };
    }

    const entries: Array<[string, EncodedValue]> = [];
    for (const key of Object.keys(value)) {
      consumeText(budget, key, `${location} 属性名`);
      entries.push([
        key,
        await encodeValue(
          (value as Record<string, unknown>)[key],
          `${location}.${key}`,
          budget,
          ancestors,
          depth + 1,
        ),
      ]);
    }
    return { type: "object", value: entries };
  } finally {
    ancestors.delete(value);
  }
}

const typedArrayConstructors: Record<
  string,
  new (buffer: ArrayBuffer) => ArrayBufferView
> = {
  BigInt64Array,
  BigUint64Array,
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
};

function decodeValue(
  value: unknown,
  location: string,
  budget: ValueBudget,
  depth = 0,
): unknown {
  consumeNode(budget, location, depth);
  if (!isRecord(value)) throw new Error(`${location} 的编码值必须是对象`);
  const type = requireString(value.type, `${location}.type`);
  switch (type) {
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "boolean":
      if (typeof value.value !== "boolean") throw new Error(`${location}.value 必须是布尔值`);
      return value.value;
    case "string": {
      const result = requireString(value.value, `${location}.value`, true);
      consumeText(budget, result, location);
      return result;
    }
    case "number": {
      if (typeof value.value === "number") return value.value;
      if (value.value === "NaN") return Number.NaN;
      if (value.value === "Infinity") return Infinity;
      if (value.value === "-Infinity") return -Infinity;
      throw new Error(`${location}.value 不是有效数字`);
    }
    case "bigint": {
      const raw = requireString(value.value, `${location}.value`);
      consumeText(budget, raw, location);
      try {
        return BigInt(raw);
      } catch (error) {
        throw backupError(`${location} 大整数解码`, error);
      }
    }
    case "date": {
      const date = new Date(requireString(value.value, `${location}.value`));
      if (Number.isNaN(date.getTime())) throw new Error(`${location}.value 不是有效日期`);
      return date;
    }
    case "regexp":
      return new RegExp(
        requireString(value.source, `${location}.source`, true),
        requireString(value.flags, `${location}.flags`, true),
      );
    case "array":
      if (!Array.isArray(value.value)) throw new Error(`${location}.value 必须是数组`);
      return value.value.map((item, index) => decodeValue(item, `${location}[${index}]`, budget, depth + 1));
    case "object": {
      if (!Array.isArray(value.value)) throw new Error(`${location}.value 必须是键值数组`);
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      value.value.forEach((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new Error(`${location}.value[${index}] 必须是二元键值数组`);
        }
        const key = requireString(entry[0], `${location}.value[${index}][0]`, true);
        consumeText(budget, key, `${location} 属性名`);
        if (Object.prototype.hasOwnProperty.call(result, key)) {
          throw new Error(`${location} 包含重复属性 ${key}`);
        }
        result[key] = decodeValue(entry[1], `${location}.${key}`, budget, depth + 1);
      });
      return result;
    }
    case "map": {
      if (!Array.isArray(value.value)) throw new Error(`${location}.value 必须是键值数组`);
      return new Map(value.value.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new Error(`${location}.value[${index}] 必须是二元键值数组`);
        }
        return [
          decodeValue(entry[0], `${location}.mapKey[${index}]`, budget, depth + 1),
          decodeValue(entry[1], `${location}.mapValue[${index}]`, budget, depth + 1),
        ];
      }));
    }
    case "set":
      if (!Array.isArray(value.value)) throw new Error(`${location}.value 必须是数组`);
      return new Set(value.value.map((item, index) => decodeValue(item, `${location}.set[${index}]`, budget, depth + 1)));
    case "array-buffer":
      return base64ToBytes(requireString(value.base64, `${location}.base64`, true), location, budget).buffer;
    case "typed-array": {
      const constructorName = requireString(value.constructor, `${location}.constructor`);
      const Constructor = typedArrayConstructors[constructorName];
      if (!Constructor) throw new Error(`${location} 使用了不支持的 TypedArray：${constructorName}`);
      const bytes = base64ToBytes(requireString(value.base64, `${location}.base64`, true), location, budget);
      try {
        return new Constructor(bytes.buffer);
      } catch (error) {
        throw backupError(`${location} TypedArray 解码`, error);
      }
    }
    case "data-view": {
      const bytes = base64ToBytes(requireString(value.base64, `${location}.base64`, true), location, budget);
      return new DataView(bytes.buffer);
    }
    case "blob": {
      const bytes = base64ToBytes(requireString(value.base64, `${location}.base64`, true), location, budget);
      return new Blob([bytes], {
        type: requireString(value.mimeType, `${location}.mimeType`, true),
      });
    }
    case "file": {
      const bytes = base64ToBytes(requireString(value.base64, `${location}.base64`, true), location, budget);
      const mimeType = requireString(value.mimeType, `${location}.mimeType`, true);
      const name = requireString(value.name, `${location}.name`);
      const lastModified = requireInteger(value.lastModified, `${location}.lastModified`);
      return typeof File === "undefined"
        ? new Blob([bytes], { type: mimeType })
        : new File([bytes], name, { type: mimeType, lastModified });
    }
    default:
      throw new Error(`${location} 使用了不支持的编码类型：${type}`);
  }
}

function isValidIndexedDbKey(value: unknown): value is IDBValidKey {
  if (typeof value === "string") return true;
  if (typeof value === "number") return !Number.isNaN(value);
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  return Array.isArray(value) && value.every(isValidIndexedDbKey);
}

function requestResult<T>(request: IDBRequest<T>, action: string) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(backupError(action, request.error));
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
      reject(backupError(action, transaction.error));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(backupError(action, transaction.error));
    };
  });
}

function openExistingDatabase(name: string) {
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    let missing = false;
    let settled = false;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      if (missing && request.error?.name === "AbortError") resolve(null);
      else reject(backupError(`打开 Web 数据库 ${name}`, request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`Web 数据库 ${name} 被其他页面占用，请关闭其他 KiDinDin 页面后重试`));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function databaseNames() {
  if (typeof indexedDB === "undefined") throw new Error("当前环境不支持 IndexedDB");
  const names = new Set<string>();
  const list = (indexedDB as DatabaseInfoFactory).databases;
  if (typeof list === "function") {
    const databases = await list.call(indexedDB).catch((error) => {
      throw backupError("枚举 Web 数据库", error);
    });
    databases.forEach((database) => {
      if (typeof database.name === "string" && database.name.trim()) names.add(database.name);
    });
    const unregistered = Array.from(names).filter(
      (name) =>
        /^kidindin[.-]/i.test(name) &&
        !SAFE_DATABASE_NAMES.has(name) &&
        !TRANSIENT_BACKUP_DATABASE_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
    if (unregistered.length) {
      throw new Error(
        `发现尚未登记的数据数据库：${unregistered.join("、")}。为避免生成遗漏数据的“完整备份”，已停止导出。`,
      );
    }
  } else {
    KNOWN_DATABASE_NAMES.forEach((name) => names.add(name));
  }
  return Array.from(names).filter(shouldIncludeDatabase).sort();
}

function assertDatabaseSchema(snapshot: IndexedDbDatabaseBackup, location: string) {
  const registered = DATABASE_SCHEMAS[snapshot.name];
  if (!registered) throw new Error(`${location}.name 不是当前版本登记的 KiDinDin WebDB`);
  if (snapshot.version !== registered.version) {
    throw new Error(
      `${location}.version 为 ${snapshot.version}，当前仅支持 ${registered.version}；请使用匹配版本的应用恢复`,
    );
  }
  if (snapshot.stores.length !== registered.stores.length) {
    throw new Error(`${location}.stores 与当前数据库结构不一致`);
  }
  for (const expectedStore of registered.stores) {
    const actualStore = snapshot.stores.find((store) => store.name === expectedStore.name);
    if (!actualStore) throw new Error(`${location} 缺少数据表 ${expectedStore.name}`);
    if (
      actualStore.autoIncrement !== expectedStore.autoIncrement ||
      !sameKeyPath(actualStore.keyPath, expectedStore.keyPath)
    ) {
      throw new Error(`${location}.${expectedStore.name} 的主键结构与当前版本不兼容`);
    }
    if (actualStore.indexes.length !== expectedStore.indexes.length) {
      throw new Error(`${location}.${expectedStore.name} 的索引数量与当前版本不一致`);
    }
    for (const expectedIndex of expectedStore.indexes) {
      const actualIndex = actualStore.indexes.find((index) => index.name === expectedIndex.name);
      if (
        !actualIndex ||
        !sameKeyPath(actualIndex.keyPath, expectedIndex.keyPath) ||
        actualIndex.multiEntry !== expectedIndex.multiEntry ||
        actualIndex.unique !== expectedIndex.unique
      ) {
        throw new Error(`${location}.${expectedStore.name}.${expectedIndex.name} 索引结构不兼容`);
      }
    }
  }
}

async function exportDatabase(
  database: IDBDatabase,
  budget: ValueBudget,
): Promise<IndexedDbDatabaseBackup> {
  const storeNames = Array.from(database.objectStoreNames);
  if (!storeNames.length) return { name: database.name, stores: [], version: database.version };

  const transaction = database.transaction(storeNames, "readonly");
  const done = transactionDone(transaction, `读取 Web 数据库 ${database.name}`);
  const storeReads = storeNames.map(async (storeName) => {
    const store = transaction.objectStore(storeName);
    const schema: Omit<IndexedDbStoreBackup, "records"> = {
      autoIncrement: store.autoIncrement,
      indexes: Array.from(store.indexNames).map((indexName) => {
        const index = store.index(indexName);
        return {
          keyPath: index.keyPath,
          multiEntry: index.multiEntry,
          name: index.name,
          unique: index.unique,
        };
      }),
      keyPath: store.keyPath,
      name: store.name,
    };
    const [keys, values] = await Promise.all([
      requestResult<IDBValidKey[]>(store.getAllKeys(), `读取 ${database.name}.${storeName} 主键`),
      requestResult<unknown[]>(store.getAll(), `读取 ${database.name}.${storeName} 数据`),
    ]);
    if (keys.length !== values.length) {
      throw new Error(`${database.name}.${storeName} 的主键数量与记录数量不一致`);
    }
    if (keys.length > MAX_RECORDS_PER_STORE) {
      throw new Error(`${database.name}.${storeName} 超过 ${MAX_RECORDS_PER_STORE} 条备份上限`);
    }
    return { schema, keys, values };
  });
  const rawStores = await Promise.all(storeReads);
  await done;

  const stores: IndexedDbStoreBackup[] = [];
  for (const { schema, keys, values } of rawStores) {
    const records: IndexedDbRecordBackup[] = [];
    for (let index = 0; index < values.length; index += 1) {
      validateDecodedRecord(
        database.name,
        keys[index],
        values[index],
        `${database.name}.${schema.name}[${index}]`,
      );
      records.push({
        key: await encodeValue(keys[index], `${database.name}.${schema.name}[${index}].key`, budget),
        value: await encodeValue(values[index], `${database.name}.${schema.name}[${index}].value`, budget),
      });
    }
    stores.push({ ...schema, records });
  }
  const snapshot = { name: database.name, stores, version: database.version };
  assertDatabaseSchema(snapshot, `Web 数据库 ${database.name}`);
  return snapshot;
}

async function exportIndexedDatabases() {
  const backups: IndexedDbDatabaseBackup[] = [];
  const budget = emptyValueBudget();
  for (const name of await databaseNames()) {
    const database = await openExistingDatabase(name);
    if (!database) continue;
    try {
      backups.push(await exportDatabase(database, budget));
    } finally {
      database.close();
    }
  }
  return backups;
}

function exportLocalStorage() {
  const entries: Array<{ key: string; value: string }> = [];
  const unregistered: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (!shouldIncludeLocalStorageKey(key)) {
      if (key.startsWith("kidindin.") && !EXCLUDED_LOCAL_STORAGE_KEYS.has(key)) {
        unregistered.push(key);
      }
      continue;
    }
    const value = localStorage.getItem(key) ?? "";
    if (value.length > MAX_LOCAL_STORAGE_VALUE_CHARACTERS) {
      throw new Error(`应用偏好 ${key} 超过 8MB 安全上限`);
    }
    validateLocalStorageValue(key, value, `localStorage.${key}`);
    entries.push({ key, value });
  }
  if (entries.length > MAX_LOCAL_STORAGE_ENTRIES) {
    throw new Error(`应用偏好超过 ${MAX_LOCAL_STORAGE_ENTRIES} 项安全上限`);
  }
  if (unregistered.length) {
    throw new Error(
      `发现尚未登记的应用偏好：${unregistered.sort().join("、")}。为避免生成遗漏数据的“完整备份”，已停止导出。`,
    );
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

type PendingLogRetryBackup = {
  createdAt: string;
  woHeaderId: string;
  woNumber: string;
};

function parsePendingLogRetries(value: string, location: string): PendingLogRetryBackup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw backupError(`解析 ${location}`, error);
  }
  if (!Array.isArray(parsed)) throw new Error(`${location} 必须是数组`);
  if (parsed.length > 50_000) throw new Error(`${location} 不能超过 50000 条`);
  const seen = new Set<string>();
  return parsed.map((item, index) => {
    const itemLocation = `${location}[${index}]`;
    if (!isRecord(item)) throw new Error(`${itemLocation} 必须是对象`);
    const woHeaderId = requireString(item.woHeaderId, `${itemLocation}.woHeaderId`);
    if (woHeaderId.length > 512) throw new Error(`${itemLocation}.woHeaderId 超过 512 字符`);
    if (seen.has(woHeaderId)) throw new Error(`${location} 包含重复工单 ${woHeaderId}`);
    seen.add(woHeaderId);
    const createdAt = requireString(item.createdAt, `${itemLocation}.createdAt`, true);
    if (createdAt && Number.isNaN(Date.parse(createdAt))) {
      throw new Error(`${itemLocation}.createdAt 不是有效时间`);
    }
    const woNumber = requireString(item.woNumber, `${itemLocation}.woNumber`, true);
    if (woNumber.length > 512) throw new Error(`${itemLocation}.woNumber 超过 512 字符`);
    return {
      createdAt,
      woHeaderId,
      woNumber,
    };
  });
}

function parseFloorGrouping(value: string, location: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw backupError(`解析 ${location}`, error);
  }
  if (!isRecord(parsed)) throw new Error(`${location} 必须是对象`);
  if (Object.keys(parsed).length > 50_000) throw new Error(`${location} 不能超过 50000 个分组范围`);
  const result = Object.create(null) as Record<string, string[]>;
  let totalGroups = 0;
  for (const [key, groups] of Object.entries(parsed)) {
    if (!key || key.length > 2_048) throw new Error(`${location} 包含无效或过长的分组范围`);
    if (!Array.isArray(groups) || !groups.every((group) => typeof group === "string")) {
      throw new Error(`${location}.${key} 必须是字符串数组`);
    }
    if (groups.some((group) => group.length > 2_048)) {
      throw new Error(`${location}.${key} 包含超过 2048 字符的分组名称`);
    }
    totalGroups += groups.length;
    if (totalGroups > 200_000) throw new Error(`${location} 的分组项超过 200000 条`);
    result[key] = Array.from(new Set(groups)).sort();
  }
  return result;
}

function validateLocalStorageValue(key: string, value: string, location: string) {
  const scopedPrefix = SAFE_LOCAL_STORAGE_PREFIXES.find((prefix) => key.startsWith(prefix));
  if (scopedPrefix) {
    const accountKey = key.slice(scopedPrefix.length);
    if (!accountKey.trim() || accountKey.length > 512) {
      throw new Error(`${location} 的账号范围无效`);
    }
  }
  if (key.startsWith("kidindin.pending-log-retries:")) {
    parsePendingLogRetries(value, location);
    return;
  }
  if (key === "kidindin.home-floor-grouping-state.v1") {
    parseFloorGrouping(value, location);
    return;
  }
  if (key.startsWith("kidindin.auto-refresh-at:")) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`${location} 不是有效时间戳`);
    return;
  }
  if (key.startsWith("kidindin.employee-badge.v1:")) {
    if (!value.trim() || value.length > 4_096) {
      throw new Error(`${location} 的工牌绑定内容无效或过长`);
    }
    return;
  }
  if (
    key === "kidindin.appearance-settings.v3" ||
    key === "kidindin.theme-settings.v2" ||
    key === "kidindin.app-settings.v1"
  ) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isRecord(parsed)) throw new Error("设置顶层必须是对象");
    } catch (error) {
      throw backupError(`解析 ${location}`, error);
    }
  }
}

function mergeLocalStorageValues(key: string, current: string | null, incoming: string) {
  if (current === null) return incoming;
  if (key.startsWith("kidindin.pending-log-retries:")) {
    const merged = new Map<string, PendingLogRetryBackup>();
    for (const item of parsePendingLogRetries(current, `${key} 当前值`)) merged.set(item.woHeaderId, item);
    for (const item of parsePendingLogRetries(incoming, `${key} 备份值`)) {
      const previous = merged.get(item.woHeaderId);
      if (!previous || Date.parse(item.createdAt || "1970-01-01") > Date.parse(previous.createdAt || "1970-01-01")) {
        merged.set(item.woHeaderId, item);
      }
    }
    return JSON.stringify(Array.from(merged.values()));
  }
  if (key === "kidindin.home-floor-grouping-state.v1") {
    const currentGroups = parseFloorGrouping(current, `${key} 当前值`);
    const incomingGroups = parseFloorGrouping(incoming, `${key} 备份值`);
    for (const [scope, groups] of Object.entries(incomingGroups)) {
      currentGroups[scope] = Array.from(new Set([...(currentGroups[scope] ?? []), ...groups])).sort();
    }
    return JSON.stringify(currentGroups);
  }
  if (key.startsWith("kidindin.auto-refresh-at:")) {
    return String(Math.max(Number(current) || 0, Number(incoming) || 0));
  }
  return incoming;
}

function stableJson(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): string {
  if (depth > MAX_ENCODED_VALUE_DEPTH + 12) {
    throw new Error("备份 JSON 嵌套过深，无法安全计算完整性摘要");
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_ENCODED_VALUE_NODES * 3) {
    throw new Error("备份 JSON 节点过多，无法安全计算完整性摘要");
  }
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("备份包含无法写入 JSON 的值");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item, depth + 1, budget)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], depth + 1, budget)}`)
    .join(",")}}`;
}

async function sha256(value: unknown) {
  if (!crypto.subtle) throw new Error("当前环境不支持备份完整性校验");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes: Uint8Array) {
  if (!crypto.subtle) throw new Error("当前环境不支持文件落盘校验");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function summaryOf(data: FullBackupData, nativeSqliteSupported: boolean): FullBackupSummary {
  const indexedDbRecordCount = data.indexedDatabases.reduce(
    (databaseTotal, database) => databaseTotal + database.stores.reduce(
      (storeTotal, store) => storeTotal + store.records.length,
      0,
    ),
    0,
  );
  const nativeBackup = isRecord(data.nativeSqlite) ? data.nativeSqlite : null;
  const nativeTables = nativeBackup && isRecord(nativeBackup.tables) ? nativeBackup.tables : null;
  const nativeSqliteRecordCount = nativeTables
    ? Object.values(nativeTables).reduce<number>(
        (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
        0,
      )
    : 0;
  return {
    databaseCount: data.indexedDatabases.length,
    indexedDbRecordCount,
    localStorageEntryCount: data.localStorage.length,
    nativeSqliteRecordCount,
    nativeSqliteSupported,
  };
}

export async function createFullBackup(
  options: FullBackupCreateOptions = {},
): Promise<FullBackupExport> {
  const [indexedDatabases, nativeResult] = await Promise.all([
    exportIndexedDatabases(),
    exportNativeDatabaseBackup(),
  ]);
  let nativeSqlite: unknown | null = null;
  if (nativeResult.supported) {
    if (!isRecord(nativeResult.backup)) {
      throw new Error("Android SQLite 导出返回 supported=true，但缺少备份内容");
    }
    nativeSqlite = parseNativeSqliteBackup(nativeResult.backup);
    if (nativeResult.databaseName !== NATIVE_DATABASE_NAME) {
      throw new Error("Android SQLite 导出返回了不匹配的数据库名称");
    }
    const nativeTables = (nativeSqlite as Record<string, unknown>).tables as Record<string, unknown>;
    const exportedWorkOrders = (nativeTables.workOrderIndex as unknown[]).length;
    const exportedPrefills = (nativeTables.residentSecurityPrefillHistory as unknown[]).length;
    if (
      nativeResult.workOrderCount !== exportedWorkOrders ||
      nativeResult.prefillHistoryCount !== exportedPrefills
    ) {
      throw new Error("Android SQLite 导出计数与备份内容不一致");
    }
  }
  const activeAccountKey = options.activeAccountKey?.trim() ?? "";
  if (activeAccountKey.length > 512) throw new Error("当前账号标识超过 512 字符，无法备份");
  const activeAccountLabel = options.activeAccountLabel?.trim() ?? "";
  if (activeAccountLabel.length > 512) throw new Error("当前账号名称超过 512 字符，无法备份");
  const data: FullBackupData = {
    accountHints: activeAccountKey
      ? [{ accountKey: activeAccountKey, current: true, label: activeAccountLabel }]
      : [],
    indexedDatabases,
    localStorage: exportLocalStorage(),
    nativeSqlite,
  };
  const exportedAt = new Date().toISOString();
  const document: FullBackupDocument = {
    data,
    exportedAt,
    integrity: { algorithm: "SHA-256", sha256: await sha256(data) },
    kind: FULL_BACKUP_KIND,
    security: {
      authenticationCredentialsIncluded: false,
      note: "不包含 Token、Cookie、请求 Sign、密码、原生登录会话或临时缓存；本地签字和工单图片属于用户数据，会包含在 WebDB 备份中。",
    },
    source: {
      runtime: isNativeRuntime() ? "native" : "web",
      userAgent: navigator.userAgent,
    },
    version: FULL_BACKUP_VERSION,
  };
  const timestamp = exportedAt.replace(/[:T]/g, "-").slice(0, 19);
  const json = JSON.stringify(document);
  assertBackupPayloadSize(json);
  return {
    document,
    fileName: `kidindin-full-backup-${timestamp}.json`,
    json,
    summary: summaryOf(data, nativeResult.supported),
  };
}

function parseKeyPath(value: unknown, location: string, nullable: boolean) {
  if (nullable && value === null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  throw new Error(`${location} 必须是字符串${nullable ? "、字符串数组或 null" : "或字符串数组"}`);
}

function parseDatabaseBackup(value: unknown, location: string): IndexedDbDatabaseBackup {
  if (!isRecord(value)) throw new Error(`${location} 必须是对象`);
  const name = requireString(value.name, `${location}.name`);
  if (name.length > MAX_DATABASE_NAME_LENGTH) throw new Error(`${location}.name 过长`);
  if (!shouldIncludeDatabase(name)) throw new Error(`${location}.name 指向凭据数据库，已拒绝导入`);
  const version = requireInteger(value.version, `${location}.version`, 1);
  if (!Array.isArray(value.stores)) throw new Error(`${location}.stores 必须是数组`);
  const storeNames = new Set<string>();
  const stores = value.stores.map((storeValue, storeIndex): IndexedDbStoreBackup => {
    const storeLocation = `${location}.stores[${storeIndex}]`;
    if (!isRecord(storeValue)) throw new Error(`${storeLocation} 必须是对象`);
    const storeName = requireString(storeValue.name, `${storeLocation}.name`);
    if (storeName.length > MAX_STORE_NAME_LENGTH) throw new Error(`${storeLocation}.name 过长`);
    if (storeNames.has(storeName)) throw new Error(`${location} 包含重复数据表 ${storeName}`);
    storeNames.add(storeName);
    if (typeof storeValue.autoIncrement !== "boolean") {
      throw new Error(`${storeLocation}.autoIncrement 必须是布尔值`);
    }
    if (!Array.isArray(storeValue.indexes)) throw new Error(`${storeLocation}.indexes 必须是数组`);
    const indexNames = new Set<string>();
    const indexes = storeValue.indexes.map((indexValue, indexIndex): IndexedDbIndexBackup => {
      const indexLocation = `${storeLocation}.indexes[${indexIndex}]`;
      if (!isRecord(indexValue)) throw new Error(`${indexLocation} 必须是对象`);
      const indexName = requireString(indexValue.name, `${indexLocation}.name`);
      if (indexNames.has(indexName)) throw new Error(`${storeLocation} 包含重复索引 ${indexName}`);
      indexNames.add(indexName);
      if (typeof indexValue.multiEntry !== "boolean" || typeof indexValue.unique !== "boolean") {
        throw new Error(`${indexLocation} 的索引选项无效`);
      }
      return {
        keyPath: parseKeyPath(indexValue.keyPath, `${indexLocation}.keyPath`, false) as string | string[],
        multiEntry: indexValue.multiEntry,
        name: indexName,
        unique: indexValue.unique,
      };
    });
    if (!Array.isArray(storeValue.records)) throw new Error(`${storeLocation}.records 必须是数组`);
    if (storeValue.records.length > MAX_RECORDS_PER_STORE) {
      throw new Error(`${storeLocation}.records 不能超过 ${MAX_RECORDS_PER_STORE} 条`);
    }
    const recordKeys = new Set<string>();
    const records = storeValue.records.map((recordValue, recordIndex): IndexedDbRecordBackup => {
      if (!isRecord(recordValue) || !("key" in recordValue) || !("value" in recordValue)) {
        throw new Error(`${storeLocation}.records[${recordIndex}] 格式无效`);
      }
      const keySignature = stableJson(recordValue.key);
      if (recordKeys.has(keySignature)) {
        throw new Error(`${storeLocation}.records 包含重复主键`);
      }
      recordKeys.add(keySignature);
      return {
        key: recordValue.key as EncodedValue,
        value: recordValue.value as EncodedValue,
      };
    });
    return {
      autoIncrement: storeValue.autoIncrement,
      indexes,
      keyPath: parseKeyPath(storeValue.keyPath, `${storeLocation}.keyPath`, true),
      name: storeName,
      records,
    };
  });
  const snapshot = { name, stores, version };
  assertDatabaseSchema(snapshot, location);
  return snapshot;
}

function parseNativeSqliteBackup(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("data.nativeSqlite 必须是对象或 null");
  if (JSON.stringify(value).length > MAX_NATIVE_BACKUP_CHARACTERS) {
    throw new Error("data.nativeSqlite 超过 64MB 安全上限");
  }
  if (value.kind !== "kidindin-native-sqlite" || value.version !== 1) {
    throw new Error("data.nativeSqlite 不是受支持的 KiDinDin SQLite 备份");
  }
  if (value.databaseName !== NATIVE_DATABASE_NAME) {
    throw new Error("data.nativeSqlite.databaseName 与当前 SQLite 数据库不匹配");
  }
  const databaseVersion = requireInteger(value.databaseVersion, "data.nativeSqlite.databaseVersion", 1);
  if (databaseVersion > NATIVE_DATABASE_VERSION) {
    throw new Error(`SQLite 备份版本 ${databaseVersion} 高于当前支持版本 ${NATIVE_DATABASE_VERSION}`);
  }
  if (value.preferences !== undefined) {
    if (!isRecord(value.preferences)) throw new Error("data.nativeSqlite.preferences 必须是对象");
    if (typeof value.preferences.floating_overlay_enabled !== "boolean") {
      throw new Error("data.nativeSqlite.preferences.floating_overlay_enabled 必须是布尔值");
    }
  }
  if (!isRecord(value.tables)) throw new Error("data.nativeSqlite.tables 必须是对象");
  const workOrders = value.tables.workOrderIndex;
  const prefillHistory = value.tables.residentSecurityPrefillHistory;
  if (!Array.isArray(workOrders) || !Array.isArray(prefillHistory)) {
    throw new Error("data.nativeSqlite.tables 缺少两张 SQLite 数据表");
  }
  if (workOrders.length > MAX_NATIVE_ROWS_PER_TABLE || prefillHistory.length > MAX_NATIVE_ROWS_PER_TABLE) {
    throw new Error(`SQLite 单表记录不能超过 ${MAX_NATIVE_ROWS_PER_TABLE} 条`);
  }
  const boundedString = (
    row: Record<string, unknown>,
    field: string,
    location: string,
    maxLength: number,
    allowEmpty = true,
  ) => {
    const result = requireString(row[field], `${location}.${field}`, allowEmpty);
    if (result.length > maxLength) throw new Error(`${location}.${field} 超过 ${maxLength} 字符`);
    return result;
  };
  const workOrderKeys = new Set<string>();
  workOrders.forEach((row, index) => {
    const location = `data.nativeSqlite.tables.workOrderIndex[${index}]`;
    if (!isRecord(row)) throw new Error(`${location} 必须是对象`);
    const accountKey = boundedString(row, "accountKey", location, 512, false);
    const woHeaderId = boundedString(row, "woHeaderId", location, 512, false);
    const compositeKey = JSON.stringify([accountKey, woHeaderId]);
    if (workOrderKeys.has(compositeKey)) throw new Error(`${location} 的 SQLite 主键重复`);
    workOrderKeys.add(compositeKey);
    boundedString(row, "woNumber", location, 512);
    boundedString(row, "resident", location, 1_024);
    boundedString(row, "residentNormalized", location, 2_048);
    boundedString(row, "contactPhone", location, 128);
    boundedString(row, "address", location, 8_192);
    boundedString(row, "addressNormalized", location, 8_192);
    boundedString(row, "sourceDate", location, 64);
    boundedString(row, "rawJson", location, 2 * 1_024 * 1_024);
    if (typeof row.eligiblePrefill !== "boolean") throw new Error(`${location}.eligiblePrefill 必须是布尔值`);
    const firstSeenAt = requireInteger(row.firstSeenAt, `${location}.firstSeenAt`);
    const lastSeenAt = requireInteger(row.lastSeenAt, `${location}.lastSeenAt`);
    if (firstSeenAt > lastSeenAt) throw new Error(`${location}.firstSeenAt 不能晚于 lastSeenAt`);
  });
  const prefillKeys = new Set<string>();
  prefillHistory.forEach((row, index) => {
    const location = `data.nativeSqlite.tables.residentSecurityPrefillHistory[${index}]`;
    if (!isRecord(row)) throw new Error(`${location} 必须是对象`);
    const accountKey = boundedString(row, "accountKey", location, 512, false);
    const woHeaderId = boundedString(row, "woHeaderId", location, 512, false);
    const compositeKey = JSON.stringify([accountKey, woHeaderId]);
    if (prefillKeys.has(compositeKey)) throw new Error(`${location} 的 SQLite 主键重复`);
    prefillKeys.add(compositeKey);
    requireInteger(row.completedAt, `${location}.completedAt`);
    boundedString(row, "resultMessage", location, 16 * 1_024);
  });
  return value;
}

function parseAccountHints(value: unknown): AccountHint[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("data.accountHints 必须是数组");
  if (value.length > 100) throw new Error("data.accountHints 不能超过 100 项");
  const seen = new Set<string>();
  let currentCount = 0;
  const result = value.map((item, index) => {
    const location = `data.accountHints[${index}]`;
    if (!isRecord(item)) throw new Error(`${location} 必须是对象`);
    const accountKey = requireString(item.accountKey, `${location}.accountKey`);
    if (accountKey.length > 512) throw new Error(`${location}.accountKey 超过 512 字符`);
    if (seen.has(accountKey)) throw new Error(`data.accountHints 包含重复账号 ${accountKey}`);
    seen.add(accountKey);
    const label = requireString(item.label, `${location}.label`, true);
    if (label.length > 512) throw new Error(`${location}.label 超过 512 字符`);
    if (typeof item.current !== "boolean") throw new Error(`${location}.current 必须是布尔值`);
    if (item.current) currentCount += 1;
    return { accountKey, current: item.current, label };
  });
  if (currentCount > 1) throw new Error("data.accountHints 只能有一个当前账号");
  return result;
}

async function parseFullBackup(payload: string) {
  assertBackupPayloadSize(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw backupError("解析完整备份 JSON", error);
  }
  if (!isRecord(parsed)) throw new Error("完整备份顶层必须是对象");
  if (parsed.kind !== FULL_BACKUP_KIND) throw new Error("不是 KiDinDin 完整备份文件");
  if (parsed.version !== FULL_BACKUP_VERSION) {
    throw new Error(`不支持的完整备份版本：${String(parsed.version)}`);
  }
  if (!isRecord(parsed.data)) throw new Error("完整备份缺少 data");
  if (!Array.isArray(parsed.data.localStorage)) throw new Error("完整备份缺少 localStorage 数据");
  if (!Array.isArray(parsed.data.indexedDatabases)) throw new Error("完整备份缺少 indexedDatabases 数据");
  if (parsed.data.localStorage.length > MAX_LOCAL_STORAGE_ENTRIES) {
    throw new Error(`完整备份偏好不能超过 ${MAX_LOCAL_STORAGE_ENTRIES} 项`);
  }
  if (parsed.data.indexedDatabases.length > KNOWN_DATABASE_NAMES.length) {
    throw new Error("完整备份包含过多 WebDB");
  }
  const localKeys = new Set<string>();
  const localStorageEntries = parsed.data.localStorage.map((entry, index) => {
    const location = `data.localStorage[${index}]`;
    if (!isRecord(entry)) throw new Error(`${location} 必须是对象`);
    const key = requireString(entry.key, `${location}.key`);
    if (key.length > 2_048) throw new Error(`${location}.key 超过 2048 字符`);
    if (!shouldIncludeLocalStorageKey(key)) throw new Error(`${location}.key 不属于可恢复的安全应用偏好`);
    if (localKeys.has(key)) throw new Error(`完整备份包含重复偏好键：${key}`);
    localKeys.add(key);
    const entryValue = requireString(entry.value, `${location}.value`, true);
    if (entryValue.length > MAX_LOCAL_STORAGE_VALUE_CHARACTERS) {
      throw new Error(`${location}.value 超过 8MB 安全上限`);
    }
    validateLocalStorageValue(key, entryValue, `${location}.value`);
    return { key, value: entryValue };
  });
  const databaseNamesSeen = new Set<string>();
  const indexedDatabases = parsed.data.indexedDatabases.map((database, index) => {
    const result = parseDatabaseBackup(database, `data.indexedDatabases[${index}]`);
    if (databaseNamesSeen.has(result.name)) throw new Error(`完整备份包含重复数据库：${result.name}`);
    databaseNamesSeen.add(result.name);
    return result;
  });
  const accountHints = parseAccountHints(parsed.data.accountHints);
  const coreData = {
    indexedDatabases,
    localStorage: localStorageEntries,
    nativeSqlite: parseNativeSqliteBackup(parsed.data.nativeSqlite ?? null),
  };
  const data: FullBackupData = accountHints === undefined
    ? coreData
    : { accountHints, ...coreData };
  if (!isRecord(parsed.integrity) || parsed.integrity.algorithm !== "SHA-256") {
    throw new Error("完整备份缺少 SHA-256 完整性信息");
  }
  const expected = requireString(parsed.integrity.sha256, "integrity.sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("完整备份 SHA-256 格式无效");
  const actual = await sha256(data);
  if (actual !== expected) throw new Error("完整备份完整性校验失败，文件可能损坏或被修改");
  return {
    data,
    summary: summaryOf(data, data.nativeSqlite !== null),
  };
}

function createStore(database: IDBDatabase, store: IndexedDbStoreBackup) {
  const objectStore = database.createObjectStore(store.name, {
    autoIncrement: store.autoIncrement,
    keyPath: store.keyPath,
  });
  store.indexes.forEach((index) => {
    objectStore.createIndex(index.name, index.keyPath, {
      multiEntry: index.multiEntry,
      unique: index.unique,
    });
  });
}

function openDatabaseAtVersion(
  snapshot: IndexedDbDatabaseBackup,
  version: number,
  configureSchema: boolean,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(snapshot.name, version);
    request.onupgradeneeded = () => {
      if (!configureSchema) return;
      const database = request.result;
      snapshot.stores.forEach((storeSnapshot) => {
        if (!database.objectStoreNames.contains(storeSnapshot.name)) {
          createStore(database, storeSnapshot);
          return;
        }
        const store = request.transaction?.objectStore(storeSnapshot.name);
        if (!store) throw new Error(`无法升级 ${snapshot.name}.${storeSnapshot.name}`);
        storeSnapshot.indexes.forEach((index) => {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, {
              multiEntry: index.multiEntry,
              unique: index.unique,
            });
          }
        });
      });
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(backupError(`打开待恢复 Web 数据库 ${snapshot.name}`, request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`恢复 ${snapshot.name} 被其他页面阻止，请关闭其他 KiDinDin 页面后重试`));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function sameKeyPath(left: string | string[] | null, right: string | string[] | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertOpenDatabaseSchema(
  existing: IDBDatabase,
  snapshot: IndexedDbDatabaseBackup,
) {
  const registered = DATABASE_SCHEMAS[snapshot.name];
  if (!registered) throw new Error(`${snapshot.name} 不是当前版本登记的 WebDB`);
  if (existing.version !== registered.version) {
    throw new Error(
      `${snapshot.name} 当前版本为 ${existing.version}，应用仅支持 ${registered.version}，已拒绝改写数据库版本`,
    );
  }
  if (existing.objectStoreNames.length !== registered.stores.length) {
    throw new Error(`${snapshot.name} 的数据表数量与当前版本不一致`);
  }
  for (const storeSnapshot of registered.stores) {
    if (!existing.objectStoreNames.contains(storeSnapshot.name)) {
      throw new Error(`${snapshot.name} 缺少数据表 ${storeSnapshot.name}`);
    }
    const transaction = existing.transaction(storeSnapshot.name, "readonly");
    const store = transaction.objectStore(storeSnapshot.name);
    if (!sameKeyPath(store.keyPath, storeSnapshot.keyPath) || store.autoIncrement !== storeSnapshot.autoIncrement) {
      throw new Error(`${snapshot.name}.${storeSnapshot.name} 的主键结构与当前版本不兼容`);
    }
    if (store.indexNames.length !== storeSnapshot.indexes.length) {
      throw new Error(`${snapshot.name}.${storeSnapshot.name} 的索引数量与当前版本不一致`);
    }
    for (const indexSnapshot of storeSnapshot.indexes) {
      if (!store.indexNames.contains(indexSnapshot.name)) {
        throw new Error(`${snapshot.name}.${storeSnapshot.name} 缺少索引 ${indexSnapshot.name}`);
      }
      const index = store.index(indexSnapshot.name);
      if (
        !sameKeyPath(index.keyPath, indexSnapshot.keyPath) ||
        index.multiEntry !== indexSnapshot.multiEntry ||
        index.unique !== indexSnapshot.unique
      ) {
        throw new Error(`${snapshot.name}.${storeSnapshot.name}.${indexSnapshot.name} 索引结构不兼容`);
      }
    }
  }
}

async function databaseExistsAndMatches(snapshot: IndexedDbDatabaseBackup) {
  const existing = await openExistingDatabase(snapshot.name);
  if (!existing) return false;
  try {
    assertOpenDatabaseSchema(existing, snapshot);
    return true;
  } finally {
    existing.close();
  }
}

async function openDatabaseForRestore(snapshot: IndexedDbDatabaseBackup) {
  const registered = DATABASE_SCHEMAS[snapshot.name];
  if (!registered) throw new Error(`${snapshot.name} 不是当前版本登记的 WebDB`);
  const existing = await openExistingDatabase(snapshot.name);
  if (!existing) return openDatabaseAtVersion(snapshot, registered.version, true);
  try {
    assertOpenDatabaseSchema(existing, snapshot);
    return existing;
  } catch (error) {
    existing.close();
    throw error;
  }
}

function recordString(
  value: Record<string, unknown>,
  field: string,
  location: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
) {
  const result = requireString(
    value[field],
    `${location}.${field}`,
    options.allowEmpty ?? true,
  );
  const maxLength = options.maxLength ?? 32 * 1024;
  if (result.length > maxLength) throw new Error(`${location}.${field} 超过 ${maxLength} 字符`);
  return result;
}

function recordBoolean(value: Record<string, unknown>, field: string, location: string) {
  if (typeof value[field] !== "boolean") throw new Error(`${location}.${field} 必须是布尔值`);
  return value[field];
}

function recordDate(value: Record<string, unknown>, field: string, location: string) {
  const result = recordString(value, field, location, { allowEmpty: false, maxLength: 64 });
  if (Number.isNaN(Date.parse(result))) throw new Error(`${location}.${field} 不是有效日期时间`);
  return result;
}

function assertDateOnly(value: string, location: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${location} 必须使用 YYYY-MM-DD 格式`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`${location} 不是有效日期`);
  }
}

function assertInlineKey(
  key: IDBValidKey,
  inlineKey: unknown,
  location: string,
) {
  if (typeof key !== "string" || typeof inlineKey !== "string") {
    throw new Error(`${location} 的主键和内联主键必须是字符串`);
  }
  let comparison: number;
  try {
    comparison = indexedDB.cmp(key, inlineKey);
  } catch (error) {
    throw backupError(`${location} 主键比较`, error);
  }
  if (comparison !== 0) throw new Error(`${location} 的备份主键与记录内联主键不一致`);
}

function assertCompositeAccountKey(
  value: Record<string, unknown>,
  inlineField: "key",
  location: string,
) {
  const accountKey = recordString(value, "accountKey", location, {
    allowEmpty: false,
    maxLength: 512,
  });
  const woHeaderId = recordString(value, "woHeaderId", location, {
    allowEmpty: false,
    maxLength: 512,
  });
  const inlineKey = recordString(value, inlineField, location, {
    allowEmpty: false,
    maxLength: 2_048,
  });
  if (inlineKey !== JSON.stringify([accountKey, woHeaderId])) {
    throw new Error(`${location}.${inlineField} 与账号和工单标识不匹配`);
  }
}

function validateLocalWorkOrderRecord(value: Record<string, unknown>, location: string) {
  assertCompositeAccountKey(value, "key", location);
  recordBoolean(value, "favorite", location);
  recordBoolean(value, "pinned", location);
  recordString(value, "note", location, { maxLength: 256 * 1024 });
  const appointmentAt = value.appointmentAt;
  if (appointmentAt !== null) {
    if (typeof appointmentAt !== "string" || !appointmentAt.trim() || Number.isNaN(Date.parse(appointmentAt))) {
      throw new Error(`${location}.appointmentAt 必须是日期时间字符串或 null`);
    }
  }
  const sourceDate = recordString(value, "sourceDate", location, {
    allowEmpty: false,
    maxLength: 10,
  });
  assertDateOnly(sourceDate, `${location}.sourceDate`);
  recordDate(value, "updatedAt", location);
  if (!isRecord(value.snapshot)) throw new Error(`${location}.snapshot 必须是对象`);
  for (const field of [
    "woNumber",
    "resident",
    "unit",
    "address",
    "building",
    "unitNumber",
    "floorNumber",
    "backendStatusCode",
    "status",
    "time",
  ]) {
    recordString(value.snapshot, field, `${location}.snapshot`, { maxLength: 32 * 1024 });
  }
}

function validateSignatureRecord(value: Record<string, unknown>, location: string) {
  assertCompositeAccountKey(value, "key", location);
  for (const field of ["address", "building", "resident", "unit", "woNumber"] as const) {
    recordString(value, field, location, { maxLength: 32 * 1024 });
  }
  recordString(value, "signerName", location, { allowEmpty: false, maxLength: 1_024 });
  recordDate(value, "signedAt", location);
  if (!(value.blob instanceof Blob) || !value.blob.size || !value.blob.type.startsWith("image/")) {
    throw new Error(`${location}.blob 必须是非空图片`);
  }
}

function validateStorefrontRecord(value: Record<string, unknown>, location: string) {
  assertCompositeAccountKey(value, "key", location);
  for (const field of ["resident", "unit", "woNumber"] as const) {
    recordString(value, field, location, { maxLength: 32 * 1024 });
  }
  recordString(value, "fileName", location, { allowEmpty: false, maxLength: 1_024 });
  const mimeType = recordString(value, "mimeType", location, { maxLength: 255 });
  recordDate(value, "savedAt", location);
  if (!(value.blob instanceof Blob) || !value.blob.size) {
    throw new Error(`${location}.blob 必须是非空图片`);
  }
  if ((mimeType && !mimeType.startsWith("image/")) || (value.blob.type && !value.blob.type.startsWith("image/"))) {
    throw new Error(`${location}.blob 不是图片类型`);
  }
  if (!Number.isSafeInteger(value.size) || value.size !== value.blob.size) {
    throw new Error(`${location}.size 与图片实际大小不一致`);
  }
}

function nullableRecordString(
  value: Record<string, unknown>,
  field: string,
  location: string,
  maxLength: number,
) {
  if (value[field] === null) return null;
  return recordString(value, field, location, { maxLength });
}

function validateUploadFileNameRecord(value: Record<string, unknown>, location: string) {
  const name = recordString(value, "name", location, { allowEmpty: false, maxLength: 1_024 });
  recordDate(value, "generatedAt", location);
  recordString(value, "sourceName", location, { maxLength: 4_096 });
  for (const field of ["sourceSize", "sourceLastModified"] as const) {
    if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0) {
      throw new Error(`${location}.${field} 必须是非负整数`);
    }
  }
  const contentSha256 = nullableRecordString(value, "contentSha256", location, 64);
  if (contentSha256 !== null && !/^[a-f0-9]{64}$/i.test(contentSha256)) {
    throw new Error(`${location}.contentSha256 格式无效`);
  }
  nullableRecordString(value, "previewDataUrl", location, 8 * 1024 * 1024);
  recordString(value, "note", location, { maxLength: 256 * 1024 });
  if (value.status !== "reserved" && value.status !== "uploaded" && value.status !== "failed") {
    throw new Error(`${location}.status 无效`);
  }
  const uploadedAt = nullableRecordString(value, "uploadedAt", location, 64);
  if (uploadedAt !== null && Number.isNaN(Date.parse(uploadedAt))) {
    throw new Error(`${location}.uploadedAt 不是有效日期时间`);
  }
  nullableRecordString(value, "failureMessage", location, 256 * 1024);
  return name;
}

function validateDecodedRecord(
  databaseName: string,
  key: IDBValidKey,
  value: unknown,
  location: string,
) {
  if (!isRecord(value)) throw new Error(`${location}.value 必须是对象`);
  if (databaseName === "kidindin-local-work-orders") validateLocalWorkOrderRecord(value, `${location}.value`);
  else if (databaseName === "kidindin-signatures") validateSignatureRecord(value, `${location}.value`);
  else if (databaseName === "kidindin-unreachable-prefills") validateStorefrontRecord(value, `${location}.value`);
  else if (databaseName === "kidindin-upload-file-names") validateUploadFileNameRecord(value, `${location}.value`);
  const inlineKey = databaseName === "kidindin-upload-file-names" ? value.name : value.key;
  assertInlineKey(key, inlineKey, location);
}

function decodeDatabase(
  snapshot: IndexedDbDatabaseBackup,
  budget: ValueBudget,
): DecodedDatabaseBackup {
  return {
    ...snapshot,
    stores: snapshot.stores.map((store) => {
      const keys = new Set<string>();
      return {
        ...store,
        records: store.records.map((record, index) => {
        const location = `${snapshot.name}.${store.name}[${index}]`;
        const key = decodeValue(record.key, `${location}.key`, budget);
        if (!isValidIndexedDbKey(key)) throw new Error(`${location}.key 不是有效的 IndexedDB 主键`);
        if (typeof key !== "string") throw new Error(`${location}.key 必须是字符串主键`);
        if (keys.has(key)) throw new Error(`${snapshot.name}.${store.name} 包含重复主键 ${key}`);
        keys.add(key);
        const decoded = {
          key,
          value: decodeValue(record.value, `${location}.value`, budget),
        };
        validateDecodedRecord(snapshot.name, decoded.key, decoded.value, location);
        return decoded;
      }),
      };
    }),
  };
}

function timestampOf(value: unknown, field: string) {
  if (!isRecord(value) || typeof value[field] !== "string") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value[field]);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function mergedUploadFileNameRecord(current: unknown, incoming: unknown) {
  if (!isRecord(current) || !isRecord(incoming)) return incoming;
  const statusRank = (value: unknown) =>
    value === "uploaded" ? 3 : value === "failed" ? 2 : value === "reserved" ? 1 : 0;
  const incomingStatusWins = statusRank(incoming.status) > statusRank(current.status);
  return {
    ...incoming,
    ...current,
    contentSha256: current.contentSha256 || incoming.contentSha256 || null,
    failureMessage: incomingStatusWins ? incoming.failureMessage : current.failureMessage,
    note: current.note || incoming.note || "",
    previewDataUrl: current.previewDataUrl || incoming.previewDataUrl || null,
    status: incomingStatusWins ? incoming.status : current.status,
    uploadedAt:
      timestampOf(incoming, "uploadedAt") > timestampOf(current, "uploadedAt")
        ? incoming.uploadedAt
        : current.uploadedAt,
  };
}

function mergeRestoredRecord(
  databaseName: string,
  current: unknown,
  incoming: unknown,
) {
  if (current === undefined) return incoming;
  if (databaseName === "kidindin-local-work-orders") {
    return timestampOf(incoming, "updatedAt") >= timestampOf(current, "updatedAt")
      ? incoming
      : current;
  }
  if (databaseName === "kidindin-signatures") {
    return timestampOf(incoming, "signedAt") >= timestampOf(current, "signedAt")
      ? incoming
      : current;
  }
  if (databaseName === "kidindin-unreachable-prefills") {
    return timestampOf(incoming, "savedAt") >= timestampOf(current, "savedAt")
      ? incoming
      : current;
  }
  if (databaseName === "kidindin-upload-file-names") {
    return mergedUploadFileNameRecord(current, incoming);
  }
  return incoming;
}

function normalizedAccountMapping(options: FullBackupRestoreOptions) {
  const result = new Map<string, string>();
  for (const [sourceValue, targetValue] of Object.entries(options.accountKeyMapping ?? {})) {
    const source = sourceValue.trim();
    const target = targetValue.trim();
    if (!source || !target) throw new Error("账号映射的来源和目标都不能为空");
    if (source.length > 512 || target.length > 512) throw new Error("账号映射标识超过 512 字符");
    if (source !== target) result.set(source, target);
  }
  return result;
}

function remapDecodedDatabases(
  databases: DecodedDatabaseBackup[],
  mapping: ReadonlyMap<string, string>,
) {
  if (!mapping.size) return databases;
  return databases.map((database) => ({
    ...database,
    stores: database.stores.map((store) => {
      if (database.name === "kidindin-upload-file-names") return store;
      const records = new Map<string, { key: IDBValidKey; value: unknown }>();
      store.records.forEach((record, index) => {
        const location = `${database.name}.${store.name}[${index}]`;
        if (!isRecord(record.value)) throw new Error(`${location}.value 必须是对象`);
        const accountKey = recordString(record.value, "accountKey", `${location}.value`, {
          allowEmpty: false,
          maxLength: 512,
        });
        const target = mapping.get(accountKey);
        const value = target
          ? {
              ...record.value,
              accountKey: target,
              key: JSON.stringify([
                target,
                recordString(record.value, "woHeaderId", `${location}.value`, {
                  allowEmpty: false,
                  maxLength: 512,
                }),
              ]),
            }
          : record.value;
        const key = target ? (value as Record<string, unknown>).key as string : record.key;
        validateDecodedRecord(database.name, key, value, location);
        const signature = key as string;
        const previous = records.get(signature);
        records.set(signature, previous
          ? { key, value: mergeRestoredRecord(database.name, previous.value, value) }
          : { key, value });
      });
      return { ...store, records: Array.from(records.values()) };
    }),
  }));
}

function remapNativeSqlite(
  backup: unknown | null,
  mapping: ReadonlyMap<string, string>,
) {
  if (backup === null || !mapping.size) return backup;
  if (!isRecord(backup) || !isRecord(backup.tables)) {
    throw new Error("Android SQLite 备份结构无效");
  }
  const workOrders = backup.tables.workOrderIndex as Array<Record<string, unknown>>;
  const prefillHistory = backup.tables.residentSecurityPrefillHistory as Array<Record<string, unknown>>;
  const mappedWorkOrders = new Map<string, Record<string, unknown>>();
  workOrders.forEach((row) => {
    const accountKey = row.accountKey as string;
    const mapped: Record<string, unknown> = {
      ...row,
      accountKey: mapping.get(accountKey) ?? accountKey,
    };
    const key = JSON.stringify([mapped.accountKey, mapped.woHeaderId]);
    const current = mappedWorkOrders.get(key);
    const selected = !current || (mapped.lastSeenAt as number) > (current.lastSeenAt as number)
      ? mapped
      : current;
    mappedWorkOrders.set(key, current
      ? {
          ...selected,
          firstSeenAt: Math.min(current.firstSeenAt as number, mapped.firstSeenAt as number),
        }
      : selected);
  });
  const mappedPrefills = new Map<string, Record<string, unknown>>();
  prefillHistory.forEach((row) => {
    const accountKey = row.accountKey as string;
    const mapped: Record<string, unknown> = {
      ...row,
      accountKey: mapping.get(accountKey) ?? accountKey,
    };
    const key = JSON.stringify([mapped.accountKey, mapped.woHeaderId]);
    const current = mappedPrefills.get(key);
    if (!current || (mapped.completedAt as number) > (current.completedAt as number)) {
      mappedPrefills.set(key, mapped);
    }
  });
  const result = {
    ...backup,
    tables: {
      ...backup.tables,
      workOrderIndex: Array.from(mappedWorkOrders.values()),
      residentSecurityPrefillHistory: Array.from(mappedPrefills.values()),
    },
  };
  return parseNativeSqliteBackup(result);
}

function remapLocalStorageEntries(
  entries: Array<{ key: string; value: string }>,
  mapping: ReadonlyMap<string, string>,
) {
  if (!mapping.size) return entries;
  const result = new Map<string, string>();
  for (const entry of entries) {
    let key = entry.key;
    let value = entry.value;
    for (const prefix of SAFE_LOCAL_STORAGE_PREFIXES) {
      if (!key.startsWith(prefix)) continue;
      const accountKey = key.slice(prefix.length);
      const target = mapping.get(accountKey);
      if (target) key = `${prefix}${target}`;
    }
    if (key === "kidindin.home-floor-grouping-state.v1") {
      const grouping = parseFloorGrouping(value, `${key} 备份值`);
      const mappedGrouping = Object.create(null) as Record<string, string[]>;
      for (const [scope, groups] of Object.entries(grouping)) {
        let mappedScope = scope;
        for (const [source, target] of mapping) {
          if (scope.startsWith(`${source}:`)) mappedScope = `${target}:${scope.slice(source.length + 1)}`;
        }
        mappedGrouping[mappedScope] = Array.from(new Set([
          ...(mappedGrouping[mappedScope] ?? []),
          ...groups,
        ])).sort();
      }
      value = JSON.stringify(mappedGrouping);
    }
    result.set(key, mergeLocalStorageValues(key, result.get(key) ?? null, value));
  }
  return Array.from(result, ([key, value]) => ({ key, value }));
}

type PreparedRecordRestore = {
  key: IDBValidKey;
  nextValue: unknown;
  previousExists: boolean;
  previousValue: unknown;
};

type PreparedDatabaseRestore = {
  decoded: DecodedDatabaseBackup;
  existed: boolean;
  snapshot: IndexedDbDatabaseBackup;
  stores: Array<{
    name: string;
    records: PreparedRecordRestore[];
  }>;
};

type PreparedLocalStorageRestore = Array<{
  key: string;
  nextValue: string;
  previousValue: string | null;
}>;

async function prepareDatabaseRestore(
  snapshot: IndexedDbDatabaseBackup,
  decoded: DecodedDatabaseBackup,
  existed: boolean,
): Promise<PreparedDatabaseRestore> {
  if (!existed) {
    return {
      decoded,
      existed,
      snapshot,
      stores: decoded.stores.map((store) => ({
        name: store.name,
        records: store.records.map((record, index) => {
          validateDecodedRecord(snapshot.name, record.key, record.value, `${snapshot.name}.${store.name}[${index}]`);
          return {
            key: record.key,
            nextValue: record.value,
            previousExists: false,
            previousValue: undefined,
          };
        }),
      })),
    };
  }

  const database = await openExistingDatabase(snapshot.name);
  if (!database) throw new Error(`${snapshot.name} 在恢复预检后被删除，请重试`);
  try {
    assertOpenDatabaseSchema(database, snapshot);
    const storeNames = decoded.stores.map((store) => store.name);
    const transaction = database.transaction(storeNames, "readonly");
    const done = transactionDone(transaction, `预读取 Web 数据库 ${snapshot.name}`);
    const pending = decoded.stores.flatMap((store) => {
      const objectStore = transaction.objectStore(store.name);
      return store.records.map(async (record, index) => {
        const previousValue = await requestResult<unknown>(
          objectStore.get(record.key),
          `预读取 ${snapshot.name}.${store.name}`,
        );
        const nextValue = mergeRestoredRecord(snapshot.name, previousValue, record.value);
        validateDecodedRecord(
          snapshot.name,
          record.key,
          nextValue,
          `${snapshot.name}.${store.name}[${index}] 合并结果`,
        );
        return {
          key: record.key,
          nextValue,
          previousExists: previousValue !== undefined,
          previousValue,
          storeName: store.name,
        };
      });
    });
    const [records] = await Promise.all([Promise.all(pending), done]);
    return {
      decoded,
      existed,
      snapshot,
      stores: decoded.stores.map((store) => ({
        name: store.name,
        records: records
          .filter((record) => record.storeName === store.name)
          .map(({ storeName: _storeName, ...record }) => record),
      })),
    };
  } finally {
    database.close();
  }
}

async function writePreparedDatabase(
  prepared: PreparedDatabaseRestore,
  rollback: boolean,
) {
  if (!prepared.stores.some((store) => store.records.length)) return;
  const database = await openDatabaseForRestore(prepared.snapshot);
  try {
    const transaction = database.transaction(prepared.stores.map((store) => store.name), "readwrite");
    const done = transactionDone(
      transaction,
      `${rollback ? "回滚" : "恢复"} Web 数据库 ${prepared.snapshot.name}`,
    );
    try {
      prepared.stores.forEach((storeSnapshot) => {
        const store = transaction.objectStore(storeSnapshot.name);
        storeSnapshot.records.forEach((record) => {
          if (rollback && !record.previousExists) {
            store.delete(record.key);
            return;
          }
          const value = rollback ? record.previousValue : record.nextValue;
          if (store.keyPath === null) store.put(value, record.key);
          else store.put(value);
        });
      });
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // transactionDone below reports the final transaction state.
      }
      await done.catch(() => undefined);
      throw backupError(`${rollback ? "回滚" : "写入"} Web 数据库 ${prepared.snapshot.name}`, error);
    }
    await done;
  } finally {
    database.close();
  }
}

function prepareLocalStorageRestore(
  entries: Array<{ key: string; value: string }>,
): PreparedLocalStorageRestore {
  return entries.map(({ key, value }) => {
    const previousValue = localStorage.getItem(key);
    const nextValue = mergeLocalStorageValues(key, previousValue, value);
    validateLocalStorageValue(key, nextValue, `${key} 合并结果`);
    if (nextValue.length > MAX_LOCAL_STORAGE_VALUE_CHARACTERS) {
      throw new Error(`${key} 合并结果超过 8MB 安全上限`);
    }
    return { key, nextValue, previousValue };
  });
}

function writePreparedLocalStorage(prepared: PreparedLocalStorageRestore, rollback: boolean) {
  const errors: string[] = [];
  for (const item of prepared) {
    try {
      const value = rollback ? item.previousValue : item.nextValue;
      if (value === null) localStorage.removeItem(item.key);
      else localStorage.setItem(item.key, value);
    } catch (error) {
      errors.push(`${item.key}${detail(error)}`);
      if (!rollback) throw backupError(`写入应用偏好 ${item.key}`, error);
    }
  }
  if (errors.length) throw new Error(`应用偏好回滚失败：${errors.join("；")}`);
}

async function rollbackCompletedPartitions(
  databases: PreparedDatabaseRestore[],
  localStoragePrepared: PreparedLocalStorageRestore | null,
) {
  const failures: string[] = [];
  if (localStoragePrepared) {
    try {
      writePreparedLocalStorage(localStoragePrepared, true);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "应用偏好回滚失败");
    }
  }
  for (const database of [...databases].reverse()) {
    try {
      await writePreparedDatabase(database, true);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${database.snapshot.name} 回滚失败`);
    }
  }
  return failures;
}

function encodedObjectStringField(value: EncodedValue, field: string) {
  if (!isRecord(value) || value.type !== "object" || !Array.isArray(value.value)) return null;
  const entry = value.value.find((candidate) => Array.isArray(candidate) && candidate[0] === field);
  if (!entry || !isRecord(entry[1]) || entry[1].type !== "string") return null;
  return typeof entry[1].value === "string" ? entry[1].value : null;
}

function accountIdentityOf(data: FullBackupData) {
  const accountKeys = new Set<string>();
  data.accountHints?.forEach((hint) => accountKeys.add(hint.accountKey));
  data.indexedDatabases.forEach((database) => {
    if (database.name === "kidindin-upload-file-names") return;
    database.stores.forEach((store) => store.records.forEach((record) => {
      const accountKey = encodedObjectStringField(record.value, "accountKey");
      if (accountKey) accountKeys.add(accountKey);
    }));
  });
  if (isRecord(data.nativeSqlite) && isRecord(data.nativeSqlite.tables)) {
    for (const tableName of ["workOrderIndex", "residentSecurityPrefillHistory"]) {
      const rows = data.nativeSqlite.tables[tableName];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row) => {
        if (isRecord(row) && typeof row.accountKey === "string" && row.accountKey.trim()) {
          accountKeys.add(row.accountKey);
        }
      });
    }
  }
  const sorted = Array.from(accountKeys).sort();
  const source = data.accountHints?.find((hint) => hint.current) ?? null;
  return {
    accountKeys: sorted,
    historyAccountKeys: sorted.filter((key) => key.startsWith("history:")),
    sourceAccountKey: source?.accountKey ?? null,
    sourceAccountLabel: source?.label ?? null,
  };
}

export async function inspectFullBackup(payload: string): Promise<FullBackupInspection> {
  const { data, summary } = await parseFullBackup(payload);
  const decodeBudget = emptyValueBudget();
  data.indexedDatabases.forEach((database) => {
    decodeDatabase(database, decodeBudget);
  });
  const nativeSqlitePresent = data.nativeSqlite !== null;
  let nativeSqliteCanRestore = true;
  if (nativeSqlitePresent) {
    const validation = await validateNativeDatabaseBackup(JSON.stringify(data.nativeSqlite));
    nativeSqliteCanRestore = validation.supported && validation.valid;
  }
  return {
    ...summary,
    ...accountIdentityOf(data),
    nativeSqliteCanRestore,
    nativeSqlitePresent,
    nativeSqliteSupported: nativeSqlitePresent && nativeSqliteCanRestore,
  };
}

export async function restoreFullBackup(
  payload: string,
  options: FullBackupRestoreOptions = {},
): Promise<FullBackupRestoreResult> {
  const { data, summary } = await parseFullBackup(payload);
  const mapping = normalizedAccountMapping(options);
  const decodeBudget = emptyValueBudget();
  const decodedDatabases = remapDecodedDatabases(
    data.indexedDatabases.map((database) => decodeDatabase(database, decodeBudget)),
    mapping,
  );
  const localStorageEntries = remapLocalStorageEntries(data.localStorage, mapping);
  const nativeBackup = remapNativeSqlite(data.nativeSqlite, mapping);

  let nativeValidation: Awaited<ReturnType<typeof validateNativeDatabaseBackup>> | null = null;
  let nativePayload: string | null = null;
  if (nativeBackup !== null) {
    nativePayload = JSON.stringify(nativeBackup);
    nativeValidation = await validateNativeDatabaseBackup(nativePayload);
    if (!nativeValidation.supported || !nativeValidation.valid) {
      throw new Error("该备份包含 Android SQLite 数据，当前环境无法完整恢复；请在 KiDinDin Android 应用中导入");
    }
    if (
      !Number.isInteger(nativeValidation.workOrderCount) ||
      !Number.isInteger(nativeValidation.prefillHistoryCount)
    ) {
      throw new Error("Android SQLite 预检返回的记录计数无效");
    }
  }

  // Preflight every existing schema and every localStorage merge before the first
  // record write. This prevents a late incompatible partition from stranding an
  // earlier committed database.
  const databaseExistence: boolean[] = [];
  for (const snapshot of data.indexedDatabases) {
    databaseExistence.push(await databaseExistsAndMatches(snapshot));
  }
  const preparedDatabases: PreparedDatabaseRestore[] = [];
  for (let index = 0; index < data.indexedDatabases.length; index += 1) {
    preparedDatabases.push(await prepareDatabaseRestore(
      data.indexedDatabases[index],
      decodedDatabases[index],
      databaseExistence[index],
    ));
  }
  const preparedLocalStorage = prepareLocalStorageRestore(localStorageEntries);

  const completedDatabases: PreparedDatabaseRestore[] = [];
  let localStorageAttempted = false;
  let nativeSqlite: NativeDatabaseImportResult | null = null;
  try {
    for (const prepared of preparedDatabases) {
      await writePreparedDatabase(prepared, false);
      completedDatabases.push(prepared);
    }
    localStorageAttempted = true;
    writePreparedLocalStorage(preparedLocalStorage, false);

    // Native import is deliberately last. The Android implementation validates
    // first and uses one SQLite transaction (plus preference rollback), so no
    // fallible Web write remains after it commits.
    if (nativePayload !== null && nativeValidation !== null) {
      const result = await importNativeDatabaseBackup(nativePayload);
      if (
        !result.supported ||
        !Number.isInteger(result.workOrdersImported) ||
        !Number.isInteger(result.prefillHistoryImported) ||
        !Number.isInteger(result.workOrderTotal) ||
        !Number.isInteger(result.prefillHistoryTotal)
      ) {
        throw new Error("Android SQLite 恢复返回了不完整结果");
      }
      if (
        (result.workOrdersImported as number) > (nativeValidation.workOrderCount as number) ||
        (result.prefillHistoryImported as number) > (nativeValidation.prefillHistoryCount as number)
      ) {
        throw new Error("Android SQLite 恢复返回的写入计数超过备份记录数");
      }
      nativeSqlite = result;
    }
  } catch (error) {
    const failures = await rollbackCompletedPartitions(
      completedDatabases,
      localStorageAttempted ? preparedLocalStorage : null,
    );
    const reason = error instanceof Error ? error.message : "未知错误";
    if (failures.length) {
      throw new Error(`完整恢复失败：${reason}；以下分区未能回滚：${failures.join("；")}`);
    }
    throw new Error(`完整恢复失败：${reason}；本次 WebDB 与偏好写入已回滚`);
  }
  return { ...summary, nativeSqlite };
}

export type FullBackupArchiveEncodedValue = EncodedValue;
export type FullBackupArchiveRecord = IndexedDbRecordBackup;
export type FullBackupArchiveDatabase = IndexedDbDatabaseBackup;
export type FullBackupArchiveLocalStorageEntry = { key: string; value: string };

export type FullBackupArchiveStreamPlan = {
  databases: IndexedDbDatabaseBackup[];
  partitions: Array<{
    databaseName: string;
    keys: IDBValidKey[];
    storeName: string;
  }>;
  totalRecordCount: number;
};

/**
 * Builds a keys-only export plan. Values (and especially Blob payloads) are not
 * retained here, so a multi-gigabyte photo library does not become a matching
 * JavaScript heap allocation before streaming starts.
 */
export async function prepareFullBackupArchiveStream(): Promise<FullBackupArchiveStreamPlan> {
  const databases: IndexedDbDatabaseBackup[] = [];
  const partitions: FullBackupArchiveStreamPlan["partitions"] = [];
  let totalRecordCount = 0;
  for (const name of await databaseNames()) {
    const database = await openExistingDatabase(name);
    if (!database) continue;
    try {
      const storeNames = Array.from(database.objectStoreNames);
      if (!storeNames.length) {
        const snapshot = { name, stores: [], version: database.version };
        assertDatabaseSchema(snapshot, `Web 数据库 ${name}`);
        databases.push(snapshot);
        continue;
      }
      const transaction = database.transaction(storeNames, "readonly");
      const done = transactionDone(transaction, `枚举 Web 数据库 ${name}`);
      const reads = storeNames.map(async (storeName) => {
        const store = transaction.objectStore(storeName);
        const keys = await requestResult<IDBValidKey[]>(
          store.getAllKeys(),
          `枚举 ${name}.${storeName} 主键`,
        );
        if (keys.length > MAX_RECORDS_PER_STORE) {
          throw new Error(`${name}.${storeName} 超过 ${MAX_RECORDS_PER_STORE} 条备份上限`);
        }
        if (keys.some((key) => typeof key !== "string")) {
          throw new Error(`${name}.${storeName} 包含当前版本不支持的非字符串主键`);
        }
        return {
          keys,
          schema: {
            autoIncrement: store.autoIncrement,
            indexes: Array.from(store.indexNames).map((indexName) => {
              const index = store.index(indexName);
              return {
                keyPath: index.keyPath,
                multiEntry: index.multiEntry,
                name: index.name,
                unique: index.unique,
              };
            }),
            keyPath: store.keyPath,
            name: store.name,
            records: [] as IndexedDbRecordBackup[],
          },
        };
      });
      const stores = await Promise.all(reads);
      await done;
      const snapshot: IndexedDbDatabaseBackup = {
        name,
        stores: stores.map((item) => item.schema),
        version: database.version,
      };
      assertDatabaseSchema(snapshot, `Web 数据库 ${name}`);
      databases.push(snapshot);
      stores.forEach((item) => {
        partitions.push({ databaseName: name, keys: item.keys, storeName: item.schema.name });
        totalRecordCount += item.keys.length;
      });
    } finally {
      database.close();
    }
  }
  return { databases, partitions, totalRecordCount };
}

export async function streamFullBackupArchiveRecords(
  plan: FullBackupArchiveStreamPlan,
  onRecord: (
    databaseName: string,
    storeName: string,
    record: FullBackupArchiveRecord,
  ) => void | Promise<void>,
) {
  for (const snapshot of plan.databases) {
    const database = await openExistingDatabase(snapshot.name);
    if (!database) throw new Error(`Web 数据库 ${snapshot.name} 在导出期间被删除，请重试`);
    try {
      assertOpenDatabaseSchema(database, snapshot);
      for (const storeSnapshot of snapshot.stores) {
        const partition = plan.partitions.find(
          (item) => item.databaseName === snapshot.name && item.storeName === storeSnapshot.name,
        );
        if (!partition) throw new Error(`缺少 ${snapshot.name}.${storeSnapshot.name} 的流式导出计划`);
        for (let index = 0; index < partition.keys.length; index += 1) {
          const key = partition.keys[index];
          const transaction = database.transaction(storeSnapshot.name, "readonly");
          const request = transaction.objectStore(storeSnapshot.name).get(key);
          const [value] = await Promise.all([
            requestResult<unknown>(request, `读取 ${snapshot.name}.${storeSnapshot.name}`),
            transactionDone(transaction, `读取 ${snapshot.name}.${storeSnapshot.name}`),
          ]);
          if (value === undefined) {
            throw new Error(`${snapshot.name}.${storeSnapshot.name} 在导出期间发生变化，请重试`);
          }
          const location = `${snapshot.name}.${storeSnapshot.name}[${index}]`;
          validateDecodedRecord(snapshot.name, key, value, location);
          const budget = emptyValueBudget();
          await onRecord(snapshot.name, storeSnapshot.name, {
            key: await encodeValue(key, `${location}.key`, budget),
            value: await encodeValue(value, `${location}.value`, budget),
          });
        }

        const verifyTransaction = database.transaction(storeSnapshot.name, "readonly");
        const verifyRequest = verifyTransaction.objectStore(storeSnapshot.name).getAllKeys();
        const [currentKeys] = await Promise.all([
          requestResult<IDBValidKey[]>(
            verifyRequest,
            `复核 ${snapshot.name}.${storeSnapshot.name} 主键`,
          ),
          transactionDone(verifyTransaction, `复核 ${snapshot.name}.${storeSnapshot.name}`),
        ]);
        if (
          currentKeys.length !== partition.keys.length ||
          currentKeys.some((key, index) => key !== partition.keys[index])
        ) {
          throw new Error(`${snapshot.name}.${storeSnapshot.name} 在导出期间发生变化，已停止生成不一致备份`);
        }
      }
    } finally {
      database.close();
    }
  }
}

export function decodeFullBackupArchiveRecord(
  database: IndexedDbDatabaseBackup,
  storeName: string,
  record: IndexedDbRecordBackup,
  mapping: ReadonlyMap<string, string> = new Map(),
) {
  const targetStore = database.stores.find((store) => store.name === storeName);
  if (!targetStore) throw new Error(`${database.name} 不包含数据表 ${storeName}`);
  const snapshot: IndexedDbDatabaseBackup = {
    ...database,
    stores: database.stores.map((store) => ({
      ...store,
      records: store.name === storeName ? [record] : [],
    })),
  };
  assertDatabaseSchema(snapshot, `流式备份 Web 数据库 ${database.name}`);
  const decoded = decodeDatabase(snapshot, emptyValueBudget());
  const remapped = remapDecodedDatabases([decoded], mapping)[0];
  const decodedRecord = remapped.stores.find((store) => store.name === storeName)?.records[0];
  if (!decodedRecord) throw new Error(`${database.name}.${storeName} 的流式记录为空`);
  return decodedRecord;
}

export const fullBackupArchiveInternals = {
  assertDatabaseSchema,
  databaseExistsAndMatches,
  exportLocalStorage,
  mergeRestoredRecord,
  openDatabaseForRestore,
  openExistingDatabase,
  parseNativeSqliteBackup,
  prepareLocalStorageRestore,
  remapLocalStorageEntries,
  remapNativeSqlite,
  shouldIncludeLocalStorageKey,
  validateDecodedRecord,
  validateLocalStorageValue,
  writePreparedLocalStorage,
};

function browserDownload(fileName: string, payload: string) {
  const url = URL.createObjectURL(
    new Blob([payload], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function saveUtf8JsonFile(fileName: string, payload: string): Promise<SavedBackupFile> {
  if (!fileName.trim()) throw new Error("备份文件名不能为空");
  if (!payload) throw new Error("备份文件内容为空");
  const bytes = new TextEncoder().encode(payload);
  const expectedSha256 = await sha256Bytes(bytes);
  if (isNativeRuntime()) {
    const result = await saveNativeBackupFile(fileName, payload);
    if (result.supported) {
      if (
        typeof result.fileName !== "string" || !result.fileName.trim() ||
        typeof result.destination !== "string" || !result.destination.trim() ||
        result.size !== bytes.byteLength ||
        typeof result.sha256 !== "string" ||
        result.sha256.toLowerCase() !== expectedSha256
      ) {
        throw new Error("原生备份文件落盘校验结果不完整或与待保存内容不一致");
      }
      return {
        destination: result.destination,
        fileName: result.fileName,
        method: "native",
        size: result.size,
      };
    }
  }
  browserDownload(fileName, payload);
  return {
    destination: "浏览器下载流程",
    fileName,
    method: "browser",
    size: bytes.byteLength,
  };
}
