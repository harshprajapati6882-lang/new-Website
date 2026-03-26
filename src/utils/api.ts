import type { ApiService } from "../types/order";

interface CreateOrderPayload {
  name?: string;
  apiUrl: string;
  apiKey: string;
  link: string;
  startDelayHours?: number; // FIX: was never sent to backend
  services: Partial<
    Record<
      "views" | "likes" | "shares" | "saves",
      {
        serviceId: string;
        runs: Array<{
          time: string;
          quantity: number;
        }>;
      }
    >
  >;
}

interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  schedulerOrderId?: string;
  status?: string;
  completedRuns?: number;
  message?: string;
  raw?: unknown;
}

interface OrderControlResult {
  success: boolean;
  status?: "running" | "paused" | "cancelled" | "completed";
  completedRuns?: number;
  runStatuses?: Array<"pending" | "completed" | "cancelled">;
  error?: string;
}

// FIX: Added RunStatusResult for polling
interface RunStatusResult {
  success: boolean;
  status?: "running" | "paused" | "cancelled" | "completed";
  completedRuns?: number;
  totalRuns?: number;
  runs?: Array<{
    id: string;
    label: string;
    time: string;
    quantity: number;
    done: boolean;
    cancelled: boolean;
    paused: boolean;
    smmOrderId: string | null;
    smmStatus: string;
  }>;
}

const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() ||
  "https://backend-y30y.onrender.com";

interface RawService {
  service?: string | number;
  id?: string | number;
  name?: string;
  type?: string;
  rate?: string | number;
  min?: string | number;
  max?: string | number;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchServices(apiUrl: string, apiKey: string): Promise<ApiService[]> {
  const endpoint = `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/services`;
  console.info("[Fetch Services] Sending request", { endpoint, apiUrl });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiUrl, apiKey }),
    });
  } catch (error) {
    console.error("[Fetch Services] Network request failed", error);
    throw new Error("Cannot reach backend /api/services. Check backend availability and VITE_BACKEND_URL.");
  }

  const responseText = await response.text();
  const payload = ((): unknown => {
    try { return JSON.parse(responseText); } catch { return null; }
  })();

  const payloadObject = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;

  if (!response.ok) {
    console.error("[Fetch Services] Failed response", {
      status: response.status,
      payload,
      bodyPreview: responseText.slice(0, 500),
    });
    throw new Error(String(payloadObject?.error || `Failed to fetch services (HTTP ${response.status})`));
  }

  const directRows = Array.isArray(payload) ? payload : [];
  const wrappedServices = payloadObject?.services;
  const rows: RawService[] = Array.isArray(wrappedServices)
    ? (wrappedServices as RawService[])
    : wrappedServices && typeof wrappedServices === "object" && Array.isArray((wrappedServices as { data?: unknown[] }).data)
      ? (wrappedServices as { data: RawService[] }).data
      : (directRows as RawService[]);

  console.info("[Fetch Services] Response received", { count: rows.length });

  return rows
    .map((service) => {
      const id = String(service.service ?? service.id ?? "").trim();
      const name = String(service.name ?? "").trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        type: String(service.type ?? "").trim(),
        rate: String(service.rate ?? "").trim(),
        min: toNumber(service.min),
        max: toNumber(service.max),
      } satisfies ApiService;
    })
    .filter((service): service is ApiService => Boolean(service));
}

export async function createSmmOrder(payload: CreateOrderPayload): Promise<CreateOrderResult> {
  const endpoint = `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/order`;
  console.info("[Create Order] Sending request", {
    endpoint,
    apiUrl: payload.apiUrl,
    services: Object.keys(payload.services),
    link: payload.link,
    startDelayHours: payload.startDelayHours,
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // FIX: now includes name and startDelayHours in the body
      body: JSON.stringify({
        apiUrl: payload.apiUrl,
        apiKey: payload.apiKey,
        link: payload.link,
        services: payload.services,
        name: payload.name ?? "",
        startDelayHours: payload.startDelayHours ?? 0,
      }),
    });
  } catch (error) {
    console.error("[Create Order] Network request failed", error);
    throw new Error("Cannot reach backend /api/order. Check backend availability and VITE_BACKEND_URL.");
  }

  const responseText = await response.text();
  const parsed = ((): unknown => {
    try { return JSON.parse(responseText); } catch { return null; }
  })();

  const payloadObject = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const explicitError =
    typeof payloadObject?.error === "string" && payloadObject.error.trim()
      ? payloadObject.error.trim()
      : "";
  const isExplicitSuccess = payloadObject?.success === true;
  const successMessage =
    typeof payloadObject?.message === "string" && payloadObject.message.trim()
      ? payloadObject.message.trim()
      : "Order Scheduled Successfully";
  const orderIds = Array.isArray(payloadObject?.orderIds) ? payloadObject.orderIds : null;
  const resolvedOrderId = payloadObject?.orderId ?? payloadObject?.order ?? (orderIds && orderIds[0]);
  const schedulerOrderId =
    payloadObject?.schedulerOrderId !== undefined && payloadObject?.schedulerOrderId !== null
      ? String(payloadObject.schedulerOrderId)
      : undefined;

  if (explicitError) {
    console.error("[Create Order] API returned error", { status: response.status, payload: payloadObject });
    throw new Error(explicitError);
  }

  if (!response.ok) {
    console.error("[Create Order] Failed response", {
      status: response.status,
      payload: payloadObject,
      bodyPreview: responseText.slice(0, 500),
    });
    throw new Error(`Order request failed (HTTP ${response.status})`);
  }

  if (isExplicitSuccess) {
    console.info("[Create Order] Response received", {
      success: true,
      message: successMessage,
      schedulerOrderId,
    });
    return {
      success: true,
      orderId:
        resolvedOrderId !== undefined && resolvedOrderId !== null && String(resolvedOrderId).trim() !== ""
          ? String(resolvedOrderId)
          : undefined,
      message: successMessage,
      schedulerOrderId,
      status: typeof payloadObject?.status === "string" ? payloadObject.status : undefined,
      completedRuns: typeof payloadObject?.completedRuns === "number" ? payloadObject.completedRuns : undefined,
      raw: payloadObject,
    };
  }

  if (resolvedOrderId === undefined || resolvedOrderId === null || String(resolvedOrderId).trim() === "") {
    console.error("[Create Order] Missing order ID in response", {
      status: response.status,
      payload: payloadObject,
      bodyPreview: responseText.slice(0, 500),
    });
    throw new Error("Order failed: provider did not return an order ID or success confirmation");
  }

  console.info("[Create Order] Response received", { orderId: String(resolvedOrderId), schedulerOrderId });

  return {
    success: true,
    orderId: String(resolvedOrderId),
    message: successMessage,
    schedulerOrderId,
    status: typeof payloadObject?.status === "string" ? payloadObject.status : undefined,
    completedRuns: typeof payloadObject?.completedRuns === "number" ? payloadObject.completedRuns : undefined,
    raw: payloadObject,
  };
}

export async function updateOrderControl(payload: {
  schedulerOrderId: string;
  action: "pause" | "resume" | "cancel";
}): Promise<OrderControlResult> {
  const endpoint = `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/order/control`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(responseText); } catch { parsed = null; }

  const payloadObject = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  if (!response.ok || payloadObject?.success === false) {
    throw new Error(String(payloadObject?.error || `Order control failed (HTTP ${response.status})`));
  }

  return {
    success: true,
    status:
      payloadObject?.status === "running" ||
      payloadObject?.status === "paused" ||
      payloadObject?.status === "cancelled" ||
      payloadObject?.status === "completed"
        ? payloadObject.status
        : undefined,
    completedRuns: typeof payloadObject?.completedRuns === "number" ? payloadObject.completedRuns : undefined,
    runStatuses: Array.isArray(payloadObject?.runStatuses)
      ? (payloadObject.runStatuses as Array<"pending" | "completed" | "cancelled">)
      : undefined,
  };
}

// FIX: Added fetchRunStatuses — poll live run progress from backend
export async function fetchRunStatuses(payload: {
  schedulerOrderId?: string;
  link?: string;
}): Promise<RunStatusResult> {
  const endpoint = `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/run-statuses`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(responseText); } catch { parsed = null; }

  const payloadObject = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  if (!response.ok) {
    throw new Error(String(payloadObject?.error || `Failed to fetch run statuses (HTTP ${response.status})`));
  }

  return {
    success: true,
    status: typeof payloadObject?.status === "string" ? (payloadObject.status as RunStatusResult["status"]) : undefined,
    completedRuns: typeof payloadObject?.completedRuns === "number" ? payloadObject.completedRuns : undefined,
    totalRuns: typeof payloadObject?.totalRuns === "number" ? payloadObject.totalRuns : undefined,
    runs: Array.isArray(payloadObject?.runs) ? (payloadObject.runs as RunStatusResult["runs"]) : undefined,
  };
}
