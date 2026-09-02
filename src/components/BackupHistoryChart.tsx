import { useMemo } from "react";
import { formatBytes } from "../services/backupCompression";

export type BackupHistoryChartProps = {
  data: Array<{ date: string; count: number; size: number }>;
  metric: "count" | "size";
};

export function BackupHistoryChart({ data, metric }: BackupHistoryChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return { bars: [], max: 0, labels: [] };

    const values = data.map((item) => (metric === "count" ? item.count : item.size));
    const max = Math.max(...values, 1);

    const bars = values.map((value) => ({
      height: (value / max) * 100,
      value,
    }));

    const labels = data.map((item) => {
      const date = new Date(item.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    return { bars, max, labels };
  }, [data, metric]);

  const formatValue = (value: number) => {
    if (metric === "count") return `${value} 次`;
    return formatBytes(value);
  };

  if (data.length === 0) {
    return (
      <div className="backup-history-chart empty">
        <p>暂无备份历史数据</p>
      </div>
    );
  }

  return (
    <div className="backup-history-chart">
      <div className="backup-chart-header">
        <h4>{metric === "count" ? "备份次数趋势" : "备份数据量趋势"}</h4>
        <span className="backup-chart-period">最近 30 天</span>
      </div>

      <div className="backup-chart-container">
        <div className="backup-chart-bars">
          {chartData.bars.map((bar, index) => (
            <div key={index} className="backup-chart-bar-wrapper">
              <div
                className="backup-chart-bar"
                style={{ height: `${bar.height}%` }}
                title={`${chartData.labels[index]}: ${formatValue(bar.value)}`}
              >
                {bar.value > 0 && <span className="backup-chart-bar-value">{bar.value}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="backup-chart-labels">
          {chartData.labels.map((label, index) => (
            <div
              key={index}
              className="backup-chart-label"
              style={{ display: index % 5 === 0 ? "block" : "none" }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="backup-chart-legend">
        <span>最大值: {formatValue(chartData.max)}</span>
      </div>
    </div>
  );
}
