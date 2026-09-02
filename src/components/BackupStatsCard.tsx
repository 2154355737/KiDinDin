import { Icon } from "./Icon";
import { formatBytes, formatCompressionRatio } from "../services/backupCompression";
import type { BackupStats } from "../services/backupHistoryStore";

export type BackupStatsCardProps = {
  stats: BackupStats;
};

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "从未备份";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}

export function BackupStatsCard({ stats }: BackupStatsCardProps) {
  const successRate = stats.totalBackups > 0
    ? ((stats.successfulBackups / stats.totalBackups) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="backup-stats-card">
      <div className="backup-stats-header">
        <Icon name="bar-chart" size={20} />
        <h3>备份统计</h3>
      </div>

      <div className="backup-stats-grid">
        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="database" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>总备份次数</small>
            <strong>{stats.totalBackups}</strong>
          </div>
        </div>

        <div className="backup-stat-item success">
          <div className="backup-stat-icon">
            <Icon name="check-circle" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>成功率</small>
            <strong>{successRate}%</strong>
          </div>
        </div>

        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="hard-drive" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>总数据量</small>
            <strong>{formatBytes(stats.totalDataSize)}</strong>
          </div>
        </div>

        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="file" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>平均大小</small>
            <strong>{formatBytes(stats.averageSize)}</strong>
          </div>
        </div>

        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="archive" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>最大备份</small>
            <strong>{formatBytes(stats.largestBackup)}</strong>
          </div>
        </div>

        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="list" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>总记录数</small>
            <strong>{stats.totalRecords.toLocaleString("zh-CN")}</strong>
          </div>
        </div>

        {stats.averageCompressionRatio > 0 && (
          <div className="backup-stat-item compression">
            <div className="backup-stat-icon">
              <Icon name="package" size={18} />
            </div>
            <div className="backup-stat-content">
              <small>平均压缩率</small>
              <strong>{formatCompressionRatio(stats.averageCompressionRatio)}</strong>
            </div>
          </div>
        )}

        <div className="backup-stat-item">
          <div className="backup-stat-icon">
            <Icon name="clock" size={18} />
          </div>
          <div className="backup-stat-content">
            <small>最后备份</small>
            <strong>{formatTime(stats.lastSuccessfulBackupTime)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
