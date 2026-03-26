import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CreatedOrder, OrderStatus } from "../types/order";
import { RunTable } from "./RunTable";

interface OrderCardProps {
  order: CreatedOrder;
  onControl: (order: CreatedOrder, action: "pause" | "resume" | "cancel") => void;
  onClone: (order: CreatedOrder) => void;
  controlBusy: boolean;
}

const statusColor: Record<OrderStatus, string> = {
  running: "text-yellow-300",
  paused: "text-amber-300",
  cancelled: "text-red-300",
  completed: "text-emerald-300",
  processing: "text-yellow-300",
  failed: "text-red-300",
};

export function OrderCard({ order, onControl, onClone, controlBusy }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const safeRuns = order?.runs || [];
  const safeRunStatuses = order?.runStatuses || [];
  const safeRunErrors = order?.runErrors || [];
  const finishTime = safeRuns[safeRuns.length - 1]?.at;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const { totalRuns, completedRuns, progressPercent } = useMemo(() => {
    const nextTotalRuns = Math.max(1, safeRuns.length);
    const completedFromStatuses = safeRunStatuses.filter((status) => status === "completed").length;
    const completedFromTime = safeRuns.reduce((count, run) => {
      const runTime = run?.at instanceof Date ? run.at.getTime() : new Date(run?.at ?? Date.now()).getTime();
      return runTime <= nowMs ? count + 1 : count;
    }, 0);
    const isTimeTrackedStatus = order.status === "running" || order.status === "processing" || order.status === "completed";
    const nextCompletedRuns = Math.min(
      nextTotalRuns,
      Math.max(
        0,
        order.status === "completed" ? nextTotalRuns : 0,
        Number.isFinite(order.completedRuns) ? order.completedRuns : 0,
        completedFromStatuses,
        isTimeTrackedStatus ? completedFromTime : 0
      )
    );
    const nextProgressPercent = Math.round((nextCompletedRuns / nextTotalRuns) * 100);
    return { totalRuns: nextTotalRuns, completedRuns: nextCompletedRuns, progressPercent: nextProgressPercent };
  }, [safeRuns, safeRunStatuses, order.status, order.completedRuns, nowMs]);

  const effectiveStatus = useMemo(() => {
    const runs = order.runs || [];
    const now = Date.now();

    if (runs.length > 0) {
      const allCompleted = runs.every((run) => {
        const runTime = new Date(run.at).getTime();
        return runTime <= now;
      });

      if (allCompleted) return "completed";
    }

    if (order.status === "processing") return "running";

    return order.status;
  }, [order, nowMs]);
  const shortLink =
    order.link.length > 56 ? `${order.link.slice(0, 36)}...${order.link.slice(-14)}` : order.link;

  const handleControl = async (action: "pause" | "resume" | "cancel") => {
    try {
      if (action === "cancel") {
        const confirmCancel = window.confirm("Are you sure you want to cancel this mission?");
        if (!confirmCancel) return;

        await fetch("https://backend-y30y.onrender.com/api/cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            link: order.link,
          }),
        });
      }

      onControl(order, action);

    } catch (err) {
      console.error("Control action failed", err);
      alert("Action failed. Please try again.");
    }
  };

  return (
    <article className="rounded-2xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-600">Mission ID</p>
          <h3 className="text-lg font-semibold text-yellow-400">{order.id}</h3>
          <p className="text-sm text-yellow-300">{order.name || `Mission #${order.id}`}</p>
          <p className="max-w-xl truncate text-sm text-gray-500" title={order.link || "No link provided"}>
            {shortLink || "No link provided"}
          </p>
        </div>
        <div className="space-y-2 text-right">
          <p className="text-sm text-gray-500">Panel ID: <span className="font-semibold text-yellow-300">{order.smmOrderId}</span></p>
          <p className="text-sm text-gray-500">Service: <span className="font-semibold text-gray-300">{order.serviceId}</span></p>
          <p className="text-sm text-gray-500">Quantity: <span className="font-semibold text-gray-300">{order.totalViews}</span></p>
          <p className="text-sm text-gray-500">Status: <span className={`font-semibold ${statusColor[effectiveStatus]}`}>{effectiveStatus}</span></p>
          {order.errorMessage && <p className="text-xs text-red-400">Error: {order.errorMessage}</p>}
          {finishTime && <p className="text-xs text-gray-600">ETA: {finishTime.toLocaleString()}</p>}
          <p className="text-xs text-gray-600">Updated: {new Date(order.lastUpdatedAt || order.createdAt).toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Progress</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
          <div className="h-full rounded-full bg-yellow-500 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="text-xs text-gray-500">
          {completedRuns} / {totalRuns} runs completed
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={controlBusy || effectiveStatus !== "running"}
          onClick={() => handleControl("pause")}
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pause
        </button>
        <button
          type="button"
          disabled={controlBusy || effectiveStatus !== "paused"}
          onClick={() => handleControl("resume")}
          className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Resume
        </button>
        <button
          type="button"
          disabled={controlBusy || effectiveStatus === "cancelled" || effectiveStatus === "completed"}
          onClick={() => handleControl("cancel")}
          className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onClone(order)}
          className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-300 transition hover:bg-yellow-500/20"
        >
          Clone
        </button>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto text-sm text-yellow-400 hover:text-yellow-300"
        >
          {expanded ? "Hide Runs" : "View Runs"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <RunTable runs={safeRuns} runStatuses={safeRunStatuses} runErrors={safeRunErrors} mode="logs" />
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
