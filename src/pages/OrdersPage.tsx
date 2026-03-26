function getProgress(order: CreatedOrder) {
  const safeRuns = order.runs || [];
  const totalRuns = safeRuns.length;
  if (totalRuns === 0) return { percent: 0, completed: 0, total: 0 };
  
  const now = Date.now();
  
  // 🔥 FIX: Only count time-based completion if order is NOT cancelled/paused
  const shouldCountTimeBased = order.status !== "cancelled" && order.status !== "paused";
  
  const timeCompleted = shouldCountTimeBased 
    ? safeRuns.reduce((count, run) => {
        const runMs = run?.at instanceof Date ? run.at.getTime() : new Date(run?.at ?? now).getTime();
        return runMs <= now ? count + 1 : count;
      }, 0)
    : 0;
  
  // Count actual completed runs from backend statuses
  const statusCompleted = (order.runStatuses || []).filter((status) => status === "completed").length;
  
  // 🔥 FIX: Don't use time-based completion, only use actual statuses
  const completed = Math.min(
    totalRuns, 
    Math.max(
      order.completedRuns || 0,
      statusCompleted
      // Removed timeCompleted from here
    )
  );
  
  return {
    percent: Math.round((completed / totalRuns) * 100),
    completed,
    total: totalRuns,
  };
}
