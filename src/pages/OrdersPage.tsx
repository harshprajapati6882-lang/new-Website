import { useEffect, useMemo, useState } from "react";
import type { CreatedOrder } from "../types/order";
import { OrderCard } from "../components/OrderCard";

interface OrdersPageProps {
  orders: CreatedOrder[];
  notice: string;
  controllingOrderId: string | null;
  onControlOrder: (order: CreatedOrder, action: "pause" | "resume" | "cancel") => void;
  onCloneOrder: (order: CreatedOrder) => void;
  onDismissNotice: () => void;
}

type TabType = "running" | "completed" | "scheduled" | "cancelled";
type ViewMode = "rows" | "columns";

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  running: { bg: "bg-yellow-500/15", text: "text-yellow-300", dot: "bg-yellow-400" },
  processing: { bg: "bg-yellow-500/15", text: "text-yellow-300", dot: "bg-yellow-400" },
  completed: { bg: "bg-emerald-500/15", text: "text-emerald-300", dot: "bg-emerald-400" },
  scheduled: { bg: "bg-amber-500/15", text: "text-amber-300", dot: "bg-amber-400" },
  paused: { bg: "bg-orange-500/15", text: "text-orange-300", dot: "bg-orange-400" },
  cancelled: { bg: "bg-red-500/15", text: "text-red-300", dot: "bg-red-400" },
  pending: { bg: "bg-gray-500/15", text: "text-gray-300", dot: "bg-gray-400" },
  failed: { bg: "bg-red-500/15", text: "text-red-300", dot: "bg-red-400" },
};

const TABS: { key: TabType; label: string; icon: string }[] = [
  { key: "running", label: "Active", icon: "⚡" },
  { key: "completed", label: "Completed", icon: "✓" },
  { key: "scheduled", label: "Scheduled", icon: "⏱" },
  { key: "cancelled", label: "Cancelled", icon: "✕" },
];

// 🔥 Bulk Order Group Type
interface BulkOrderGroup {
  bulkId: string;
  name: string;
  createdAt: string;
  orders: CreatedOrder[];
}

export function OrdersPage({
  orders,
  notice,
  controllingOrderId,
  onControlOrder,
  onCloneOrder,
  onDismissNotice,
}: OrdersPageProps) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("rows");
  const [activeTab, setActiveTab] = useState<TabType>("running");
  const [openedOrderId, setOpenedOrderId] = useState<string | null>(null);
  const [openedBulkId, setOpenedBulkId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [runStatusesCache, setRunStatusesCache] = useState<Record<string, any[]>>({});

  // 🔥 Fetch run statuses from backend
  useEffect(() => {
    const fetchAllStatuses = async () => {
      const uniqueLinks = [...new Set(orders.map(o => o.link))];
      const newCache: Record<string, any[]> = {};

      for (const link of uniqueLinks) {
        try {
          const response = await fetch("https://backend-new-6tzb.onrender.com/api/run-statuses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ link }),
          });
          const data = await response.json();
          if (data.success) {
            newCache[link] = data.runs;
          }
        } catch (err) {
          console.error("Failed to fetch statuses for", link);
        }
      }

      setRunStatusesCache(newCache);
    };

    if (orders.length > 0) {
      fetchAllStatuses();
      const interval = setInterval(fetchAllStatuses, 15000);
      return () => clearInterval(interval);
    }
  }, [orders]);

  // 🔥 Separate bulk orders and single orders
  const { bulkGroups, singleOrders } = useMemo(() => {
    const bulkMap = new Map<string, CreatedOrder[]>();
    const singles: CreatedOrder[] = [];

    orders.forEach(order => {
      if (order.bulkId) {
        const existing = bulkMap.get(order.bulkId) || [];
        bulkMap.set(order.bulkId, [...existing, order]);
      } else {
        singles.push(order);
      }
    });

    const bulks: BulkOrderGroup[] = [];
    bulkMap.forEach((groupOrders, bulkId) => {
      bulks.push({
        bulkId,
        name: groupOrders[0]?.name?.replace(/#\d+$/, '').trim() || "Bulk Order",
        createdAt: groupOrders[0]?.createdAt || new Date().toISOString(),
        orders: groupOrders.sort((a, b) => a.name.localeCompare(b.name)),
      });
    });

    return { bulkGroups: bulks, singleOrders: singles };
  }, [orders]);

  // 🔥 Get opened bulk group
  const openedBulkGroup = useMemo(() => {
    if (!openedBulkId) return null;
    return bulkGroups.find(g => g.bulkId === openedBulkId) || null;
  }, [bulkGroups, openedBulkId]);

  function getProgress(order: CreatedOrder) {
    const safeRuns = order.runs || [];
    const totalRuns = safeRuns.length;
    if (totalRuns === 0) return { percent: 0, completed: 0, total: 0 };

    const backendRuns = runStatusesCache[order.link] || [];
    
    const completedFromBackend = backendRuns.filter(
      (run) => run.smmStatus === "completed" || run.smmStatus === "complete" || run.smmStatus === "partial"
    ).length;

    const completedFromStatuses = (order.runStatuses || []).filter(
      (status) => status === "completed"
    ).length;

    const completed = Math.min(
      totalRuns,
      Math.max(
        order.completedRuns || 0,
        completedFromStatuses,
        completedFromBackend
      )
    );

    return {
      percent: Math.round((completed / totalRuns) * 100),
      completed,
      total: totalRuns,
    };
  }

  function getBulkProgress(bulk: BulkOrderGroup) {
    let totalRuns = 0;
    let completedRuns = 0;

    bulk.orders.forEach(order => {
      const progress = getProgress(order);
      totalRuns += progress.total;
      completedRuns += progress.completed;
    });

    return {
      percent: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
      completed: completedRuns,
      total: totalRuns,
      completedLinks: bulk.orders.filter(o => getProgress(o).percent === 100).length,
      totalLinks: bulk.orders.length,
    };
  }

  function getRealStatus(order: CreatedOrder): string {
    if (order.status === "cancelled") return "cancelled";
    if (order.status === "failed") return "failed";

    const runs = order.runs || [];
    const now = Date.now();
    const backendRuns = runStatusesCache[order.link] || [];

    if (backendRuns.length > 0) {
      const allDone = backendRuns.every(
        (run) => run.done || run.smmStatus === "completed" || run.smmStatus === "complete"
      );
      if (allDone) return "completed";
    }

    if (runs.length > 0) {
      const allFuture = runs.every((run) => {
        const runTime = run?.at instanceof Date ? run.at.getTime() : new Date(run?.at ?? now).getTime();
        return runTime > now;
      });
      if (allFuture && order.status !== "paused") {
        return "scheduled";
      }
    }

    if (order.status === "processing") return "running";
    if (order.status === "pending") return "running";

    return order.status;
  }

  function getBulkStatus(bulk: BulkOrderGroup): string {
    const statuses = bulk.orders.map(o => getRealStatus(o));
    
    if (statuses.every(s => s === "cancelled")) return "cancelled";
    if (statuses.every(s => s === "completed")) return "completed";
    if (statuses.every(s => s === "scheduled")) return "scheduled";
    
    return "running";
  }

  function getOrderCategory(order: CreatedOrder): TabType {
    const status = getRealStatus(order);

    if (status === "cancelled" || status === "failed") return "cancelled";
    if (status === "completed") return "completed";
    if (status === "scheduled") return "scheduled";

    return "running";
  }

  function getBulkCategory(bulk: BulkOrderGroup): TabType {
    const status = getBulkStatus(bulk);
    
    if (status === "cancelled") return "cancelled";
    if (status === "completed") return "completed";
    if (status === "scheduled") return "scheduled";
    
    return "running";
  }

  function getNextRunTime(order: CreatedOrder): Date | null {
    const runs = order.runs || [];
    const now = Date.now();

    const futureRuns = runs
      .map((run) => (run?.at instanceof Date ? run.at : new Date(run?.at ?? now)))
      .filter((date) => date.getTime() > now)
      .sort((a, b) => a.getTime() - b.getTime());

    return futureRuns.length > 0 ? futureRuns[0] : null;
  }

  function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) return "Now";

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `in ${minutes}m`;
    return "in <1m";
  }

  // 🔥 Cancel a single link
  const handleCancelLink = async (order: CreatedOrder) => {
    setCancellingOrderId(order.id);
    
    try {
      await fetch("https://backend-new-6tzb.onrender.com/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: order.link }),
      });

      onControlOrder(order, "cancel");
    } catch (err) {
      console.error("Failed to cancel link", err);
      alert("Failed to cancel. Please try again.");
    } finally {
      setCancellingOrderId(null);
    }
  };

  // 🔥 Combined list: bulk groups + single orders
  type DisplayItem = { type: "single"; order: CreatedOrder } | { type: "bulk"; bulk: BulkOrderGroup };

  const categorizedItems = useMemo(() => {
    const running: DisplayItem[] = [];
    const completed: DisplayItem[] = [];
    const scheduled: DisplayItem[] = [];
    const cancelled: DisplayItem[] = [];

    // Add single orders
    singleOrders.forEach((order) => {
      const category = getOrderCategory(order);
      const item: DisplayItem = { type: "single", order };
      
      if (category === "running") running.push(item);
      else if (category === "completed") completed.push(item);
      else if (category === "scheduled") scheduled.push(item);
      else if (category === "cancelled") cancelled.push(item);
    });

    // Add bulk groups
    bulkGroups.forEach((bulk) => {
      const category = getBulkCategory(bulk);
      const item: DisplayItem = { type: "bulk", bulk };
      
      if (category === "running") running.push(item);
      else if (category === "completed") completed.push(item);
      else if (category === "scheduled") scheduled.push(item);
      else if (category === "cancelled") cancelled.push(item);
    });

    // Sort by creation date
    const sortByDate = (a: DisplayItem, b: DisplayItem) => {
      const dateA = a.type === "single" ? a.order.createdAt : a.bulk.createdAt;
      const dateB = b.type === "single" ? b.order.createdAt : b.bulk.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    };

    running.sort(sortByDate);
    completed.sort(sortByDate);
    scheduled.sort(sortByDate);
    cancelled.sort(sortByDate);

    return { running, completed, scheduled, cancelled };
  }, [singleOrders, bulkGroups, runStatusesCache]);

  const filteredItems = useMemo(() => {
    const itemsForTab = categorizedItems[activeTab];
    const value = query.trim().toLowerCase();

    if (!value) return itemsForTab;

    return itemsForTab.filter((item) => {
      if (item.type === "bulk") {
        return (
          item.bulk.name.toLowerCase().includes(value) ||
          item.bulk.orders.some(o => o.link.toLowerCase().includes(value))
        );
      } else {
        return (
          (item.order.name || "").toLowerCase().includes(value) ||
          (item.order.link || "").toLowerCase().includes(value) ||
          item.order.id.toLowerCase().includes(value)
        );
      }
    });
  }, [categorizedItems, activeTab, query]);

  useEffect(() => {
    if (!openedOrderId) return;
    const stillExists = orders.some((order) => order.id === openedOrderId);
    if (!stillExists) setOpenedOrderId(null);
  }, [orders, openedOrderId]);

  const openedOrder = useMemo(
    () => orders.find((order) => order.id === openedOrderId) ?? null,
    [orders, openedOrderId]
  );

  function toShortLink(link: string) {
    if (!link) return "-";
    return link.length > 48 ? `${link.slice(0, 30)}...${link.slice(-12)}` : link;
  }

  function StatusBadge({ status }: { status: string }) {
    const colors = STATUS_COLORS[status] || STATUS_COLORS.pending;
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colors.bg} ${colors.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${colors.dot} ${status === "running" ? "animate-pulse" : ""}`} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  }

  function ProgressBar({ percent, size = "normal" }: { percent: number; size?: "small" | "normal" }) {
    const height = size === "small" ? "h-1" : "h-1.5";
    const getColor = () => {
      if (percent === 100) return "bg-emerald-500";
      if (percent > 50) return "bg-yellow-500";
      return "bg-yellow-600";
    };

    return (
      <div className={`w-full overflow-hidden rounded-full bg-gray-800 ${height}`}>
        <div
          className={`${height} rounded-full transition-all duration-500 ${getColor()}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  }

  function EmptyState({ tab }: { tab: TabType }) {
    const messages = {
      running: { title: "No active missions", description: "Missions in progress will appear here" },
      completed: { title: "No completed missions", description: "Finished missions will appear here" },
      scheduled: { title: "No scheduled missions", description: "Future missions will appear here" },
      cancelled: { title: "No cancelled missions", description: "Cancelled missions will appear here" },
    };

    const icons = {
      running: "⚡",
      completed: "✅",
      scheduled: "📅",
      cancelled: "🚫",
    };

    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-yellow-500/30 bg-black py-16">
        <span className="text-4xl">{icons[tab]}</span>
        <p className="mt-4 text-sm font-medium text-yellow-400">{messages[tab].title}</p>
        <p className="mt-1 text-xs text-gray-600">{messages[tab].description}</p>
      </div>
    );
  }

  function StatsSummary() {
    const stats = [
      { label: "Active", count: categorizedItems.running.length, color: "text-yellow-400" },
      { label: "Completed", count: categorizedItems.completed.length, color: "text-emerald-400" },
      { label: "Scheduled", count: categorizedItems.scheduled.length, color: "text-amber-400" },
      { label: "Cancelled", count: categorizedItems.cancelled.length, color: "text-red-400" },
    ];

    return (
      <div className="grid grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-yellow-500/20 bg-black px-4 py-3 text-center"
          >
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.count}</p>
            <p className="mt-1 text-xs text-gray-600">{stat.label}</p>
          </div>
        ))}
      </div>
    );
  }

  // 🔥 Single Order Row
  function OrderTableRow({ order }: { order: CreatedOrder }) {
    const progress = getProgress(order);
    const status = getRealStatus(order);
    const nextRun = getNextRunTime(order);

    return (
      <tr
        onClick={() => setOpenedOrderId(order.id)}
        className="cursor-pointer border-t border-gray-800 transition hover:bg-yellow-500/5"
      >
        <td className="px-4 py-3">
          <p className="font-medium text-white">{order.name || `Mission #${order.id.slice(0, 8)}`}</p>
          <p className="mt-0.5 text-[11px] text-gray-600 font-mono">{order.id}</p>
        </td>
        <td className="max-w-[220px] px-4 py-3">
          <p className="truncate text-gray-500" title={order.link}>
            {toShortLink(order.link)}
          </p>
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={status} />
        </td>
        <td className="px-4 py-3">
          <div className="w-32">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-600">
                {progress.completed}/{progress.total} runs
              </span>
              <span className="text-[11px] font-medium text-gray-500">{progress.percent}%</span>
            </div>
            <ProgressBar percent={progress.percent} />
          </div>
        </td>
        {activeTab === "scheduled" && (
          <td className="px-4 py-3">
            {nextRun && (
              <div className="text-xs">
                <p className="text-amber-400">{formatRelativeTime(nextRun)}</p>
                <p className="mt-0.5 text-gray-600">{nextRun.toLocaleString()}</p>
              </div>
            )}
          </td>
        )}
        <td className="px-4 py-3 text-gray-600 text-xs">
          {new Date(order.createdAt).toLocaleDateString()}
          <span className="block text-gray-700">{new Date(order.createdAt).toLocaleTimeString()}</span>
        </td>
      </tr>
    );
  }

  // 🔥 Bulk Order Row
  function BulkTableRow({ bulk }: { bulk: BulkOrderGroup }) {
    const progress = getBulkProgress(bulk);
    const status = getBulkStatus(bulk);

    return (
      <tr
        onClick={() => setOpenedBulkId(bulk.bulkId)}
        className="cursor-pointer border-t border-gray-800 transition hover:bg-purple-500/5"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <div>
              <p className="font-medium text-purple-300">{bulk.name}</p>
              <p className="mt-0.5 text-[11px] text-purple-500">{bulk.orders.length} links</p>
            </div>
          </div>
        </td>
        <td className="max-w-[220px] px-4 py-3">
          <p className="text-gray-500 text-xs">
            {bulk.orders.length} Instagram links
          </p>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-purple-500/15 text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
            Bulk
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="w-32">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-600">
                {progress.completedLinks}/{progress.totalLinks} links
              </span>
              <span className="text-[11px] font-medium text-gray-500">{progress.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-1.5 rounded-full bg-purple-500 transition-all duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        </td>
        {activeTab === "scheduled" && <td className="px-4 py-3 text-gray-600">-</td>}
        <td className="px-4 py-3 text-gray-600 text-xs">
          {new Date(bulk.createdAt).toLocaleDateString()}
          <span className="block text-gray-700">{new Date(bulk.createdAt).toLocaleTimeString()}</span>
        </td>
      </tr>
    );
  }

  // 🔥 Single Order Card
  function OrderCardItem({ order }: { order: CreatedOrder }) {
    const progress = getProgress(order);
    const status = getRealStatus(order);
    const nextRun = getNextRunTime(order);

    return (
      <button
        type="button"
        onClick={() => setOpenedOrderId(order.id)}
        className="group rounded-xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-4 text-left transition-all hover:border-yellow-500/40 hover:shadow-lg hover:shadow-yellow-500/5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white group-hover:text-yellow-100">
              {order.name || `Mission #${order.id.slice(0, 8)}`}
            </p>
            <p className="mt-1 truncate text-xs text-gray-600 font-mono">{order.id}</p>
          </div>
          <StatusBadge status={status} />
        </div>

        <p className="mt-3 truncate text-xs text-gray-500" title={order.link}>
          {toShortLink(order.link)}
        </p>

        {activeTab === "scheduled" && nextRun && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5">
            <span className="text-amber-400">⏱</span>
            <span className="text-xs text-amber-300">{formatRelativeTime(nextRun)}</span>
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-600">Progress</span>
            <span className="text-gray-500">
              {progress.completed}/{progress.total} ({progress.percent}%)
            </span>
          </div>
          <ProgressBar percent={progress.percent} />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-600">
          <span>Deployed</span>
          <span>{new Date(order.createdAt).toLocaleDateString()}</span>
        </div>
      </button>
    );
  }

  // 🔥 Bulk Order Card
  function BulkCardItem({ bulk }: { bulk: BulkOrderGroup }) {
    const progress = getBulkProgress(bulk);

    return (
      <button
        type="button"
        onClick={() => setOpenedBulkId(bulk.bulkId)}
        className="group rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-900/20 to-black p-4 text-left transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">📦</span>
              <p className="truncate text-sm font-semibold text-purple-300 group-hover:text-purple-200">
                {bulk.name}
              </p>
            </div>
            <p className="mt-1 text-xs text-gray-600">{bulk.orders.length} Instagram links</p>
          </div>
          <span className="rounded-full bg-purple-500/20 px-2 py-1 text-[10px] font-medium text-purple-300">
            BULK
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-600">Links Completed</span>
            <span className="text-purple-400">
              {progress.completedLinks}/{progress.totalLinks}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-600">
          <span>Deployed</span>
          <span>{new Date(bulk.createdAt).toLocaleDateString()}</span>
        </div>
      </button>
    );
  }

  // 🔥🔥🔥 BULK ORDER POPUP - Shows all links with individual cancel buttons
  function BulkOrderPopup({ bulk, onClose }: { bulk: BulkOrderGroup; onClose: () => void }) {
    const progress = getBulkProgress(bulk);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm px-4 py-6"
        onClick={onClose}
      >
        <div
          className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-purple-500/30 bg-gradient-to-br from-gray-900 to-black p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📦</span>
              <div>
                <h3 className="text-xl font-bold text-purple-400">{bulk.name}</h3>
                <p className="text-sm text-gray-500">
                  {bulk.orders.length} links • {progress.completedLinks} completed
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition"
            >
              ✕ Close
            </button>
          </div>

          {/* Overall Progress */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Overall Progress</span>
              <span className="text-lg font-bold text-purple-400">{progress.percent}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>{progress.completed} / {progress.total} runs</span>
              <span>{progress.completedLinks} / {progress.totalLinks} links done</span>
            </div>
          </div>

          {/* Individual Links */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
              <span>🔗</span> Individual Links
            </h4>

            {bulk.orders.map((order, index) => {
              const orderProgress = getProgress(order);
              const orderStatus = getRealStatus(order);
              const isCancelling = cancellingOrderId === order.id;
              const canCancel = orderStatus !== "cancelled" && orderStatus !== "completed";

              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-gray-800 bg-black/50 p-4 hover:border-gray-700 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Link Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold">
                          {index + 1}
                        </span>
                        <StatusBadge status={orderStatus} />
                        <span className="text-[10px] text-gray-600 font-mono">{order.id}</span>
                      </div>
                      
                      <p className="text-sm text-gray-300 break-all mb-3" title={order.link}>
                        {order.link}
                      </p>

                      {/* Progress */}
                      <div className="max-w-md">
                        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                          <span>{orderProgress.completed}/{orderProgress.total} runs</span>
                          <span>{orderProgress.percent}%</span>
                        </div>
                        <ProgressBar percent={orderProgress.percent} size="small" />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {/* Cancel Button */}
                      <button
                        onClick={() => {
                          if (window.confirm(`Cancel all runs for this link?\n\n${order.link}`)) {
                            handleCancelLink(order);
                          }
                        }}
                        disabled={!canCancel || isCancelling}
                        className={`rounded-lg px-4 py-2 text-xs font-medium transition min-w-[100px] ${
                          !canCancel
                            ? "border border-gray-700 bg-gray-800/50 text-gray-600 cursor-not-allowed"
                            : isCancelling
                              ? "border border-yellow-500/50 bg-yellow-500/10 text-yellow-300"
                              : "border border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        }`}
                      >
                        {isCancelling ? (
                          <span className="flex items-center justify-center gap-1">
                            <span className="animate-spin">⏳</span>
                          </span>
                        ) : orderStatus === "cancelled" ? (
                          "Cancelled"
                        ) : orderStatus === "completed" ? (
                          "Completed"
                        ) : (
                          "❌ Cancel"
                        )}
                      </button>

                      {/* View Details */}
                      <button
                        onClick={() => {
                          onClose();
                          setOpenedOrderId(order.id);
                        }}
                        className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-300 hover:bg-yellow-500/20 transition"
                      >
                        👁️ View Runs
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cancel All Button */}
          <div className="mt-6 pt-4 border-t border-gray-800">
            <button
              onClick={() => {
                const activeOrders = bulk.orders.filter(o => {
                  const status = getRealStatus(o);
                  return status !== "cancelled" && status !== "completed";
                });
                
                if (activeOrders.length === 0) {
                  alert("No active links to cancel");
                  return;
                }

                if (window.confirm(`Cancel ALL ${activeOrders.length} active links?`)) {
                  activeOrders.forEach(order => handleCancelLink(order));
                }
              }}
              className="w-full rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/20 transition flex items-center justify-center gap-2"
            >
              🚫 Cancel All Active Links
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">📦</span>
            <h2 className="text-2xl font-bold tracking-tight text-yellow-400">Mission Control</h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Track and manage all your operations
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-flex h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
          <span>Live monitoring</span>
        </div>
      </div>

      <StatsSummary />

      {/* Notice */}
      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p>{notice}</p>
          </div>
          <button
            type="button"
            onClick={onDismissNotice}
            className="rounded-lg px-2 py-1 text-emerald-200 hover:bg-emerald-500/20 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs & Controls */}
      <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const count = categorizedItems[tab.key].length;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-yellow-500/20 text-yellow-300 shadow-lg shadow-yellow-500/10"
                      : "text-gray-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                      isActive ? "bg-yellow-500/30 text-yellow-100" : "bg-gray-800 text-gray-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search missions..."
                className="w-full rounded-lg border border-yellow-500/30 bg-black py-2.5 pl-10 pr-4 text-sm text-gray-100 outline-none ring-yellow-500/40 transition placeholder:text-gray-700 focus:border-yellow-500/50 focus:ring-2"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="inline-flex rounded-lg border border-yellow-500/30 bg-black p-1">
              <button
                type="button"
                onClick={() => setViewMode("rows")}
                className={`rounded-md px-3 py-2 text-xs transition ${
                  viewMode === "rows"
                    ? "bg-yellow-500/20 text-yellow-300"
                    : "text-gray-500 hover:text-yellow-400"
                }`}
              >
                ☰ Rows
              </button>
              <button
                type="button"
                onClick={() => setViewMode("columns")}
                className={`rounded-md px-3 py-2 text-xs transition ${
                  viewMode === "columns"
                    ? "bg-yellow-500/20 text-yellow-300"
                    : "text-gray-500 hover:text-yellow-400"
                }`}
              >
                ⊞ Grid
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search Results */}
      {query && (
        <p className="text-sm text-gray-600">
          Found <span className="text-gray-400 font-medium">{filteredItems.length}</span> missions
          matching "<span className="text-yellow-400">{query}</span>" in {activeTab}
        </p>
      )}

      {/* Content */}
      {filteredItems.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : viewMode === "rows" ? (
        <div className="overflow-hidden rounded-xl border border-yellow-500/20 bg-black">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-400">
              <thead className="bg-gray-900 text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-medium">Mission</th>
                  <th className="px-4 py-3 font-medium">Link</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  {activeTab === "scheduled" && (
                    <th className="px-4 py-3 font-medium">Next Run</th>
                  )}
                  <th className="px-4 py-3 font-medium">Deployed</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) =>
                  item.type === "bulk" ? (
                    <BulkTableRow key={item.bulk.bulkId} bulk={item.bulk} />
                  ) : (
                    <OrderTableRow key={item.order.id} order={item.order} />
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) =>
            item.type === "bulk" ? (
              <BulkCardItem key={item.bulk.bulkId} bulk={item.bulk} />
            ) : (
              <OrderCardItem key={item.order.id} order={item.order} />
            )
          )}
        </div>
      )}

      {/* Single Order Popup */}
      {openedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm px-4 py-6"
          onClick={() => setOpenedOrderId(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl border border-yellow-500/30 bg-black p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-gray-800 pb-4">
              <div>
                <h3 className="text-lg font-semibold text-yellow-400">Mission Details</h3>
                <p className="mt-0.5 text-xs text-gray-600 font-mono">{openedOrder.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenedOrderId(null)}
                className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300 transition hover:bg-yellow-500/20"
              >
                ✕ Close
              </button>
            </div>
            <OrderCard
              key={openedOrder.id}
              order={openedOrder}
              controlBusy={controllingOrderId === openedOrder.id}
              onControl={onControlOrder}
              onClone={onCloneOrder}
            />
          </div>
        </div>
      )}

      {/* 🔥 Bulk Order Popup */}
      {openedBulkGroup && (
        <BulkOrderPopup
          bulk={openedBulkGroup}
          onClose={() => setOpenedBulkId(null)}
        />
      )}
    </div>
  );
}
