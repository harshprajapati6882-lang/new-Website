import type { RunStep } from "../types/order";

interface RunTableProps {
  runs: RunStep[];
  runStatuses?: Array<"pending" | "completed" | "cancelled">;
  runErrors?: string[];
  mode?: "schedule" | "logs";
}

export function RunTable({ runs, runStatuses = [], runErrors = [], mode = "logs" }: RunTableProps) {
  const safeRuns = runs || [];
  const safeRunStatuses = runStatuses || [];
  const safeRunErrors = runErrors || [];

  function toLabel(status?: "pending" | "completed" | "cancelled") {
    if (status === "completed") return "success";
    if (status === "cancelled") return "failed";
    return "pending";
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
            <th className="px-3 py-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {safeRuns.map((run, index) => (
            <tr key={run.run} className="border-t border-slate-800/80 align-top">
              <td className="px-3 py-2">#{run.run}</td>
              <td className="px-3 py-2 text-slate-400">{run.at.toLocaleString()}</td>
              <td className="px-3 py-2">{run.views}</td>
              <td className="px-3 py-2">{run.likes}</td>
              <td className="px-3 py-2">{run.shares}</td>
              <td className="px-3 py-2">{run.saves}</td>
              <td className="px-3 py-2 uppercase">{toLabel(safeRunStatuses[index])}</td>
              <td className="px-3 py-2 text-rose-300">{safeRunErrors[index] || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
