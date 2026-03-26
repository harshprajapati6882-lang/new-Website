import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GrowthGraph } from "../components/GrowthGraph";
import { PatternGenerator } from "../components/PatternGenerator";
import type {
  ApiPanel,
  Bundle,
  CreatedOrder,
  DeliveryOption,
  OrderConfig,
  PatternPlan,
  QuickPatternPreset,
} from "../types/order";
import { createSmmOrder } from "../utils/api";
import { createPatternPlan } from "../utils/patterns";

interface NewOrderPageProps {
  apis: ApiPanel[];
  bundles: Bundle[];
  orders: CreatedOrder[];
  prefillOrder?: CreatedOrder | null;
  onCreateOrder: (orders: CreatedOrder | CreatedOrder[]) => void;
  onNavigateToOrders: (notice?: string) => void;
}

function createOrderId() {
  return `ORD-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;
}

export function NewOrderPage({ apis, bundles, orders, prefillOrder, onCreateOrder, onNavigateToOrders }: NewOrderPageProps) {
  const prefillApiId = prefillOrder ? apis.find((api) => api.name === prefillOrder.selectedAPI)?.id ?? "" : "";
  const prefillBundleId = prefillOrder
    ? bundles.find((bundle) => bundle.name === prefillOrder.selectedBundle && bundle.apiId === prefillApiId)?.id ?? ""
    : "";
  const prefillRuns = prefillOrder?.runs || [];
  const prefillPlan: PatternPlan | null = prefillOrder
    ? {
        patternId: Number(prefillOrder.id.replace(/\D/g, "")) || Date.now() % 1000,
        patternName: prefillOrder.patternName,
        patternType: prefillOrder.patternType,
        totalRuns: prefillRuns.length,
        approximateIntervalMin:
          prefillRuns.length > 1
            ? Math.max(
                1,
                Math.round(
                  prefillRuns
                    .slice(1)
                    .reduce((acc, run, index) => {
                      const prev = prefillRuns[index];
                      // FIX: guard against non-Date values from storage
                      const prevTime = prev.at instanceof Date ? prev.at.getTime() : new Date(prev.at).getTime();
                      const curTime = run.at instanceof Date ? run.at.getTime() : new Date(run.at).getTime();
                      return acc + (curTime - prevTime) / 60000;
                    }, 0) / (prefillRuns.length - 1)
                )
              )
            : 0,
        finishTime: prefillRuns[prefillRuns.length - 1]?.at instanceof Date
          ? prefillRuns[prefillRuns.length - 1].at
          : new Date(prefillRuns[prefillRuns.length - 1]?.at ?? Date.now()),
        estimatedDurationHours:
          prefillRuns.length > 1
            ? Math.round(
                ((prefillRuns[prefillRuns.length - 1]?.at instanceof Date
                  ? prefillRuns[prefillRuns.length - 1].at.getTime()
                  : new Date(prefillRuns[prefillRuns.length - 1]?.at ?? Date.now()).getTime()) -
                  (prefillRuns[0]?.at instanceof Date
                    ? prefillRuns[0].at.getTime()
                    : new Date(prefillRuns[0]?.at ?? Date.now()).getTime())) /
                  3600000
              )
            : 0,
        risk: "Safe",
        runs: prefillRuns,
      }
    : null;

  const [orderName, setOrderName] = useState(
    prefillOrder?.name && !prefillOrder.name.startsWith("Order #") ? prefillOrder.name : ""
  );
  const [postUrl, setPostUrl] = useState(prefillOrder?.link ?? "");
  const [bulkLinks, setBulkLinks] = useState("");
  const [totalViews, setTotalViews] = useState(prefillOrder?.totalViews ?? 50000);
  const [selectedApiId, setSelectedApiId] = useState(prefillApiId);
  const [selectedBundleId, setSelectedBundleId] = useState(prefillBundleId);
  const [startDelayHours, setStartDelayHours] = useState(prefillOrder?.startDelayHours ?? 0);
  const [includeLikes, setIncludeLikes] = useState((prefillOrder?.engagement.likes ?? 0) > 0);
  const [includeShares, setIncludeShares] = useState((prefillOrder?.engagement.shares ?? 0) > 0);
  const [includeSaves, setIncludeSaves] = useState((prefillOrder?.engagement.saves ?? 0) > 0);
  const [variancePercent, setVariancePercent] = useState(40);
  const [peakHoursBoost, setPeakHoursBoost] = useState(false);
  const [quickPreset, setQuickPreset] = useState<QuickPatternPreset | null>(null);
  const [customHours, setCustomHours] = useState(30);
  const [delivery, setDelivery] = useState<DeliveryOption>({ mode: "auto", hours: 18, label: "Auto" });
  const [seed, setSeed] = useState(0);
  const [useClonedPlan, setUseClonedPlan] = useState(Boolean(prefillPlan));
  const [clonedPlan] = useState<PatternPlan | null>(prefillPlan);
  const [expandedRuns, setExpandedRuns] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const config: OrderConfig = useMemo(
    () => ({
      postUrl,
      totalViews,
      startDelayHours,
      includeLikes,
      includeShares,
      includeSaves,
      variancePercent,
      peakHoursBoost,
      quickPreset,
      delivery:
        delivery.mode === "custom"
          ? { ...delivery, hours: customHours, label: "Custom" }
          : delivery.mode === "auto"
            ? { ...delivery, hours: Math.max(6, Math.min(48, delivery.hours)) }
            : delivery,
    }),
    [
      postUrl,
      totalViews,
      startDelayHours,
      includeLikes,
      includeShares,
      includeSaves,
      variancePercent,
      peakHoursBoost,
      quickPreset,
      delivery,
      customHours,
    ]
  );

  const generatedPlan = useMemo(() => {
    try {
      const nextPlan = createPatternPlan(config);
      return { ...nextPlan, runs: nextPlan?.runs || [] };
    } catch (error) {
      console.error("Pattern plan generation failed", error);
      const now = new Date();
      return {
        patternId: 0,
        patternName: "fallback",
        patternType: "smooth-s-curve" as const,
        totalRuns: 0,
        approximateIntervalMin: 0,
        finishTime: now,
        estimatedDurationHours: 0,
        risk: "Safe" as const,
        runs: [],
      };
    }
  }, [config, seed]);

  const plan = useMemo(() => {
    const basePlan =
      useClonedPlan && clonedPlan
        ? { ...clonedPlan, runs: clonedPlan.runs || [] }
        : generatedPlan;

    const runs = basePlan?.runs || [];
    if (runs.length <= 1) return basePlan;

    const baseIntervalMin = basePlan.approximateIntervalMin || 120;

    const newRuns = runs.map((run, i) => {
      if (i === 0) return run;

      // FIX: guard against stored string dates
      const prevAt = runs[i - 1].at instanceof Date ? runs[i - 1].at : new Date(runs[i - 1].at);
      const prevTime = prevAt.getTime();
      const hour = new Date(prevTime).getHours();

      let multiplier = 1;
      if (hour >= 0 && hour < 6) multiplier = 1.4;
      else if (hour >= 6 && hour < 12) multiplier = 1.1;
      else if (hour >= 18 && hour <= 23) multiplier = 0.85;

      const baseIntervalMs = baseIntervalMin * 60 * 1000 * multiplier;
      const variation = baseIntervalMs * (Math.random() * 0.4 - 0.2);
      const newTime = prevTime + baseIntervalMs + variation;

      return { ...run, at: new Date(newTime) };
    });

    return { ...basePlan, runs: newRuns };
  }, [useClonedPlan, clonedPlan, generatedPlan]);

  const safePlan = useMemo(() => ({ ...plan, runs: plan?.runs || [] }), [plan]);

  const bundleOptions = useMemo(() => {
    if (!selectedApiId) return bundles;
    return bundles.filter((bundle) => bundle.apiId === selectedApiId);
  }, [bundles, selectedApiId]);

  function isValidUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  // FIX: helper to safely get timestamp from a Date or string
  function safeGetTime(val: Date | string | undefined): number {
    if (!val) return Date.now();
    if (val instanceof Date) return val.getTime();
    const d = new Date(val);
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
  }

  const handleApplyPreset = (preset: QuickPatternPreset) => {
    setUseClonedPlan(false);
    setQuickPreset(preset);
    if (preset === "viral-boost") {
      setVariancePercent(48);
      setDelivery({ mode: "preset", label: "12h", hours: 12 });
    }
    if (preset === "fast-start") {
      setVariancePercent(32);
      setDelivery({ mode: "preset", label: "6h", hours: 6 });
    }
    if (preset === "trending-push") {
      setVariancePercent(40);
      setDelivery({ mode: "preset", label: "24h", hours: 24 });
    }
    if (preset === "slow-burn") {
      setVariancePercent(22);
      setDelivery({ mode: "preset", label: "48h", hours: 48 });
    }
    setSeed((c) => c + 1);
    setExpandedRuns(false);
  };

  const handleGenerate = () => {
    setUseClonedPlan(false);
    setSeed((c) => c + 1);
    setExpandedRuns(false);
  };

  const deliveryOptions: DeliveryOption[] = [
    { mode: "preset", label: "6h", hours: 6 },
    { mode: "preset", label: "12h", hours: 12 },
    { mode: "auto", label: "Auto", hours: 18 },
    { mode: "preset", label: "24h", hours: 24 },
    { mode: "preset", label: "48h", hours: 48 },
    { mode: "custom", label: "Custom", hours: customHours },
  ];

  const handleDeploy = async () => {
    setCreateError("");
    setCreateSuccess("");

    if (!selectedBundleId) {
      setCreateError("Select a bundle before creating a mission.");
      return;
    }

    const bulkTargets = bulkLinks
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const singleTarget = postUrl.trim();
    const targets = bulkTargets.length > 0 ? bulkTargets : singleTarget ? [singleTarget] : [];

    if (!targets.length) {
      setCreateError("Add a post URL or paste multiple links.");
      return;
    }

    const invalidTarget = targets.find((t) => !isValidUrl(t));
    if (invalidTarget) {
      setCreateError(`Invalid URL: ${invalidTarget.slice(0, 40)}...`);
      return;
    }

    const selectedApi = apis.find((api) => api.id === selectedApiId) ?? null;
    if (!selectedApi) { setCreateError("Select an API."); return; }
    if (!selectedApi.url.trim()) { setCreateError("API URL is required."); return; }
    if (!isValidUrl(selectedApi.url.trim())) { setCreateError("API URL must be valid."); return; }
    if (!selectedApi.key.trim()) { setCreateError("API key is required."); return; }

    const selectedBundle = bundles.find((b) => b.id === selectedBundleId);
    if (!selectedBundle) { setCreateError("Select a valid bundle."); return; }

    const viewsServiceId = selectedBundle.serviceIds.views.trim();
    if (!viewsServiceId) { setCreateError("Bundle has no Views service."); return; }

    const likesServiceId = selectedBundle.serviceIds.likes.trim();
    const sharesServiceId = selectedBundle.serviceIds.shares.trim();
    const savesServiceId = selectedBundle.serviceIds.saves.trim();

    if (includeLikes && !likesServiceId) { setCreateError("Bundle has no Likes service."); return; }
    if (includeShares && !sharesServiceId) { setCreateError("Bundle has no Shares service."); return; }
    if (includeSaves && !savesServiceId) { setCreateError("Bundle has no Saves service."); return; }

    const quantity = (safePlan?.runs || []).reduce((acc, run) => acc + run.views, 0);
    if (!Number.isFinite(quantity) || quantity <= 0) { setCreateError("Quantity must be > 0."); return; }
    if (quantity < 100) { setCreateError("Views must be at least 100."); return; }

    const totalLikes = (safePlan?.runs || []).reduce((acc, run) => acc + run.likes, 0);
    const totalShares = (safePlan?.runs || []).reduce((acc, run) => acc + run.shares, 0);
    const totalSaves = (safePlan?.runs || []).reduce((acc, run) => acc + run.saves, 0);

    if (includeLikes && totalLikes < 10) { setCreateError("Likes must be at least 10."); return; }
    if (includeShares && totalShares < 20) { setCreateError("Shares must be at least 20."); return; }
    if (includeSaves && totalSaves < 10) { setCreateError("Saves must be at least 10."); return; }

    if (quantity > 100000) {
      const proceed = window.confirm("Large mission. Continue?");
      if (!proceed) return;
    }

    // FIX: Ensure run.at is always a proper Date before calling .toISOString()
    const viewRuns = (safePlan?.runs || []).map((run) => ({
      time: (run.at instanceof Date ? run.at : new Date(run.at)).toISOString(),
      quantity: Math.floor(run.views),
    }));

    if (!viewRuns.length || viewRuns.some((r) => !r.time || !Number.isFinite(r.quantity) || r.quantity <= 0)) {
      setCreateError("Invalid run schedule. Regenerate.");
      return;
    }

    const likesRuns = (safePlan?.runs || []).map((run) => ({
      time: (run.at instanceof Date ? run.at : new Date(run.at)).toISOString(),
      quantity: Math.max(0, Math.floor(run.likes)),
    }));
    const sharesRuns = (safePlan?.runs || []).map((run) => ({
      time: (run.at instanceof Date ? run.at : new Date(run.at)).toISOString(),
      quantity: Math.max(0, Math.floor(run.shares)),
    }));
    const savesRuns = (safePlan?.runs || []).map((run) => ({
      time: (run.at instanceof Date ? run.at : new Date(run.at)).toISOString(),
      quantity: Math.max(0, Math.floor(run.saves)),
    }));

    const servicesPayload: {
      views: { serviceId: string; runs: Array<{ time: string; quantity: number }> };
      likes?: { serviceId: string; runs: Array<{ time: string; quantity: number }> };
      shares?: { serviceId: string; runs: Array<{ time: string; quantity: number }> };
      saves?: { serviceId: string; runs: Array<{ time: string; quantity: number }> };
    } = { views: { serviceId: viewsServiceId, runs: viewRuns } };

    if (includeLikes) servicesPayload.likes = { serviceId: likesServiceId, runs: likesRuns };
    if (includeShares) servicesPayload.shares = { serviceId: sharesServiceId, runs: sharesRuns };
    if (includeSaves) servicesPayload.saves = { serviceId: savesServiceId, runs: savesRuns };

    setIsCreatingOrder(true);
    setCreateSuccess(`Processing ${targets.length} mission(s)...`);

    const createdOrders: CreatedOrder[] = [];
    const activeLinks = new Set(
      orders
        .filter((order) => {
          const now = Date.now();
          const runs = order.runs || [];
          if (!runs.length) return false;
          const allDone = runs.every((run) => safeGetTime(run.at) <= now);
          return !allDone && order.status !== "cancelled";
        })
        .map((order) => order.link.replace(/\/+$/, "").toLowerCase())
    );
    const createdLinks = new Set<string>();
    let successCount = 0;
    let failedCount = 0;
    let lastError = "";

    const bulkId = targets.length > 1 ? `BULK-${Date.now()}` : null;

    try {
      for (let index = 0; index < targets.length; index++) {
        const trimmedUrl = targets[index];
        const normalizedTarget = trimmedUrl.replace(/\/+$/, "").toLowerCase();

        if (activeLinks.has(normalizedTarget) || createdLinks.has(normalizedTarget)) {
          failedCount++;
          lastError = "Duplicate link.";
          continue;
        }

        try {
          // FIX: pass name and startDelayHours to createSmmOrder
          const result = await createSmmOrder({
            name: orderName.trim() || undefined,
            apiUrl: selectedApi.url,
            apiKey: selectedApi.key,
            link: trimmedUrl,
            startDelayHours,   // FIX: was missing
            services: servicesPayload,
          });

          const order: CreatedOrder = {
            id: createOrderId(),
            name: orderName.trim() || "",
            schedulerOrderId: result.schedulerOrderId, // FIX: now actually set by backend
            smmOrderId: result.orderId ?? "Scheduled",
            link: trimmedUrl,
            totalViews: quantity,
            startDelayHours,
            patternType: safePlan.patternType,
            patternName: safePlan.patternName,
            runs: safePlan?.runs || [],
            engagement: { likes: totalLikes, shares: totalShares, saves: totalSaves },
            serviceId: viewsServiceId,
            selectedAPI: selectedApi.name,
            selectedBundle: selectedBundle.name,
            status: result.status === "completed" ? "completed" : "running",
            completedRuns: typeof result.completedRuns === "number" ? result.completedRuns : 0,
            runStatuses: (safePlan?.runs || []).map(() => "pending"),
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            bulkId: bulkId ?? undefined,
          };

          if (!order.name) {
            order.name = `Mission #${order.id}`;
          } else if (targets.length > 1) {
            order.name = `${order.name} #${index + 1}`;
          }

          createdOrders.push(order);
          createdLinks.add(normalizedTarget);
          successCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed";

          const failedOrder: CreatedOrder = {
            id: createOrderId(),
            name: orderName.trim() || "",
            smmOrderId: "N/A",
            link: trimmedUrl,
            totalViews: quantity,
            startDelayHours,
            patternType: safePlan.patternType,
            patternName: safePlan.patternName,
            runs: safePlan?.runs || [],
            engagement: { likes: totalLikes, shares: totalShares, saves: totalSaves },
            serviceId: viewsServiceId,
            selectedAPI: selectedApi.name,
            selectedBundle: selectedBundle.name,
            status: "failed",
            completedRuns: 0,
            runStatuses: (safePlan?.runs || []).map((_, i) => (i === 0 ? "cancelled" : "pending")),
            runErrors: (safePlan?.runs || []).map((_, i) => (i === 0 ? message : "")),
            errorMessage: message,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            bulkId: bulkId ?? undefined,
          };

          if (!failedOrder.name) {
            failedOrder.name = `Mission #${failedOrder.id}`;
          } else if (targets.length > 1) {
            failedOrder.name = `${failedOrder.name} #${index + 1}`;
          }

          createdOrders.push(failedOrder);
          failedCount++;
          lastError = message;
        }
      }

      if (createdOrders.length > 0) {
        onCreateOrder(createdOrders);
      }

      if (failedCount > 0 && successCount === 0) {
        setCreateError(lastError || "Failed.");
        setCreateSuccess("");
        return;
      }

      const successLabel =
        targets.length > 1
          ? `Done: ${successCount}/${targets.length} links deployed`
          : "Mission Deployed ✅";
      setCreateSuccess(successLabel);
      if (failedCount > 0) setCreateError(`${failedCount} failed`);
      onNavigateToOrders(successLabel);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-2 px-3 py-3">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h2 className="text-lg font-bold tracking-tight text-yellow-400">New Mission</h2>
          <span className="text-[10px] text-gray-500 ml-2">Configure delivery patterns</span>
        </div>
      </motion.div>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="space-y-2">
          <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-3">
            <h3 className="text-xs font-semibold text-yellow-400 mb-2">📋 Order Details</h3>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Order Name</label>
                <input
                  type="text"
                  value={orderName}
                  onChange={(e) => setOrderName(e.target.value)}
                  placeholder="Mission name..."
                  className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Total Views</label>
                <input
                  type="number"
                  value={totalViews}
                  onChange={(e) => {
                    setUseClonedPlan(false);
                    const safe = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
                    setTotalViews(Math.max(0, Math.floor(safe)));
                  }}
                  className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
                />
              </div>
            </div>

            <div className="mb-2">
              <label className="text-[10px] text-gray-500 mb-1 block">Post URL</label>
              <input
                type="text"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://instagram.com/reel/..."
                className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none"
              />
            </div>

            <div className="mb-2">
              <label className="text-[10px] text-gray-500 mb-1 block">
                Bulk Links (one per line)
                {bulkLinks.split("\n").filter((l) => l.trim()).length > 0 && (
                  <span className="ml-2 text-purple-400">
                    📦 {bulkLinks.split("\n").filter((l) => l.trim()).length} links
                  </span>
                )}
              </label>
              <textarea
                value={bulkLinks}
                onChange={(e) => setBulkLinks(e.target.value)}
                placeholder="Paste multiple URLs..."
                rows={2}
                className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">API Panel</label>
                <select
                  value={selectedApiId}
                  onChange={(e) => {
                    setSelectedApiId(e.target.value);
                    setSelectedBundleId("");
                  }}
                  className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
                >
                  <option value="">Select API</option>
                  {apis.map((api) => (
                    <option key={api.id} value={api.id}>{api.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Bundle</label>
                <select
                  value={selectedBundleId}
                  onChange={(e) => setSelectedBundleId(e.target.value)}
                  className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
                >
                  <option value="">Select Bundle</option>
                  {bundleOptions.map((bundle) => (
                    <option key={bundle.id} value={bundle.id}>{bundle.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <GrowthGraph
            plan={safePlan}
            selectedPreset={quickPreset}
            onApplyPreset={handleApplyPreset}
            onGenerate={handleGenerate}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">🎯</span>
              <span className="text-xs font-medium text-yellow-400">Risk:</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-gray-500">{safePlan.estimatedDurationHours}h duration</span>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                  safePlan.risk === "Safe"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : safePlan.risk === "Medium"
                      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}
              >
                {safePlan.risk}
              </span>
            </div>
          </div>

          <PatternGenerator
            plan={safePlan}
            expandedRuns={expandedRuns}
            onToggleRuns={() => setExpandedRuns((p) => !p)}
          />

          <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black p-3">
            <h3 className="text-xs font-semibold text-yellow-400 mb-2">⚙️ Advanced Controls</h3>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Start Delay (hours)</label>
                <input
                  type="number"
                  value={startDelayHours}
                  onChange={(e) => {
                    setUseClonedPlan(false);
                    const safe = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
                    setStartDelayHours(Math.max(0, Math.min(168, Math.floor(safe))));
                  }}
                  min={0}
                  max={168}
                  className="w-full rounded-lg border border-yellow-500/20 bg-black px-2 py-1.5 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Variance: {variancePercent}%</label>
                <input
                  type="range"
                  value={variancePercent}
                  onChange={(e) => {
                    setUseClonedPlan(false);
                    setVariancePercent(Number(e.target.value));
                  }}
                  min={0}
                  max={50}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
              </div>
            </div>

            <div className="mb-2">
              <label className="text-[10px] text-gray-500 mb-1 block">Delivery Speed</label>
              <div className="flex gap-1 flex-wrap">
                {deliveryOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      setUseClonedPlan(false);
                      setDelivery(option);
                    }}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                      delivery.label === option.label
                        ? "border border-yellow-500 bg-yellow-500/20 text-yellow-300"
                        : "border border-yellow-500/20 bg-black text-gray-400 hover:text-yellow-300"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {delivery.mode === "custom" && (
                <input
                  type="number"
                  value={customHours}
                  onChange={(e) => {
                    setUseClonedPlan(false);
                    const safe = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 1;
                    const clamped = Math.max(1, Math.min(96, safe));
                    setCustomHours(clamped);
                    setDelivery({ mode: "custom", label: "Custom", hours: clamped });
                  }}
                  min={1}
                  max={96}
                  placeholder="Hours"
                  className="mt-1 w-20 rounded-lg border border-yellow-500/20 bg-black px-2 py-1 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[10px] text-gray-500">Engagement:</label>

              {[
                { label: "❤️ Likes", value: includeLikes, setter: setIncludeLikes, color: "pink" },
                { label: "🔄 Shares", value: includeShares, setter: setIncludeShares, color: "blue" },
                { label: "💾 Saves", value: includeSaves, setter: setIncludeSaves, color: "purple" },
              ].map(({ label, value, setter, color }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setUseClonedPlan(false); setter(!value); }}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                    value
                      ? `border border-${color}-500 bg-${color}-500/20 text-${color}-300`
                      : "border border-gray-600 bg-black text-gray-500"
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => { setUseClonedPlan(false); setPeakHoursBoost(!peakHoursBoost); }}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                    peakHoursBoost
                      ? "border border-orange-500 bg-orange-500/20 text-orange-300"
                      : "border border-gray-600 bg-black text-gray-500"
                  }`}
                >
                  🔥 Peak Hours
                </button>
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          {selectedBundleId && safePlan.runs.length > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-black p-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-yellow-400">💰</span>

                <div className="flex items-center gap-1 flex-wrap flex-1">
                  {(() => {
                    const selBundle = bundles.find((b) => b.id === selectedBundleId);
                    const selApi = apis.find((a) => a.id === selectedApiId);
                    if (!selBundle || !selApi) return null;

                    const vs = selApi.services.find((s) => s.id === selBundle.serviceIds.views);
                    const ls = selApi.services.find((s) => s.id === selBundle.serviceIds.likes);
                    const ss = selApi.services.find((s) => s.id === selBundle.serviceIds.shares);
                    const savs = selApi.services.find((s) => s.id === selBundle.serviceIds.saves);

                    const vq = safePlan.runs.reduce((s, r) => s + (r.views || 0), 0);
                    const lq = safePlan.runs.reduce((s, r) => s + (r.likes || 0), 0);
                    const sq = safePlan.runs.reduce((s, r) => s + (r.shares || 0), 0);
                    const savq = safePlan.runs.reduce((s, r) => s + (r.saves || 0), 0);

                    const vRate = parseFloat(vs?.rate || "0");
                    const lRate = parseFloat(ls?.rate || "0");
                    const sRate = parseFloat(ss?.rate || "0");
                    const savRate = parseFloat(savs?.rate || "0");

                    const vPrice = (vq / 1000) * vRate;
                    const lPrice = includeLikes ? (lq / 1000) * lRate : 0;
                    const sPrice = includeShares ? (sq / 1000) * sRate : 0;
                    const savPrice = includeSaves ? (savq / 1000) * savRate : 0;
                    const total = vPrice + lPrice + sPrice + savPrice;

                    return (
                      <>
                        <span className="text-[10px] text-gray-400">👁️{(vq / 1000).toFixed(0)}k=₹{vPrice.toFixed(0)}</span>
                        {includeLikes && lq > 0 && <span className="text-[10px] text-gray-400">❤️{(lq / 1000).toFixed(1)}k=₹{lPrice.toFixed(0)}</span>}
                        {includeShares && sq > 0 && <span className="text-[10px] text-gray-400">🔄{(sq / 1000).toFixed(1)}k=₹{sPrice.toFixed(0)}</span>}
                        {includeSaves && savq > 0 && <span className="text-[10px] text-gray-400">💾{(savq / 1000).toFixed(1)}k=₹{savPrice.toFixed(0)}</span>}
                        <div className="ml-auto rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-1">
                          <span className="text-sm font-bold text-yellow-400">₹{total.toFixed(0)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deploy bar */}
      <div className="flex items-center justify-between rounded-lg border border-yellow-500/20 bg-gradient-to-br from-gray-900 to-black px-3 py-2">
        <div className="flex items-center gap-2">
          {createError && <span className="text-[10px] text-red-400">❌ {createError}</span>}
          {createSuccess && <span className="text-[10px] text-emerald-400">✅ {createSuccess}</span>}
          {!createError && !createSuccess && (
            <span className="text-[10px] text-gray-500">Ready to deploy mission</span>
          )}
        </div>
        <button
          type="button"
          disabled={isCreatingOrder}
          onClick={handleDeploy}
          className="whitespace-nowrap rounded-lg border border-yellow-500/50 bg-yellow-500/20 px-4 py-1.5 text-xs font-semibold text-yellow-300 transition hover:bg-yellow-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCreatingOrder ? "Deploying..." : "🦇 Deploy"}
        </button>
      </div>
    </div>
  );
}
