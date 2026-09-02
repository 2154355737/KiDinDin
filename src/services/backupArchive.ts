import {
  decodeFullBackupArchiveRecord,
  fullBackupArchiveInternals,
  inspectFullBackup,
  MAX_FULL_BACKUP_FILE_BYTES,
  prepareFullBackupArchiveStream,
  restoreFullBackup,
  streamFullBackupArchiveRecords,
  type FullBackupArchiveDatabase,
  type FullBackupArchiveLocalStorageEntry,
  type FullBackupArchiveRecord,
} from "./fullBackup";
import {
  abortLargeBackupFile,
  appendLargeBackupFile,
  beginLargeBackupFile,
  exportNativeDatabaseBackup,
  finishLargeBackupFile,
  importNativeDatabaseBackup,
  isNativeRuntime,
  validateNativeDatabaseBackup,
  type NativeDatabaseImportResult,
} from "./tauri";
import {
  BACKUP_ARCHIVE_KIND,
  BACKUP_ARCHIVE_VERSION,
  IncrementalSha256,
  readUtf8Lines,
  utf8ByteLength,
} from "./backupArchiveFormat";

const ARCHIVE_EXTENSION = ".kidbackup";
const MAX_ARCHIVE_LINE_BYTES = 96 * 1024 * 1024;
const MAX_ARCHIVE_DATABASES = 4;
const MAX_ARCHIVE_RECORDS = 800_000;
const MAX_ARCHIVE_LOCAL_STORAGE_ENTRIES = 2_000;
const OUTPUT_CHUNK_CHARACTERS = 768 * 1024;
const SCRATCH_STORE = "records";
const SCRATCH_PARTITION_INDEX = "partition";

export type BackupArchiveProgress = {
  phase:
    | "preparing"
    | "exporting"
    | "reading"
    | "validating"
    | "staging"
    | "restoring"
    | "finalizing"
    | "rolling-back"
    | "completed";
  message: string;
  processedBytes: number;
  totalBytes: number | null;
  processedRecords: number;
  totalRecords: number | null;
};

export type BackupArchiveInspection = {
  accountKeys: string[];
  databaseCount: number;
  format: "archive" | "legacy-json";
  historyAccountKeys: string[];
  indexedDbRecordCount: number;
  localStorageEntryCount: number;
  nativeSqliteCanRestore: boolean;
  nativeSqlitePresent: boolean;
  nativeSqliteRecordCount: number;
  sourceAccountKey: string | null;
  sourceAccountLabel: string | null;
};

export type BackupArchiveExportResult = {
  databaseCount: number;
  destination: string;
  fileName: string;
  indexedDbRecordCount: number;
  localStorageEntryCount: number;
  method: "browser" | "native";
  nativeSqliteRecordCount: number;
  size: number;
};

export type BackupArchiveRestoreResult = {
  databaseCount: number;
  indexedDbRecordCount: number;
  localStorageEntryCount: number;
  nativeSqlite: NativeDatabaseImportResult | null;
  nativeSqliteRecordCount: number;
  rolledBack?: false | string | { message: string };
};

type ProgressHandler = (progress: BackupArchiveProgress) => void;

type ArchiveHeader = {
  accountHints: Array<{ accountKey: string; current: boolean; label: string }>;
  databases: FullBackupArchiveDatabase[];
  exportedAt: string;
  kind: typeof BACKUP_ARCHIVE_KIND;
  partitions: Array<{ databaseName: string; recordCount: number; storeName: string }>;
  security: { authenticationCredentialsIncluded: false; note: string };
  source: { runtime: "native" | "web"; userAgent: string };
  totalRecordCount: number;
  type: "header";
  version: typeof BACKUP_ARCHIVE_VERSION;
};

type ArchiveFooter = {
  contentBytes: number;
  contentLineCount: number;
  contentSha256: string;
  databaseCount: number;
  indexedDbRecordCount: number;
  localStorageEntryCount: number;
  nativeSqliteRecordCount: number;
  type: "footer";
};

type ArchiveParsed = {
  accountKeys: string[];
  header: ArchiveHeader;
  localStorage: FullBackupArchiveLocalStorageEntry[];
  nativeSqlite: unknown | null;
  nativeSqliteCanRestore: boolean;
  nativeSqliteRecordCount: number;
  stagedRecordCount: number;
};

type ScratchRecord = {
  databaseName: string;
  id: string;
  key: IDBValidKey;
  partition: string;
  storeName: string;
  value: unknown;
};

type RollbackRecord = ScratchRecord & {
  previousExists: boolean;
};

type ArchiveOutput = {
  abort: () => Promise<void>;
  append: (chunk: string) => Promise<void>;
  finish: (expectedSize: number, expectedSha256: string) => Promise<{
    destination: string;
    fileName: string;
    method: "browser" | "native";
    size: number;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function requireString(value: unknown, location: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${location} 必须是${allowEmpty ? "字符串" : "非空字符串"}`);
  }
  return value;
}

function requireInteger(value: unknown, location: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${location} 必须是 0 到 ${maximum} 之间的安全整数`);
  }
  return value as number;
}

function emitProgress(
  handler: ProgressHandler | undefined,
  progress: BackupArchiveProgress,
) {
  handler?.(progress);
}

function nativeRecordCount(value: unknown) {
  if (!isRecord(value) || !isRecord(value.tables)) return 0;
  const workOrders = value.tables.workOrderIndex;
  const prefills = value.tables.residentSecurityPrefillHistory;
  return (Array.isArray(workOrders) ? workOrders.length : 0) +
    (Array.isArray(prefills) ? prefills.length : 0);
}

function safeStringChunkEnd(value: string, offset: number) {
  let end = Math.min(value.length, offset + OUTPUT_CHUNK_CHARACTERS);
  if (
    end < value.length &&
    end > offset &&
    value.charCodeAt(end - 1) >= 0xd800 &&
    value.charCodeAt(end - 1) <= 0xdbff
  ) {
    end -= 1;
  }
  return end;
}

async function writeTextInChunks(
  output: ArchiveOutput,
  value: string,
  fileHasher: IncrementalSha256,
  contentHasher: IncrementalSha256 | null,
) {
  let bytes = 0;
  for (let offset = 0; offset < value.length;) {
    const end = safeStringChunkEnd(value, offset);
    if (end <= offset) throw new Error("无法安全拆分备份文本块");
    const chunk = value.slice(offset, end);
    fileHasher.update(chunk);
    contentHasher?.update(chunk);
    bytes += utf8ByteLength(chunk);
    await output.append(chunk);
    offset = end;
  }
  return bytes;
}

type FileSystemWritableLike = {
  abort?: () => Promise<void>;
  close: () => Promise<void>;
  write: (data: string) => Promise<void>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ accept: Record<string, string[]>; description: string }>;
  }) => Promise<{ createWritable: () => Promise<FileSystemWritableLike>; name?: string }>;
};

async function createArchiveOutput(fileName: string): Promise<ArchiveOutput> {
  if (isNativeRuntime()) {
    const native = await beginLargeBackupFile(fileName);
    if (native.supported) {
      const sessionId = requireString(native.sessionId, "原生流式备份 sessionId");
      return {
        append: async (chunk) => {
          const result = await appendLargeBackupFile(sessionId, chunk);
          if (!result.supported) throw new Error("原生环境拒绝追加流式备份数据");
        },
        finish: async (expectedSize, expectedSha256) => {
          const saved = await finishLargeBackupFile(sessionId, expectedSize, expectedSha256);
          if (
            !saved.supported ||
            saved.size !== expectedSize ||
            saved.sha256?.toLowerCase() !== expectedSha256.toLowerCase() ||
            !saved.fileName?.trim() ||
            !saved.destination?.trim()
          ) {
            throw new Error("原生流式备份落盘校验结果与导出内容不一致");
          }
          return {
            destination: saved.destination,
            fileName: saved.fileName,
            method: "native" as const,
            size: saved.size,
          };
        },
        abort: async () => {
          await abortLargeBackupFile(sessionId).catch(() => undefined);
        },
      };
    }
  }

  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (typeof picker !== "function") {
    throw new Error("当前环境不支持大文件流式保存；请在 Android 应用或支持文件流写入的 Chromium 浏览器中导出");
  }
  const handle = await picker({
    suggestedName: fileName,
    types: [{
      accept: { "application/x-ndjson": [ARCHIVE_EXTENSION] },
      description: "KiDinDin 流式备份",
    }],
  });
  const writable = await handle.createWritable();
  let closed = false;
  return {
    append: (chunk) => writable.write(chunk),
    finish: async (expectedSize) => {
      await writable.close();
      closed = true;
      return {
        destination: "浏览器选择的位置",
        fileName: handle.name || fileName,
        method: "browser" as const,
        size: expectedSize,
      };
    },
    abort: async () => {
      if (!closed) await writable.abort?.().catch(() => undefined);
    },
  };
}

function archiveFileName(exportedAt: string) {
  const timestamp = exportedAt.replace(/[:T]/g, "-").slice(0, 19);
  return `kidindin-full-backup-${timestamp}${ARCHIVE_EXTENSION}`;
}

export async function exportCompleteBackup(options: {
  activeAccountKey?: string | null;
  activeAccountLabel?: string | null;
  onProgress?: ProgressHandler;
} = {}): Promise<BackupArchiveExportResult> {
  const exportedAt = new Date().toISOString();
  const fileName = archiveFileName(exportedAt);
  emitProgress(options.onProgress, {
    phase: "preparing",
    message: "正在创建流式备份文件并枚举 WebDB 主键…",
    processedBytes: 0,
    totalBytes: null,
    processedRecords: 0,
    totalRecords: null,
  });
  const output = await createArchiveOutput(fileName);
  let completed = false;
  try {
    const [plan, nativeResult] = await Promise.all([
      prepareFullBackupArchiveStream(),
      exportNativeDatabaseBackup(),
    ]);
    const localStorageEntries = fullBackupArchiveInternals.exportLocalStorage();
    let nativeSqlite: unknown | null = null;
    if (nativeResult.supported) {
      if (!isRecord(nativeResult.backup)) {
        throw new Error("Android SQLite 导出返回 supported=true，但缺少备份内容");
      }
      nativeSqlite = fullBackupArchiveInternals.parseNativeSqliteBackup(nativeResult.backup);
      if (
        nativeResult.databaseName !== "kidindin_work_order_index.db" ||
        nativeRecordCount(nativeSqlite) !==
          (nativeResult.workOrderCount ?? 0) + (nativeResult.prefillHistoryCount ?? 0)
      ) {
        throw new Error("Android SQLite 导出名称或计数与备份内容不一致");
      }
    }

    const activeAccountKey = options.activeAccountKey?.trim() ?? "";
    const activeAccountLabel = options.activeAccountLabel?.trim() ?? "";
    if (activeAccountKey.length > 512 || activeAccountLabel.length > 512) {
      throw new Error("当前账号标识或名称超过 512 字符，无法备份");
    }
    const partitions = plan.partitions.map((partition) => ({
      databaseName: partition.databaseName,
      recordCount: partition.keys.length,
      storeName: partition.storeName,
    }));
    const header: ArchiveHeader = {
      accountHints: activeAccountKey
        ? [{ accountKey: activeAccountKey, current: true, label: activeAccountLabel }]
        : [],
      databases: plan.databases,
      exportedAt,
      kind: BACKUP_ARCHIVE_KIND,
      partitions,
      security: {
        authenticationCredentialsIncluded: false,
        note: "不包含 Token、Cookie、请求 Sign、密码、原生登录会话或临时缓存；本地签字和工单图片会逐条流式写入。",
      },
      source: {
        runtime: isNativeRuntime() ? "native" : "web",
        userAgent: navigator.userAgent,
      },
      totalRecordCount: plan.totalRecordCount,
      type: "header",
      version: BACKUP_ARCHIVE_VERSION,
    };

    const contentHasher = new IncrementalSha256();
    const fileHasher = new IncrementalSha256();
    let writtenBytes = 0;
    let contentLines = 0;
    const writeContentLine = async (value: unknown) => {
      const line = `${JSON.stringify(value)}\n`;
      const bytes = await writeTextInChunks(output, line, fileHasher, contentHasher);
      writtenBytes += bytes;
      contentLines += 1;
    };
    await writeContentLine(header);
    for (const entry of localStorageEntries) {
      await writeContentLine({ type: "local-storage", ...entry });
    }
    if (nativeSqlite !== null) {
      await writeContentLine({ backup: nativeSqlite, type: "native-sqlite" });
    }

    let processedRecords = 0;
    await streamFullBackupArchiveRecords(plan, async (databaseName, storeName, record) => {
      await writeContentLine({ databaseName, record, storeName, type: "record" });
      processedRecords += 1;
      emitProgress(options.onProgress, {
        phase: "exporting",
        message: `正在流式写入 ${databaseName}.${storeName}`,
        processedBytes: writtenBytes,
        totalBytes: null,
        processedRecords,
        totalRecords: plan.totalRecordCount,
      });
    });

    const footer: ArchiveFooter = {
      contentBytes: writtenBytes,
      contentLineCount: contentLines,
      contentSha256: contentHasher.digestHex(),
      databaseCount: plan.databases.length,
      indexedDbRecordCount: processedRecords,
      localStorageEntryCount: localStorageEntries.length,
      nativeSqliteRecordCount: nativeRecordCount(nativeSqlite),
      type: "footer",
    };
    emitProgress(options.onProgress, {
      phase: "finalizing",
      message: "正在写入完整性摘要并同步到存储设备…",
      processedBytes: writtenBytes,
      totalBytes: null,
      processedRecords,
      totalRecords: plan.totalRecordCount,
    });
    writtenBytes += await writeTextInChunks(
      output,
      `${JSON.stringify(footer)}\n`,
      fileHasher,
      null,
    );
    const saved = await output.finish(writtenBytes, fileHasher.digestHex());
    completed = true;
    emitProgress(options.onProgress, {
      phase: "completed",
      message: "流式完整备份已完成并通过大小及 SHA-256 校验",
      processedBytes: saved.size,
      totalBytes: saved.size,
      processedRecords,
      totalRecords: processedRecords,
    });
    return {
      ...saved,
      databaseCount: plan.databases.length,
      indexedDbRecordCount: processedRecords,
      localStorageEntryCount: localStorageEntries.length,
      nativeSqliteRecordCount: nativeRecordCount(nativeSqlite),
    };
  } catch (error) {
    throw new Error(errorMessage(error));
  } finally {
    if (!completed) await output.abort();
  }
}

function requestResult<T>(request: IDBRequest<T>, action: string) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`${action}失败：${request.error?.message || "IndexedDB 错误"}`));
  });
}

function transactionDone(transaction: IDBTransaction, action: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`${action}失败：${transaction.error?.message || "IndexedDB 错误"}`));
    transaction.onabort = () => reject(new Error(`${action}失败：${transaction.error?.message || "事务已中止"}`));
  });
}

function scratchDatabaseName(kind: "rollback" | "staging") {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `kidindin-backup-${kind}-${id}`;
}

function openScratchDatabase(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(SCRATCH_STORE, { keyPath: "id" });
      store.createIndex(SCRATCH_PARTITION_INDEX, "partition", { unique: false });
    };
    request.onerror = () => reject(new Error(`创建恢复暂存区失败：${request.error?.message || "IndexedDB 错误"}`));
    request.onblocked = () => reject(new Error("恢复暂存区被其他页面占用，请关闭其他 KiDinDin 页面后重试"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function deleteScratchDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`清理恢复暂存区失败：${request.error?.message || "IndexedDB 错误"}`));
    request.onblocked = () => reject(new Error("清理恢复暂存区被其他页面阻止"));
  });
}

function scratchId(databaseName: string, storeName: string, key: IDBValidKey) {
  return JSON.stringify([databaseName, storeName, key]);
}

function scratchPartition(databaseName: string, storeName: string) {
  return JSON.stringify([databaseName, storeName]);
}

async function mergeIntoStaging(database: IDBDatabase, record: ScratchRecord) {
  const transaction = database.transaction(SCRATCH_STORE, "readwrite");
  const done = transactionDone(transaction, "写入恢复暂存区");
  const store = transaction.objectStore(SCRATCH_STORE);
  const existing = await requestResult<ScratchRecord | undefined>(store.get(record.id), "读取恢复暂存记录");
  const next = existing
    ? {
        ...record,
        value: fullBackupArchiveInternals.mergeRestoredRecord(
          record.databaseName,
          existing.value,
          record.value,
        ),
      }
    : record;
  fullBackupArchiveInternals.validateDecodedRecord(
    next.databaseName,
    next.key,
    next.value,
    `${next.databaseName}.${next.storeName} 暂存合并结果`,
  );
  store.put(next);
  await done;
  return !existing;
}

async function putScratchRecord(database: IDBDatabase, record: ScratchRecord | RollbackRecord) {
  const transaction = database.transaction(SCRATCH_STORE, "readwrite");
  transaction.objectStore(SCRATCH_STORE).put(record);
  await transactionDone(transaction, "写入恢复回滚区");
}

async function getScratchRecord<T extends ScratchRecord>(database: IDBDatabase, id: string) {
  const transaction = database.transaction(SCRATCH_STORE, "readonly");
  const request = transaction.objectStore(SCRATCH_STORE).get(id);
  const [record] = await Promise.all([
    requestResult<T | undefined>(request, "读取恢复暂存区"),
    transactionDone(transaction, "读取恢复暂存区"),
  ]);
  return record;
}

async function scratchPartitionIds(database: IDBDatabase, partition: string) {
  const transaction = database.transaction(SCRATCH_STORE, "readonly");
  const request = transaction.objectStore(SCRATCH_STORE)
    .index(SCRATCH_PARTITION_INDEX)
    .getAllKeys(IDBKeyRange.only(partition));
  const [keys] = await Promise.all([
    requestResult<IDBValidKey[]>(request, "枚举恢复暂存区"),
    transactionDone(transaction, "枚举恢复暂存区"),
  ]);
  return keys.map((key) => {
    if (typeof key !== "string") throw new Error("恢复暂存区包含无效主键");
    return key;
  });
}

function parseArchiveHeader(value: Record<string, unknown>): ArchiveHeader {
  if (
    value.type !== "header" ||
    value.kind !== BACKUP_ARCHIVE_KIND ||
    value.version !== BACKUP_ARCHIVE_VERSION
  ) {
    throw new Error("不是受支持的 KiDinDin 流式完整备份");
  }
  const exportedAt = requireString(value.exportedAt, "header.exportedAt");
  if (Number.isNaN(Date.parse(exportedAt))) throw new Error("header.exportedAt 不是有效时间");
  if (!Array.isArray(value.databases) || value.databases.length > MAX_ARCHIVE_DATABASES) {
    throw new Error(`header.databases 不能超过 ${MAX_ARCHIVE_DATABASES} 个`);
  }
  const databaseNames = new Set<string>();
  const databases = value.databases.map((database, index) => {
    if (!isRecord(database)) throw new Error(`header.databases[${index}] 必须是对象`);
    const snapshot = database as FullBackupArchiveDatabase;
    if (databaseNames.has(snapshot.name)) throw new Error(`header.databases 包含重复数据库 ${snapshot.name}`);
    databaseNames.add(snapshot.name);
    if (!Array.isArray(snapshot.stores) || snapshot.stores.some((store) => !Array.isArray(store.records) || store.records.length)) {
      throw new Error(`header.databases[${index}] 只能包含空记录的数据结构`);
    }
    fullBackupArchiveInternals.assertDatabaseSchema(snapshot, `header.databases[${index}]`);
    return snapshot;
  });
  if (!Array.isArray(value.partitions)) throw new Error("header.partitions 必须是数组");
  const partitionKeys = new Set<string>();
  const partitions = value.partitions.map((partition, index) => {
    if (!isRecord(partition)) throw new Error(`header.partitions[${index}] 必须是对象`);
    const databaseName = requireString(partition.databaseName, `header.partitions[${index}].databaseName`);
    const storeName = requireString(partition.storeName, `header.partitions[${index}].storeName`);
    const recordCount = requireInteger(
      partition.recordCount,
      `header.partitions[${index}].recordCount`,
      MAX_ARCHIVE_RECORDS,
    );
    const database = databases.find((item) => item.name === databaseName);
    if (!database?.stores.some((store) => store.name === storeName)) {
      throw new Error(`header.partitions[${index}] 指向未登记的数据表`);
    }
    const key = scratchPartition(databaseName, storeName);
    if (partitionKeys.has(key)) throw new Error(`header.partitions 包含重复分区 ${databaseName}.${storeName}`);
    partitionKeys.add(key);
    return { databaseName, recordCount, storeName };
  });
  const expectedPartitions = databases.reduce((total, database) => total + database.stores.length, 0);
  if (partitions.length !== expectedPartitions) throw new Error("header.partitions 未覆盖全部 WebDB 数据表");
  const totalRecordCount = requireInteger(value.totalRecordCount, "header.totalRecordCount", MAX_ARCHIVE_RECORDS);
  if (partitions.reduce((total, partition) => total + partition.recordCount, 0) !== totalRecordCount) {
    throw new Error("header.totalRecordCount 与各 WebDB 分区计数不一致");
  }
  if (!Array.isArray(value.accountHints) || value.accountHints.length > 100) {
    throw new Error("header.accountHints 格式无效");
  }
  let currentHints = 0;
  const hintKeys = new Set<string>();
  const accountHints = value.accountHints.map((hint, index) => {
    if (!isRecord(hint)) throw new Error(`header.accountHints[${index}] 必须是对象`);
    const accountKey = requireString(hint.accountKey, `header.accountHints[${index}].accountKey`);
    const label = requireString(hint.label, `header.accountHints[${index}].label`, true);
    if (accountKey.length > 512 || label.length > 512 || typeof hint.current !== "boolean") {
      throw new Error(`header.accountHints[${index}] 字段无效`);
    }
    if (hintKeys.has(accountKey)) throw new Error(`header.accountHints 包含重复账号 ${accountKey}`);
    hintKeys.add(accountKey);
    if (hint.current) currentHints += 1;
    return { accountKey, current: hint.current, label };
  });
  if (currentHints > 1) throw new Error("header.accountHints 只能标记一个当前账号");
  if (!isRecord(value.security) || value.security.authenticationCredentialsIncluded !== false) {
    throw new Error("流式备份安全边界无效：凭据标记必须为 false");
  }
  const securityNote = requireString(value.security.note, "header.security.note", true);
  if (!isRecord(value.source) || (value.source.runtime !== "native" && value.source.runtime !== "web")) {
    throw new Error("header.source.runtime 无效");
  }
  const userAgent = requireString(value.source.userAgent, "header.source.userAgent", true);
  return {
    accountHints,
    databases,
    exportedAt,
    kind: BACKUP_ARCHIVE_KIND,
    partitions,
    security: { authenticationCredentialsIncluded: false, note: securityNote },
    source: { runtime: value.source.runtime, userAgent },
    totalRecordCount,
    type: "header",
    version: BACKUP_ARCHIVE_VERSION,
  };
}

function parseArchiveFooter(value: Record<string, unknown>): ArchiveFooter {
  const contentSha256 = requireString(value.contentSha256, "footer.contentSha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new Error("footer.contentSha256 格式无效");
  return {
    contentBytes: requireInteger(value.contentBytes, "footer.contentBytes"),
    contentLineCount: requireInteger(value.contentLineCount, "footer.contentLineCount", MAX_ARCHIVE_RECORDS + 3_000),
    contentSha256,
    databaseCount: requireInteger(value.databaseCount, "footer.databaseCount", MAX_ARCHIVE_DATABASES),
    indexedDbRecordCount: requireInteger(value.indexedDbRecordCount, "footer.indexedDbRecordCount", MAX_ARCHIVE_RECORDS),
    localStorageEntryCount: requireInteger(
      value.localStorageEntryCount,
      "footer.localStorageEntryCount",
      MAX_ARCHIVE_LOCAL_STORAGE_ENTRIES,
    ),
    nativeSqliteRecordCount: requireInteger(value.nativeSqliteRecordCount, "footer.nativeSqliteRecordCount", 400_000),
    type: "footer",
  };
}

function normalizedMapping(mapping: Record<string, string> | undefined) {
  const result = new Map<string, string>();
  for (const [sourceValue, targetValue] of Object.entries(mapping ?? {})) {
    const source = sourceValue.trim();
    const target = targetValue.trim();
    if (!source || !target || source.length > 512 || target.length > 512) {
      throw new Error("账号映射来源和目标必须是 512 字符以内的非空标识");
    }
    if (source !== target) result.set(source, target);
  }
  return result;
}

async function parseArchiveFile(
  file: File,
  options: {
    mapping?: ReadonlyMap<string, string>;
    onProgress?: ProgressHandler;
    staging?: IDBDatabase;
  },
): Promise<ArchiveParsed> {
  let header: ArchiveHeader | null = null;
  let footer: ArchiveFooter | null = null;
  let localStorageEntries: FullBackupArchiveLocalStorageEntry[] = [];
  let nativeSqlite: unknown | null = null;
  let nativeLineSeen = false;
  let indexedDbRecordCount = 0;
  let stagedRecordCount = 0;
  let contentBytes = 0;
  let contentLineCount = 0;
  let bytesRead = 0;
  const localKeys = new Set<string>();
  const originalRecordIds = new Set<string>();
  const partitionCounts = new Map<string, number>();
  const accountKeys = new Set<string>();
  const contentHasher = new IncrementalSha256();
  let lastProgressAt = 0;
  const report = (message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 80) return;
    lastProgressAt = now;
    emitProgress(options.onProgress, {
      phase: options.staging ? "staging" : "validating",
      message,
      processedBytes: bytesRead,
      totalBytes: file.size,
      processedRecords: indexedDbRecordCount,
      totalRecords: header?.totalRecordCount ?? null,
    });
  };

  for await (const item of readUtf8Lines(file, {
    maxLineBytes: MAX_ARCHIVE_LINE_BYTES,
    onBytesRead: (value) => {
      bytesRead = value;
      report(options.staging ? "正在流式读取并写入校验暂存区…" : "正在流式读取并校验备份…");
    },
  })) {
    const line = typeof item === "string" ? item : item.line;
    if (!line.trim()) throw new Error("流式备份不能包含空行");
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`流式备份第 ${contentLineCount + 1} 行 JSON 无效：${errorMessage(error)}`);
    }
    if (!isRecord(parsed)) throw new Error("流式备份每一行都必须是对象");
    if (footer) throw new Error("流式备份 footer 后仍包含额外内容");
    if (parsed.type === "footer") {
      footer = parseArchiveFooter(parsed);
      if (!header) throw new Error("流式备份缺少 header");
      if (footer.contentBytes !== contentBytes || footer.contentLineCount !== contentLineCount) {
        throw new Error("流式备份内容字节数或行数与 footer 不一致");
      }
      if (footer.contentSha256 !== contentHasher.digestHex()) {
        throw new Error("流式备份 SHA-256 完整性校验失败，文件可能损坏或不完整");
      }
      continue;
    }

    const rawLine = `${line}\n`;
    contentHasher.update(rawLine);
    contentBytes += utf8ByteLength(rawLine);
    contentLineCount += 1;
    if (!header) {
      header = parseArchiveHeader(parsed);
      header.accountHints.forEach((hint) => accountKeys.add(hint.accountKey));
      continue;
    }

    if (parsed.type === "local-storage") {
      if (indexedDbRecordCount || nativeLineSeen) {
        throw new Error("local-storage 行必须位于 native-sqlite 和 WebDB 记录之前");
      }
      if (localStorageEntries.length >= MAX_ARCHIVE_LOCAL_STORAGE_ENTRIES) {
        throw new Error(`流式备份偏好不能超过 ${MAX_ARCHIVE_LOCAL_STORAGE_ENTRIES} 项`);
      }
      const key = requireString(parsed.key, "local-storage.key");
      const value = requireString(parsed.value, "local-storage.value", true);
      if (!fullBackupArchiveInternals.shouldIncludeLocalStorageKey(key)) {
        throw new Error(`local-storage.key ${key} 不属于可恢复的安全应用偏好`);
      }
      if (localKeys.has(key)) throw new Error(`流式备份包含重复偏好 ${key}`);
      localKeys.add(key);
      fullBackupArchiveInternals.validateLocalStorageValue(key, value, `localStorage.${key}`);
      localStorageEntries.push({ key, value });
      continue;
    }
    if (parsed.type === "native-sqlite") {
      if (nativeLineSeen || indexedDbRecordCount) {
        throw new Error("native-sqlite 行重复或位于 WebDB 记录之后");
      }
      nativeLineSeen = true;
      nativeSqlite = fullBackupArchiveInternals.parseNativeSqliteBackup(parsed.backup);
      continue;
    }
    if (parsed.type !== "record") throw new Error(`流式备份包含未知行类型 ${String(parsed.type)}`);
    if (indexedDbRecordCount >= header.totalRecordCount) {
      throw new Error("流式备份 WebDB 记录数超过 header 声明");
    }
    const databaseName = requireString(parsed.databaseName, "record.databaseName");
    const storeName = requireString(parsed.storeName, "record.storeName");
    if (!isRecord(parsed.record) || !("key" in parsed.record) || !("value" in parsed.record)) {
      throw new Error("record.record 缺少 key 或 value");
    }
    const database = header.databases.find((item) => item.name === databaseName);
    const partition = header.partitions.find(
      (item) => item.databaseName === databaseName && item.storeName === storeName,
    );
    if (!database || !partition) throw new Error(`record 指向未登记分区 ${databaseName}.${storeName}`);
    const currentPartitionCount = (partitionCounts.get(scratchPartition(databaseName, storeName)) ?? 0) + 1;
    if (currentPartitionCount > partition.recordCount) {
      throw new Error(`${databaseName}.${storeName} 记录数超过 header 声明`);
    }
    partitionCounts.set(scratchPartition(databaseName, storeName), currentPartitionCount);
    const encodedRecord = parsed.record as FullBackupArchiveRecord;
    const originalDecoded = decodeFullBackupArchiveRecord(database, storeName, encodedRecord);
    const originalId = scratchId(databaseName, storeName, originalDecoded.key);
    if (originalRecordIds.has(originalId)) throw new Error(`${databaseName}.${storeName} 包含重复主键`);
    originalRecordIds.add(originalId);
    if (isRecord(originalDecoded.value) && typeof originalDecoded.value.accountKey === "string") {
      accountKeys.add(originalDecoded.value.accountKey);
    }
    const decoded = options.mapping?.size
      ? decodeFullBackupArchiveRecord(database, storeName, encodedRecord, options.mapping)
      : originalDecoded;
    if (options.staging) {
      const staged: ScratchRecord = {
        databaseName,
        id: scratchId(databaseName, storeName, decoded.key),
        key: decoded.key,
        partition: scratchPartition(databaseName, storeName),
        storeName,
        value: decoded.value,
      };
      if (await mergeIntoStaging(options.staging, staged)) stagedRecordCount += 1;
    }
    indexedDbRecordCount += 1;
    report(`已校验 ${databaseName}.${storeName} ${indexedDbRecordCount.toLocaleString("zh-CN")} 条`, true);
  }

  if (!header || !footer) throw new Error("流式备份缺少 header 或 footer，文件可能未完整写入");
  if (indexedDbRecordCount !== header.totalRecordCount) {
    throw new Error("流式备份 WebDB 记录总数与 header 不一致");
  }
  for (const partition of header.partitions) {
    if ((partitionCounts.get(scratchPartition(partition.databaseName, partition.storeName)) ?? 0) !== partition.recordCount) {
      throw new Error(`${partition.databaseName}.${partition.storeName} 记录数与 header 不一致`);
    }
  }
  const nativeSqliteRecordCount = nativeRecordCount(nativeSqlite);
  if (
    footer.databaseCount !== header.databases.length ||
    footer.indexedDbRecordCount !== indexedDbRecordCount ||
    footer.localStorageEntryCount !== localStorageEntries.length ||
    footer.nativeSqliteRecordCount !== nativeSqliteRecordCount
  ) {
    throw new Error("流式备份 footer 汇总与实际内容不一致");
  }
  if (isRecord(nativeSqlite) && isRecord(nativeSqlite.tables)) {
    for (const tableName of ["workOrderIndex", "residentSecurityPrefillHistory"]) {
      const rows = nativeSqlite.tables[tableName];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row) => {
        if (isRecord(row) && typeof row.accountKey === "string" && row.accountKey.trim()) {
          accountKeys.add(row.accountKey);
        }
      });
    }
  }
  let nativeSqliteCanRestore = true;
  if (nativeSqlite !== null) {
    const validation = await validateNativeDatabaseBackup(JSON.stringify(nativeSqlite));
    nativeSqliteCanRestore = validation.supported && validation.valid &&
      (validation.workOrderCount ?? 0) + (validation.prefillHistoryCount ?? 0) === nativeSqliteRecordCount;
  }
  report("流式备份结构、记录和完整性摘要均已校验", true);
  return {
    accountKeys: Array.from(accountKeys).sort(),
    header,
    localStorage: localStorageEntries,
    nativeSqlite,
    nativeSqliteCanRestore,
    nativeSqliteRecordCount,
    stagedRecordCount,
  };
}

async function backupFileFormat(file: File) {
  const prefix = await file.slice(0, Math.min(file.size, 256 * 1024)).text();
  const firstLineEnd = prefix.indexOf("\n");
  if (firstLineEnd >= 0) {
    try {
      const first: unknown = JSON.parse(prefix.slice(0, firstLineEnd));
      if (isRecord(first) && first.type === "header" && first.kind === BACKUP_ARCHIVE_KIND) {
        return "archive" as const;
      }
    } catch {
      // The full parser below provides the actionable error for malformed files.
    }
  }
  return "legacy-json" as const;
}

export async function inspectCompleteBackupFile(
  file: File,
  options: { onProgress?: ProgressHandler } = {},
): Promise<BackupArchiveInspection> {
  if (!file.size) throw new Error("备份文件为空");
  emitProgress(options.onProgress, {
    phase: "reading",
    message: "正在识别备份格式…",
    processedBytes: 0,
    totalBytes: file.size,
    processedRecords: 0,
    totalRecords: null,
  });
  const format = await backupFileFormat(file);
  if (format === "legacy-json") {
    if (file.size > MAX_FULL_BACKUP_FILE_BYTES) {
      throw new Error("该文件不是流式备份，且超过旧版 JSON 的 96MB 安全读取上限");
    }
    const payload = await file.text();
    const inspection = await inspectFullBackup(payload);
    emitProgress(options.onProgress, {
      phase: "completed",
      message: "旧版 JSON 完整备份校验完成",
      processedBytes: file.size,
      totalBytes: file.size,
      processedRecords: inspection.indexedDbRecordCount,
      totalRecords: inspection.indexedDbRecordCount,
    });
    return { ...inspection, format };
  }
  const parsed = await parseArchiveFile(file, { onProgress: options.onProgress });
  const source = parsed.header.accountHints.find((hint) => hint.current) ?? null;
  return {
    accountKeys: parsed.accountKeys,
    databaseCount: parsed.header.databases.length,
    format,
    historyAccountKeys: parsed.accountKeys.filter((key) => key.startsWith("history:")),
    indexedDbRecordCount: parsed.header.totalRecordCount,
    localStorageEntryCount: parsed.localStorage.length,
    nativeSqliteCanRestore: parsed.nativeSqliteCanRestore,
    nativeSqlitePresent: parsed.nativeSqlite !== null,
    nativeSqliteRecordCount: parsed.nativeSqliteRecordCount,
    sourceAccountKey: source?.accountKey ?? null,
    sourceAccountLabel: source?.label ?? null,
  };
}

async function readLiveRecord(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  const transaction = database.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).get(key);
  const [value] = await Promise.all([
    requestResult<unknown>(request, `读取 ${database.name}.${storeName}`),
    transactionDone(transaction, `读取 ${database.name}.${storeName}`),
  ]);
  return value;
}

async function writeLiveRecord(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
  remove: boolean,
) {
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  if (remove) store.delete(key);
  else if (store.keyPath === null) store.put(value, key);
  else store.put(value);
  await transactionDone(transaction, `${remove ? "删除" : "写入"} ${database.name}.${storeName}`);
}

async function applyStagedWebDatabases(
  parsed: ArchiveParsed,
  staging: IDBDatabase,
  rollback: IDBDatabase,
  onProgress: ProgressHandler | undefined,
) {
  for (const snapshot of parsed.header.databases) {
    await fullBackupArchiveInternals.databaseExistsAndMatches(snapshot);
  }
  const liveDatabases = new Map<string, IDBDatabase>();
  const appliedIds: string[] = [];
  try {
    for (const snapshot of parsed.header.databases) {
      liveDatabases.set(
        snapshot.name,
        await fullBackupArchiveInternals.openDatabaseForRestore(snapshot),
      );
    }
    for (const partition of parsed.header.partitions) {
      const ids = await scratchPartitionIds(
        staging,
        scratchPartition(partition.databaseName, partition.storeName),
      );
      for (const id of ids) {
        const staged = await getScratchRecord<ScratchRecord>(staging, id);
        if (!staged) throw new Error(`恢复暂存记录 ${id} 丢失`);
        const live = liveDatabases.get(staged.databaseName);
        if (!live) throw new Error(`未打开目标 WebDB ${staged.databaseName}`);
        const previousValue = await readLiveRecord(live, staged.storeName, staged.key);
        const nextValue = fullBackupArchiveInternals.mergeRestoredRecord(
          staged.databaseName,
          previousValue,
          staged.value,
        );
        fullBackupArchiveInternals.validateDecodedRecord(
          staged.databaseName,
          staged.key,
          nextValue,
          `${staged.databaseName}.${staged.storeName} 最终合并结果`,
        );
        await putScratchRecord(rollback, {
          ...staged,
          previousExists: previousValue !== undefined,
          value: previousValue,
        });
        await writeLiveRecord(live, staged.storeName, staged.key, nextValue, false);
        appliedIds.push(id);
        emitProgress(onProgress, {
          phase: "restoring",
          message: `正在合并 ${staged.databaseName}.${staged.storeName}`,
          processedBytes: 0,
          totalBytes: null,
          processedRecords: appliedIds.length,
          totalRecords: parsed.stagedRecordCount,
        });
      }
    }
    return { appliedIds, liveDatabases };
  } catch (error) {
    return Promise.reject(Object.assign(new Error(errorMessage(error)), { appliedIds, liveDatabases }));
  }
}

async function rollbackAppliedWebDatabases(
  appliedIds: string[],
  rollback: IDBDatabase,
  liveDatabases: Map<string, IDBDatabase>,
  onProgress: ProgressHandler | undefined,
) {
  const failures: string[] = [];
  for (let index = appliedIds.length - 1; index >= 0; index -= 1) {
    const id = appliedIds[index];
    try {
      const record = await getScratchRecord<RollbackRecord>(rollback, id);
      if (!record) throw new Error(`回滚记录 ${id} 丢失`);
      const live = liveDatabases.get(record.databaseName);
      if (!live) throw new Error(`目标 WebDB ${record.databaseName} 已关闭`);
      await writeLiveRecord(
        live,
        record.storeName,
        record.key,
        record.value,
        !record.previousExists,
      );
    } catch (error) {
      failures.push(errorMessage(error));
    }
    emitProgress(onProgress, {
      phase: "rolling-back",
      message: "恢复失败，正在按相反顺序还原已写入的 WebDB 记录…",
      processedBytes: 0,
      totalBytes: null,
      processedRecords: appliedIds.length - index,
      totalRecords: appliedIds.length,
    });
  }
  return failures;
}

export async function restoreCompleteBackupFile(
  file: File,
  options: {
    accountKeyMapping?: Record<string, string>;
    onProgress?: ProgressHandler;
  } = {},
): Promise<BackupArchiveRestoreResult> {
  const format = await backupFileFormat(file);
  if (format === "legacy-json") {
    if (file.size > MAX_FULL_BACKUP_FILE_BYTES) {
      throw new Error("该文件不是流式备份，且超过旧版 JSON 的 96MB 安全读取上限");
    }
    const payload = await file.text();
    const restored = await restoreFullBackup(payload, {
      accountKeyMapping: options.accountKeyMapping,
    });
    return { ...restored, rolledBack: false };
  }

  const mapping = normalizedMapping(options.accountKeyMapping);
  const stagingName = scratchDatabaseName("staging");
  const rollbackName = scratchDatabaseName("rollback");
  let staging: IDBDatabase | null = null;
  let rollback: IDBDatabase | null = null;
  let parsed: ArchiveParsed | null = null;
  let localPrepared: ReturnType<typeof fullBackupArchiveInternals.prepareLocalStorageRestore> | null = null;
  let localAttempted = false;
  let appliedIds: string[] = [];
  let liveDatabases = new Map<string, IDBDatabase>();
  try {
    staging = await openScratchDatabase(stagingName);
    parsed = await parseArchiveFile(file, {
      mapping,
      onProgress: options.onProgress,
      staging,
    });
    if (parsed.nativeSqlite !== null && !parsed.nativeSqliteCanRestore) {
      throw new Error("该备份包含 Android SQLite 数据，当前环境无法完整恢复；请在 KiDinDin Android 应用中导入");
    }
    const mappedLocalStorage = fullBackupArchiveInternals.remapLocalStorageEntries(
      parsed.localStorage,
      mapping,
    );
    const mappedNative = fullBackupArchiveInternals.remapNativeSqlite(parsed.nativeSqlite, mapping);
    localPrepared = fullBackupArchiveInternals.prepareLocalStorageRestore(mappedLocalStorage);
    if (mappedNative !== null) {
      const validation = await validateNativeDatabaseBackup(JSON.stringify(mappedNative));
      if (!validation.supported || !validation.valid) {
        throw new Error("账号映射后的 Android SQLite 备份未通过原生预检");
      }
    }

    rollback = await openScratchDatabase(rollbackName);
    try {
      const applied = await applyStagedWebDatabases(parsed, staging, rollback, options.onProgress);
      appliedIds = applied.appliedIds;
      liveDatabases = applied.liveDatabases;
    } catch (error) {
      const enriched = error as Error & {
        appliedIds?: string[];
        liveDatabases?: Map<string, IDBDatabase>;
      };
      appliedIds = enriched.appliedIds ?? appliedIds;
      liveDatabases = enriched.liveDatabases ?? liveDatabases;
      throw error;
    }

    localAttempted = true;
    fullBackupArchiveInternals.writePreparedLocalStorage(localPrepared, false);
    let nativeSqlite: NativeDatabaseImportResult | null = null;
    if (mappedNative !== null) {
      nativeSqlite = await importNativeDatabaseBackup(JSON.stringify(mappedNative));
      if (!nativeSqlite.supported) throw new Error("Android SQLite 导入未返回受支持结果");
    }
    emitProgress(options.onProgress, {
      phase: "completed",
      message: "流式完整备份已恢复",
      processedBytes: file.size,
      totalBytes: file.size,
      processedRecords: parsed.header.totalRecordCount,
      totalRecords: parsed.header.totalRecordCount,
    });
    return {
      databaseCount: parsed.header.databases.length,
      indexedDbRecordCount: parsed.header.totalRecordCount,
      localStorageEntryCount: parsed.localStorage.length,
      nativeSqlite,
      nativeSqliteRecordCount: parsed.nativeSqliteRecordCount,
      rolledBack: false,
    };
  } catch (error) {
    const failures: string[] = [];
    if (localAttempted && localPrepared) {
      try {
        fullBackupArchiveInternals.writePreparedLocalStorage(localPrepared, true);
      } catch (rollbackError) {
        failures.push(errorMessage(rollbackError));
      }
    }
    if (rollback && appliedIds.length) {
      failures.push(...await rollbackAppliedWebDatabases(
        appliedIds,
        rollback,
        liveDatabases,
        options.onProgress,
      ));
    }
    const reason = errorMessage(error);
    if (!appliedIds.length && !localAttempted) {
      throw new Error(`流式备份校验或暂存失败：${reason}；尚未写入正式 WebDB、偏好或 SQLite`);
    }
    if (failures.length) {
      throw new Error(`完整恢复失败：${reason}；以下分区未能回滚：${failures.join("；")}`);
    }
    throw new Error(`完整恢复失败：${reason}；本次 WebDB 与偏好写入已回滚`);
  } finally {
    liveDatabases.forEach((database) => database.close());
    staging?.close();
    rollback?.close();
    await deleteScratchDatabase(stagingName).catch(() => undefined);
    await deleteScratchDatabase(rollbackName).catch(() => undefined);
  }
}
