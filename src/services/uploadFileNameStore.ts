const DATABASE_NAME = "kidindin-upload-file-names";
const DATABASE_VERSION = 1;
const STORE_NAME = "usedUploadFileNames";
const GENERATED_AT_INDEX = "generatedAt";
const RANDOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_GENERATION_ATTEMPTS = 100;

type UsedUploadFileName = {
  name: string;
  generatedAt: string;
  sourceName: string;
  sourceSize: number;
  sourceLastModified: number;
};

let generationSequence = 0;

function databaseError(action: string, error: unknown) {
  const detail = error instanceof Error && error.message ? `：${error.message}` : "";
  return new Error(`${action}失败${detail}`);
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法保证上传图片名称永久不重复"));
      return;
    }

    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction?.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "name" });
        if (!store) throw new Error("无法创建已用图片名称数据表");
        if (!store.indexNames.contains(GENERATED_AT_INDEX)) {
          store.createIndex(GENERATED_AT_INDEX, "generatedAt", { unique: false });
        }
      } catch (error) {
        request.transaction?.abort();
        if (!settled) {
          settled = true;
          reject(databaseError("初始化图片名称数据库", error));
        }
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(databaseError("打开图片名称数据库", request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("图片名称数据库升级被其他页面阻止，请关闭其他 KiDinDin 页面后重试"));
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

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function mixedRandomCode(length: number, file: File) {
  generationSequence += 1;
  const secureRandom = randomBytes(32);
  const runtimeEntropy = new TextEncoder().encode([
    Date.now(),
    typeof performance === "undefined" ? 0 : performance.now(),
    generationSequence,
    file.name,
    file.size,
    file.lastModified,
    typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "",
  ].join("|"));
  const mixed = new Uint8Array(secureRandom.length + runtimeEntropy.length);
  mixed.set(secureRandom);
  mixed.set(runtimeEntropy, secureRandom.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", mixed));
  return Array.from(digest.slice(0, length), (value) => RANDOM_ALPHABET[value % RANDOM_ALPHABET.length]).join("");
}

async function buildCandidate(file: File, date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const [featureCode, selfRandomCode] = await Promise.all([
    mixedRandomCode(6, file),
    mixedRandomCode(3, file),
  ]);
  return `IMG_${year}${featureCode}${month}${selfRandomCode}${day}.jpg`;
}

function tryReserveName(database: IDBDatabase, record: UsedUploadFileName) {
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).add(record);
    let collision = false;

    request.onerror = (event) => {
      if (request.error?.name !== "ConstraintError") return;
      collision = true;
      event.preventDefault();
      event.stopPropagation();
    };
    transaction.oncomplete = () => resolve(!collision);
    transaction.onerror = () => reject(databaseError("记录已用图片名称", transaction.error ?? request.error));
    transaction.onabort = () => reject(databaseError("记录已用图片名称", transaction.error ?? request.error));
  });
}

export async function reserveUniqueUploadFileName(file: File, date = new Date()) {
  const database = await openDatabase();
  try {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const name = await buildCandidate(file, date);
      const reserved = await tryReserveName(database, {
        name,
        generatedAt: new Date().toISOString(),
        sourceName: file.name,
        sourceSize: file.size,
        sourceLastModified: file.lastModified,
      });
      if (reserved) return name;
    }
  } finally {
    database.close();
  }
  throw new Error("连续生成图片名称均发生冲突，已停止上传以避免名称重复");
}
