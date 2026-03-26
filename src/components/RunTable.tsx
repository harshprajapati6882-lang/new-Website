import type { RunStep } from "../types/order";

interface RunTableProps {
  runs: RunStep[];
  runStatuses?: any[]; // 🔥 Changed to accept backend status objects
  runErrors?: string[];
  mode?: "schedule" | "logs";
  onCancelRun?: (runId: number) => void; // 🔥 NEW: Individual cancel callback
}

export function RunTable({ 
  runs, 
  runStatuses = [], 
  runErrors = [], 
  mode = "logs",
  onCancelRun 
}: RunTableProps) {
  const safeRuns = runs || [];
  const safeRunErrors = runErrors || [];

  // 🔥 NEW: Get status from backend data
  function getRunStatus(index: number) {
    const backendStatus = runStatuses[index];
    
    if (backendStatus) {
      if (backendStatus.cancelled) return "cancelled";
      if (backendStatus.smmStatus === "completed" || backendStatus.smmStatus === "complete") return "completed";
      if (backendStatus.smmStatus === "processing" || backendStatus.smmStatus === "in progress") return "processing";
      if (backendStatus.smmOrderId && !backendStatus.done) return "processing";
    }
    
    return "pending";
  }

  function toLabel(status: string) {
    if (status === "completed") return "✓ Complete";
    if (status === "cancelled") return "✕ Cancelled";
    if (status === "processing") return "⏳ Processing";
    return "⏸ Pending";
  }

  function getStatusColor(status: string) {
    if (status === "completed") return "text-emerald-400";
    if (status === "cancelled") return "text-red-400";
    if (status === "processing") return "text-yellow-400";
    return "text-gray-500";
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
                <td className="px-3 py-2 text-slate-400">{run.at.toLocaleString()}</td>
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
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">SMM ID</th> {/* 🔥 NEW */}
            <th className="px-3 py-2">Error</th>
            {onCancelRun && <th className="px-3 py-2">Action</th>} {/* 🔥 NEW */}
          </tr>
        </thead>
        <tbody>
          {safeRuns.map((run, index) => {
            const status = getRunStatus(index);
            const backendRun = runStatuses[index];
            
            return (
              <tr key={run.run} className="border-t border-slate-800/80 align-top">
                <td className="px-3 py-2">#{run.run}</td>
                <td className="px-3 py-2 text-slate-400">{run.at.toLocaleString()}</td>
                <td className="px-3 py-2">{run.views}</td>
                <td className="px-3 py-2">{run.likes}</td>
                <td className="px-3 py-2">{run.shares}</td>
                <td className="px-3 py-2">{run.saves}</td>
                <td className={`px-3 py-2 font-medium ${getStatusColor(status)}`}>
                  {toLabel(status)}
                </td>
                <td className="px-3 py-2 text-yellow-400"> {/* 🔥 NEW */}
                  {backendRun?.smmOrderId || "-"}
                </td>
                <td className="px-3 py-2 text-rose-300">{safeRunErrors[index] || "-"}</td>
                {onCancelRun && ( // 🔥 NEW: Individual cancel button
                  <td className="px-3 py-2">
                    {status !== "completed" && status !== "cancelled" && backendRun?.id && (
                      <button
                        onClick={() => onCancelRun(backendRun.id)}
                        className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/30 transition"
                      >
                        Cancel
                      </button>
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
