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
  bulk: { bg: "bg-purple-500/15", text: "text-purple-300", dot: "bg-purple-400" },
};

const TABS: { key: TabType; label: string; icon: string }[] = [
  { key: "running", label: "Active", icon: "⚡" },
  { key: "completed", label: "Completed", icon: "✓" },
  { key: "scheduled", label: "Scheduled", icon: "⏱" },
  { key: "cancelled", label: "Cancelled", icon: "✕" },
];

// 🔥 Type for bulk order group
interface BulkOrderGroup {
  id: string;
  name: string;
  createdAt: string;
  orders: CreatedOrder[];
  totalLinks: number;
  completedLinks: number;
  cancelledLinks: number;
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
  const [openedBulkId, setOpenedBulkId] = useState<string | null>(null); // 🔥 NEW: For bulk popup
  const [runStatusesCache, setRunStatusesCache] = useState<Record<string, any[]>>({});
  const [cancellingLink, setCancellingLink] = useState<string | null>(null); // 🔥 NEW: Track cancelling

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

    fetchAllStatuses();
    const interval = setInterval(fetchAllStatuses, 15000);
    return () => clearInterval(interval);
  }, [orders]);

  // 🔥 Group orders into bulk groups (same creation timestamp = same bulk)
  const { bulkGroups, singleOrders } = useMemo(() => {
    const timeGroups = new Map<string, CreatedOrder[]>();
    
    orders.forEach(order => {
      // Group by timestamp (same second = same bulk order)
      const timeKey = new Date(order.createdAt).toISOString().slice(0, 19);
      const existing = timeGroups.get(timeKey) || [];
      timeGroups.set(timeKey, [...existing, order]);
    });

    const bulks: BulkOrderGroup[] = [];
    const singles: CreatedOrder[] = [];

    timeGroups.forEach((groupOrders, timeKey) => {
      if (groupOrders.length > 1) {
        // This is a bulk order
        const completedLinks = groupOrders.filter(o => 
          o.status === "completed" || getRealStatus(o) === "completed"
        ).length;
        const cancelledLinks = groupOrders.filter(o => 
          o.status === "cancelled" || o.status === "failed"
        ).length;

        bulks.push({
          id: `bulk-${timeKey}`,
          name: groupOrders[0].name?.replace(/#\d+$/, '').trim() || "Bulk Order",
          createdAt: groupOrders[0].createdAt,
          orders: groupOrders,
          totalLinks: groupOrders.length,
          completedLinks,
          cancelledLinks,
        });
      } else {
        // Single order
        singles.push(groupOrders[0]);
      }
    });

    return { bulkGroups: bulks, singleOrders: singles };
  }, [orders]);

  // 🔥 Get the opened bulk group
  const openedBulkGroup = useMemo(() => {
    if (!openedBulkId) return null;
    return bulkGroups.find(g => g.id === openedBulkId) || null;
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
    if (bulk.cancelledLinks === bulk.totalLinks) return "cancelled";
    if (bulk.completedLinks === bulk.totalLinks) return "completed";
    if (bulk.completedLinks > 0 || bulk.cancelledLinks > 0) return "running";
    
    // Check if all scheduled
    const allScheduled = bulk.orders.every(o => getRealStatus(o) === "scheduled");
    if (allScheduled) return "scheduled";
    
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

  // 🔥 Cancel a single link from bulk
  const handleCancelLink = async (order: CreatedOrder) => {
    if (!window.confirm(`Cancel all runs for this link?\n\n${order.link}`)) return;

    setCancellingLink(order.link);
    
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
      setCancellingLink(null);
    }
  };

  const categorizedOrders = useMemo(() => {
    const running: (CreatedOrder | BulkOrderGroup)[] = [];
    const completed: (CreatedOrder | BulkOrderGroup)[] = [];
    const scheduled: (CreatedOrder | BulkOrderGroup)[] = [];
    const cancelled: (CreatedOrder | BulkOrderGroup)[] = [];

    // Add single orders
    singleOrders.forEach((order) => {
      const category = getOrderCategory(order);
      if (category === "running") running.push(order);
      else if (category === "completed") completed.push(order);
      else if (category === "scheduled") scheduled.push(order);
      else if (category === "cancelled") cancelled.push(order);
    });

    // Add bulk groups
    bulkGroups.forEach((bulk) => {
      const category = getBulkCategory(bulk);
      if (category === "running") running.push(bulk);
      else if (category === "completed") completed.push(bulk);
      else if (category === "scheduled") scheduled.push(bulk);
      else if (category === "cancelled") cancelled.push(bulk);
    });

    // Sort by creation date
    const sortByDate = (a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    running.sort(sortByDate);
    completed.sort(sortByDate);
    scheduled.sort(sortByDate);
    cancelled.sort(sortByDate);

    return { running, completed, scheduled, cancelled };
  }, [singleOrders, bulkGroups, runStatusesCache]);

  const filteredOrders = useMemo(() => {
    const ordersForTab = categorizedOrders[activeTab];
    const value = query.trim().toLowerCase();

    if (!value) return ordersForTab;

    return ordersForTab.filter((item) => {
      if ('orders' in item) {
        // Bulk group
        return (
          item.name.toLowerCase().includes(value) ||
          item.orders.some(o => o.link.toLowerCase().includes(value))
        );
      } else {
        // Single order
        return (
          (item.name || "").toLowerCase().includes(value) ||
          (item.link || "").toLowerCase().includes(value) ||
          item.id.toLowerCase().includes(value)
        );
      }
    });
  }, [categorizedOrders, activeTab, query]);

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

  function isBulkGroup(item: CreatedOrder | BulkOrderGroup): item is BulkOrderGroup {
    return 'orders' in item;
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
      { label: "Active", count: categorizedOrders.running.length, color: "text-yellow-400" },
      { label: "Completed", count: categorizedOrders.completed.length, color: "text-emerald-400" },
      { label: "Scheduled", count: categorizedOrders.scheduled.length, color: "text-amber-400" },
      { label: "Cancelled", count: categorizedOrders.cancelled.length, color: "text-red-400" },
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

  // 🔥 Render single order row
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

  // 🔥 NEW: Render bulk order row
  function BulkTableRow({ bulk }: { bulk: BulkOrderGroup }) {
    const status = getBulkStatus(bulk);
    const progressPercent = Math.round((bulk.completedLinks / bulk.totalLinks) * 100);

    return (
      <tr
        onClick={() => setOpenedBulkId(bulk.id)}
        className="cursor-pointer border-t border-gray-800 transition hover:bg-purple-500/5"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-purple-400">📦</span>
            <div>
              <p className="font-medium text-purple-300">{bulk.name}</p>
              <p className="mt-0.5 text-[11px] text-gray-600">{bulk.totalLinks} links</p>
            </div>
          </div>
        </td>
        <td className="max-w-[220px] px-4 py-3">
          <p className="text-gray-500 text-xs">
            {bulk.totalLinks} Instagram links
          </p>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-purple-500/15 text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
            Bulk Order
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="w-32">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-600">
                {bulk.completedLinks}/{bulk.totalLinks} links
              </span>
              <span className="text-[11px] font-medium text-gray-500">{progressPercent}%</span>
            </div>
            <ProgressBar percent={progressPercent} />
          </div>
        </td>
        {activeTab === "scheduled" && <td className="px-4 py-3">-</td>}
        <td className="px-4 py-3 text-gray-600 text-xs">
          {new Date(bulk.createdAt).toLocaleDateString()}
          <span className="block text-gray-700">{new Date(bulk.createdAt).toLocaleTimeString()}</span>
        </td>
      </tr>
    );
  }

  // 🔥 Single order card
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

  // 🔥 NEW: Bulk order card
  function BulkCardItem({ bulk }: { bulk: BulkOrderGroup }) {
    const progressPercent = Math.round((bulk.completedLinks / bulk.totalLinks) * 100);

    return (
      <button
        type="button"
        onClick={() => setOpenedBulkId(bulk.id)}
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
            <p className="mt-1 text-xs text-gray-600">{bulk.totalLinks} Instagram links</p>
          </div>
          <span className="rounded-full bg-purple-500/20 px-2 py-1 text-[10px] font-medium text-purple-300">
            BULK
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-600">Links Completed</span>
            <span className="text-purple-400">
              {bulk.completedLinks}/{bulk.totalLinks}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {bulk.cancelledLinks > 0 && (
          <p className="mt-2 text-[10px] text-red-400">
            {bulk.cancelledLinks} cancelled
          </p>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-600">
          <span>Deployed</span>
          <span>{new Date(bulk.createdAt).toLocaleDateString()}</span>
        </div>
      </button>
    );
  }

  // 🔥 NEW: Bulk Order Popup Component
  function BulkOrderPopup({ bulk, onClose }: { bulk: BulkOrderGroup; onClose: () => void }) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm px-4 py-6"
        onClick={onClose}
      >
        <div
          className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-purple-500/30 bg-black p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📦</span>
              <div>
                <h3 className="text-lg font-semibold text-purple-400">{bulk.name}</h3>
                <p className="text-xs text-gray-500">
                  {bulk.totalLinks} links • {bulk.completedLinks} completed • {bulk.cancelledLinks} cancelled
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-300 transition hover:bg-purple-500/20"
            >
              ✕ Close
            </button>
          </div>

          {/* Progress Summary */}
          <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Overall Progress</span>
              <span className="text-sm font-bold text-purple-400">
                {Math.round((bulk.completedLinks / bulk.totalLinks) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-purple-500 transition-all"
                style={{ width: `${(bulk.completedLinks / bulk.totalLinks) * 100}%` }}
              />
            </div>
          </div>

          {/* Individual Links */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-400">Individual Links</h4>
            
            {bulk.orders.map((order, index) => {
              const progress = getProgress(order);
              const status = getRealStatus(order);
              const isCancelling = cancellingLink === order.link;
              const isDisabled = status === "cancelled" || status === "completed" || isCancelling;

              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition hover:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Link Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                        <StatusBadge status={status} />
                      </div>
                      <p className="text-sm text-gray-300 truncate" title={order.link}>
                        {order.link}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600 font-mono">{order.id}</p>
                      
                      {/* Progress Bar */}
                      <div className="mt-3 max-w-xs">
                        <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                          <span>{progress.completed}/{progress.total} runs</span>
                          <span>{progress.percent}%</span>
                        </div>
                        <ProgressBar percent={progress.percent} size="small" />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      {/* Cancel Button */}
                      <button
                        type="button"
                        onClick={() => handleCancelLink(order)}
                        disabled={isDisabled}
                        className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                          isDisabled
                            ? "border border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed"
                            : "border border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        }`}
                      >
                        {isCancelling ? (
                          <span className="flex items-center gap-1">
                            <span className="animate-spin">⏳</span> Cancelling...
                          </span>
                        ) : status === "cancelled" ? (
                          "Cancelled"
                        ) : status === "completed" ? (
                          "Completed"
                        ) : (
                          "Cancel Link"
                        )}
                      </button>

                      {/* View Details Button */}
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          setOpenedOrderId(order.id);
                        }}
                        className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300 hover:bg-yellow-500/20 transition"
                      >
                        View Runs
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
              type="button"
              onClick={() => {
                if (!window.confirm(`Cancel ALL ${bulk.totalLinks} links in this bulk order?`)) return;
                bulk.orders.forEach(order => {
                  if (getRealStatus(order) !== "cancelled" && getRealStatus(order) !== "completed") {
                    handleCancelLink(order);
                  }
                });
              }}
              className="w-full rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 transition hover:bg-red-500/20"
            >
              🚫 Cancel All Links
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
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

      <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const count = categorizedOrders[tab.key].length;
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
                title="Table View"
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
                title="Grid View"
              >
                ⊞ Grid
              </button>
            </div>
          </div>
        </div>
      </div>

      {query && (
        <p className="text-sm text-gray-600">
          Found <span className="text-gray-400 font-medium">{filteredOrders.length}</span> missions
          matching "<span className="text-yellow-400">{query}</span>" in {activeTab}
        </p>
      )}

      {filteredOrders.length === 0 ? (
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
                {filteredOrders.map((item) => 
                  isBulkGroup(item) ? (
                    <BulkTableRow key={item.id} bulk={item} />
                  ) : (
                    <OrderTableRow key={item.id} order={item} />
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredOrders.map((item) =>
            isBulkGroup(item) ? (
              <BulkCardItem key={item.id} bulk={item} />
            ) : (
              <OrderCardItem key={item.id} order={item} />
            )
          )}
        </div>
      )}

      {/* Single Order Detail Modal */}
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
