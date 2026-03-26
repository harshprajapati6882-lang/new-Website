import type { RunStep } from "../types/order";

interface BackendRunStatus {
  id: number | string;
  label?: string;
  time?: string;
  quantity?: number;
  done?: boolean;
  cancelled?: boolean;
  smmOrderId?: string | null;
  smmStatus?: string;
}

interface RunTableProps {
  runs: RunStep[];
  runStatuses?: BackendRunStatus[];
  runErrors?: string[];
  mode?: "schedule" | "logs";
  onCancelRun?: (runId: number | string) => void;
}

export function RunTable({
  runs,
  runStatuses = [],
  runErrors = [],
  mode = "logs",
  onCancelRun,
}: RunTableProps) {
  const safeRuns = runs || [];
  const safeRunErrors = runErrors || [];

  // 🔥 FIX: Match backend runs by TIME (not by index)
  function getRunStatusByTime(runTime: Date | string): {
    status: string;
    smmOrderIds: string[];
    backendRuns: BackendRunStatus[];
  } {
    const targetTime = runTime instanceof Date ? runTime.getTime() : new Date(runTime).getTime();
    
    // Find ALL backend runs that match this time (within 60 seconds tolerance)
    const matchingRuns = runStatuses.filter((backendRun) => {
      if (!backendRun.time) return false;
      const backendTime = new Date(backendRun.time).getTime();
      return Math.abs(backendTime - targetTime) < 60000; // 60 second tolerance
    });

    if (matchingRuns.length === 0) {
      return { status: "pending", smmOrderIds: [], backendRuns: [] };
    }

    const smmOrderIds = matchingRuns
      .filter((r) => r.smmOrderId)
      .map((r) => r.smmOrderId as string);

    // Check statuses
    const allStatuses = matchingRuns.map((r) => (r.smmStatus || "pending").toLowerCase());
    
    // If ALL are completed → completed
    if (allStatuses.every((s) => s === "completed" || s === "complete")) {
      return { status: "completed", smmOrderIds, backendRuns: matchingRuns };
    }
    
    // If ANY is cancelled → cancelled
    if (allStatuses.some((s) => s === "cancelled" || s === "canceled" || s === "refunded")) {
      return { status: "cancelled", smmOrderIds, backendRuns: matchingRuns };
    }
    
    // If ANY is processing → processing
    if (allStatuses.some((s) => s === "processing" || s === "in progress" || s === "inprogress" || s === "pending")) {
      // Check if any has smmOrderId (means it was sent to SMM panel)
      if (matchingRuns.some((r) => r.smmOrderId)) {
        return { status: "processing", smmOrderIds, backendRuns: matchingRuns };
      }
    }

    // If ANY is partial → partial
    if (allStatuses.some((s) => s === "partial")) {
      return { status: "partial", smmOrderIds, backendRuns: matchingRuns };
    }

    // If ANY is failed → failed
    if (allStatuses.some((s) => s === "failed" || s === "error")) {
      return { status: "failed", smmOrderIds, backendRuns: matchingRuns };
    }

    // Check if order was placed (has smmOrderId)
    if (matchingRuns.some((r) => r.smmOrderId)) {
      return { status: "processing", smmOrderIds, backendRuns: matchingRuns };
    }

    return { status: "pending", smmOrderIds, backendRuns: matchingRuns };
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case "completed": return "✓ Completed";
      case "processing": return "⏳ Processing";
      case "partial": return "⚠ Partial";
      case "cancelled": return "✕ Cancelled";
      case "failed": return "❌ Failed";
      default: return "⏸ Pending";
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed": return "text-emerald-400";
      case "processing": return "text-yellow-400";
      case "partial": return "text-orange-400";
      case "cancelled": return "text-red-400";
      case "failed": return "text-red-500";
      default: return "text-gray-500";
    }
  }

  if (mode === "schedule") {
    return (
      <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="sticky top-0 bg-[#0f1627] text-slate-400">
            <tr>
              <th className="px-3 py-2">Run</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Views</th>
              <th className="px-3 py-2">Likes</th>
              <th className="px-3 py-2">Shares</th>
              <th className="px-3 py-2">Saves</th>
            </tr>
          </thead>
          <tbody>
            {safeRuns.map((run) => (
              <tr key={run.run} className="border-t border-slate-800/80 align-top">
                <td className="px-3 py-2">#{run.run}</td>
                <td className="px-3 py-2 text-slate-400">
                  {run.at instanceof Date ? run.at.toLocaleString() : new Date(run.at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{run.views}</td>
                <td className="px-3 py-2">{run.likes}</td>
                <td className="px-3 py-2">{run.shares}</td>
                <td className="px-3 py-2">{run.saves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mt-3 max-h-96 overflow-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-xs text-slate-300">
        <thead className="sticky top-0 bg-[#0f1627] text-slate-400">
          <tr>
            <th className="px-3 py-2">Run</th>
            <th className="px-3 py-2">Scheduled Time</th>
            <th className="px-3 py-2">Views</th>
            <th className="px-3 py-2">Likes</th>
            <th className="px-3 py-2">Shares</th>
            <th className="px-3 py-2">Saves</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">SMM Order IDs</th>
            <th className="px-3 py-2">Error</th>
            {onCancelRun && <th className="px-3 py-2">Action</th>}
          </tr>
        </thead>
        <tbody>
          {safeRuns.map((run, index) => {
            const { status, smmOrderIds, backendRuns } = getRunStatusByTime(run.at);
            const canCancel = status === "pending" && backendRuns.length > 0;

            return (
              <tr key={run.run} className="border-t border-slate-800/80 align-top hover:bg-slate-800/30">
                <td className="px-3 py-2 font-medium">#{run.run}</td>
                <td className="px-3 py-2 text-slate-400">
                  {run.at instanceof Date ? run.at.toLocaleString() : new Date(run.at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{run.views}</td>
                <td className="px-3 py-2">{run.likes}</td>
                <td className="px-3 py-2">{run.shares}</td>
                <td className="px-3 py-2">{run.saves}</td>
                <td className={`px-3 py-2 font-medium ${getStatusColor(status)}`}>
                  {getStatusLabel(status)}
                </td>
                <td className="px-3 py-2">
                  {smmOrderIds.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {smmOrderIds.map((id, i) => (
                        <span key={i} className="text-yellow-400 font-mono text-[10px]">
                          {id}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-600">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-rose-300 max-w-[150px] truncate">
                  {safeRunErrors[index] || "-"}
                </td>
                {onCancelRun && (
                  <td className="px-3 py-2">
                    {canCancel && (
                      <button
                        onClick={() => {
                          // Cancel all matching backend runs
                          backendRuns.forEach((br) => {
                            if (br.id && !br.done && !br.cancelled) {
                              onCancelRun(br.id);
                            }
                          });
                        }}
                        className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/30 transition"
                      >
                        Cancel
                      </button>
                    )}
                    {status === "cancelled" && (
                      <span className="text-[10px] text-red-400">Cancelled</span>
                    )}
                    {status === "completed" && (
                      <span className="text-[10px] text-emerald-400">Done</span>
                    )}
                    {status === "processing" && (
                      <span className="text-[10px] text-yellow-400">In Progress</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
