/**
 * 备份历史记录存储服务
 * 用于跟踪备份操作历史、统计数据和趋势分析
 */

const BACKUP_HISTORY_KEY = "kidindin.backup-history.v1";
const MAX_HISTORY_ENTRIES = 50;

export type BackupHistoryEntry = {
  id: string;
  timestamp: number;
  type: "export" | "restore" | "inspect";
  success: boolean;
  size: number;
  databaseCount: number;
  indexedDbRecordCount: number;
  nativeSqliteRecordCount: number;
  localStorageEntryCount: number;
  duration: number; // 毫秒
  compression?: {
    enabled: boolean;
    originalSize: number;
    compressedSize: number;
    ratio: number; // 压缩率
  };
  error?: string;
  fileName?: string;
  method?: "browser" | "native";
};

export type BackupStats = {
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalDataSize: number;
  averageSize: number;
  largestBackup: number;
  smallestBackup: number;
  totalRecords: number;
  averageCompressionRatio: number;
  lastBackupTime: number | null;
  lastSuccessfulBackupTime: number | null;
};

class BackupHistoryStore {
  private getHistory(): BackupHistoryEntry[] {
    try {
      const stored = localStorage.getItem(BACKUP_HISTORY_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveHistory(history: BackupHistoryEntry[]): void {
    try {
      // 只保留最新的 MAX_HISTORY_ENTRIES 条记录
      const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
      localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error("保存备份历史失败:", error);
    }
  }

  addEntry(entry: Omit<BackupHistoryEntry, "id" | "timestamp">): void {
    const history = this.getHistory();
    const newEntry: BackupHistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };
    history.push(newEntry);
    this.saveHistory(history);
  }

  getRecentHistory(limit: number = 10): BackupHistoryEntry[] {
    const history = this.getHistory();
    return history.slice(-limit).reverse();
  }

  getAllHistory(): BackupHistoryEntry[] {
    return this.getHistory().reverse();
  }

  getStats(): BackupStats {
    const history = this.getHistory();
    const exportHistory = history.filter((entry) => entry.type === "export");

    if (exportHistory.length === 0) {
      return {
        totalBackups: 0,
        successfulBackups: 0,
        failedBackups: 0,
        totalDataSize: 0,
        averageSize: 0,
        largestBackup: 0,
        smallestBackup: 0,
        totalRecords: 0,
        averageCompressionRatio: 0,
        lastBackupTime: null,
        lastSuccessfulBackupTime: null,
      };
    }

    const successfulExports = exportHistory.filter((entry) => entry.success);
    const sizes = exportHistory.map((entry) => entry.size).filter((size) => size > 0);
    const compressedEntries = exportHistory.filter(
      (entry) => entry.compression?.enabled && entry.compression.ratio > 0
    );

    return {
      totalBackups: exportHistory.length,
      successfulBackups: successfulExports.length,
      failedBackups: exportHistory.length - successfulExports.length,
      totalDataSize: sizes.reduce((sum, size) => sum + size, 0),
      averageSize: sizes.length > 0 ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : 0,
      largestBackup: sizes.length > 0 ? Math.max(...sizes) : 0,
      smallestBackup: sizes.length > 0 ? Math.min(...sizes) : 0,
      totalRecords: exportHistory.reduce(
        (sum, entry) =>
          sum + entry.indexedDbRecordCount + entry.nativeSqliteRecordCount + entry.localStorageEntryCount,
        0
      ),
      averageCompressionRatio:
        compressedEntries.length > 0
          ? compressedEntries.reduce((sum, entry) => sum + (entry.compression?.ratio ?? 0), 0) /
            compressedEntries.length
          : 0,
      lastBackupTime: exportHistory.length > 0 ? exportHistory[exportHistory.length - 1].timestamp : null,
      lastSuccessfulBackupTime:
        successfulExports.length > 0
          ? successfulExports[successfulExports.length - 1].timestamp
          : null,
    };
  }

  getTimeSeriesData(days: number = 30): Array<{ date: string; count: number; size: number }> {
    const history = this.getHistory();
    const now = Date.now();
    const startTime = now - days * 24 * 60 * 60 * 1000;

    const dailyData = new Map<string, { count: number; size: number }>();

    history
      .filter((entry) => entry.type === "export" && entry.success && entry.timestamp >= startTime)
      .forEach((entry) => {
        const date = new Date(entry.timestamp).toISOString().split("T")[0];
        const current = dailyData.get(date) || { count: 0, size: 0 };
        dailyData.set(date, {
          count: current.count + 1,
          size: current.size + entry.size,
        });
      });

    // 填充缺失的日期
    const result: Array<{ date: string; count: number; size: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const data = dailyData.get(date) || { count: 0, size: 0 };
      result.push({ date, ...data });
    }

    return result;
  }

  clear(): void {
    localStorage.removeItem(BACKUP_HISTORY_KEY);
  }
}

export const backupHistoryStore = new BackupHistoryStore();
