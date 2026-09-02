import { useCallback, useEffect, useState } from "react";
import { Pie } from "@ant-design/charts";
import { Alert, Button, Card, Empty, Modal, Progress, Statistic } from "antd";
import { DeleteOutlined, PieChartOutlined, ReloadOutlined } from "@ant-design/icons";
import { Icon } from "../components/Icon";
import type { WorkOrder } from "../types/workOrder";
import {
  clearCompletedOrderPrefills,
  getStorageOverview,
  type StorageOverview,
} from "../services/storageMaintenance";
import "../styles/pages/storage-management.css";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function StorageManagementPage({ accountKey, orders, onPrefillsCleared, onBack }: { accountKey: string | null; orders: readonly WorkOrder[]; onPrefillsCleared: (woHeaderIds: string[]) => void; onBack: () => void }) {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!accountKey) {
      setOverview(null);
      setLoading(false);
      setMessage("请先登录后查看本机存储。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      setOverview(await getStorageOverview(accountKey, orders.filter((order) => order.status === "已完成" || order.status === "已结束").map((order) => order.woHeaderId)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取本机存储失败");
    } finally {
      setLoading(false);
    }
  }, [accountKey, orders]);

  useEffect(() => { void load(); }, [load]);

  const clean = async () => {
    setConfirmOpen(false);
    setCleaning(true);
    setMessage("");
    try {
      const completedIds = orders.filter((order) => order.status === "已完成" || order.status === "已结束").map((order) => order.woHeaderId);
      const result = await clearCompletedOrderPrefills(accountKey ?? "", completedIds);
      onPrefillsCleared(result.clearedHeaderIds);
      setMessage(result.clearedHeaderIds.length ? `已清理 ${result.count} 张预存照片，释放 ${formatBytes(result.bytes)}；同步移除 ${result.markerCount} 项预填标记。` : "没有已完成或已结束工单的预存资料可清理。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理缓存失败");
    } finally {
      setCleaning(false);
    }
  };

  const chartData = overview?.usage.filter((item) => item.bytes > 0) ?? [];

  return <main className="storage-management-page">
    <header className="topbar more-page-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回" style={{ transform: "rotate(180deg)" }}><Icon name="chevron" /></button>
      <h1>存储管理</h1>
      <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} aria-label="刷新存储数据" />
    </header>

    <Card className="storage-hero" bordered={false}>
      <Statistic title="已统计本地媒体" value={formatBytes(overview?.totalBytes ?? 0)} prefix={<PieChartOutlined />} />
      <p>仅统计门头照片、离线签字和本地图片预览。</p>
    </Card>

    <Card className="storage-card" title="占用分布" size="small" loading={loading}>
      {chartData.length ? <div className="storage-chart-wrap">
        <Pie
          data={chartData}
          angleField="bytes"
          colorField="category"
          height={220}
          innerRadius={0.62}
          theme={document.documentElement.dataset.theme === "dark" ? "classicDark" : "classic"}
          legend={{ color: { position: "bottom", layout: "horizontal" } }}
          label={false}
          tooltip={{ items: [{ field: "bytes", name: "占用", valueFormatter: formatBytes }] }}
        />
      </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无本地媒体" />}
      <div className="storage-usage-list">
        {(overview?.usage ?? []).map((item) => <div key={item.category}>
          <span>{item.category} · {item.count} 项</span><b>{formatBytes(item.bytes)}</b>
        </div>)}
      </div>
    </Card>

    <Card className="storage-card" title="可安全清理" size="small" loading={loading}>
      <div className="storage-reclaimable">
        <div><span>已结束工单预存</span><b>{formatBytes(overview?.reclaimableBytes ?? 0)}</b><small>{overview?.reclaimableCount ?? 0} 单已完成或已结束工单的预存资料</small></div>
        <Progress type="circle" size={66} percent={overview?.totalBytes ? Math.round((overview.reclaimableBytes / overview.totalBytes) * 100) : 0} format={(value) => `${value ?? 0}%`} />
      </div>
      <Button danger block size="large" icon={<DeleteOutlined />} disabled={!overview?.reclaimableCount || cleaning} loading={cleaning} onClick={() => setConfirmOpen(true)}>清理已结束工单预存</Button>
    </Card>

    <Alert className="storage-note" type="info" showIcon message="仅清理已完成或已结束工单关联的预存" description="清理会删除门头预存照片并同步移除本地预填标记；签字、上传记录、工单、账号和登录信息不会受到影响。" />
    {message && <Alert className="storage-note" type={message.startsWith("已") ? "success" : "info"} showIcon message={message} />}

    <Modal title="清理已结束工单预存" open={confirmOpen} okText="确认清理" cancelText="取消" okButtonProps={{ danger: true }} onOk={() => void clean()} onCancel={() => setConfirmOpen(false)}>
      <p>将处理 {overview?.reclaimableCount ?? 0} 单已完成或已结束工单，预计释放 {formatBytes(overview?.reclaimableBytes ?? 0)}。</p>
      <p>对应的门头预存照片和本地预填标记将一并移除。</p>
    </Modal>
  </main>;
}
