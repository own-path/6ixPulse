export type TravelVertical = "hotel" | "flight" | "activity" | "restaurant";

export interface TravelOffer {
  offer_id: string;
  vertical: TravelVertical;
  title: string;
  location: { city: string; country?: string; lat?: number; lng?: number };
  price: { amount: number; currency: string; display: string };
  rating?: number;
  image_url?: string;
  provider: string;
  provider_ref: string;
  affiliate_url: string;
  metadata?: Record<string, unknown>;
}

export interface TravelQuote {
  quote_id: string;
  offer_id: string;
  vertical: TravelVertical;
  title: string;
  line_items: Array<{ label: string; price: { amount: number; currency: string; display: string } }>;
  total: { amount: number; currency: string; display: string };
  expires_at: string;
  affiliate_url: string;
  provider: string;
}

export interface TravelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TravelTraceStep {
  id: string;
  tool: string;
  status: "done" | "error";
  input?: unknown;
  output?: unknown;
}

export interface TravelRunResult {
  ok: boolean;
  prompt?: string;
  summary?: string;
  messages?: TravelMessage[];
  offers?: TravelOffer[];
  quotes?: TravelQuote[];
  trace?: TravelTraceStep[];
  provider?: string;
  model?: string;
  error?: string;
  message?: string;
}

export async function runTravelBackend(
  prompt: string,
  opts?: { quote_id?: string; confirmation_token?: string },
): Promise<TravelRunResult | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch("/api/travel/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...opts }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as TravelRunResult;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getTravelQuote(offerId: string): Promise<TravelQuote | null> {
  try {
    const response = await fetch("/api/travel/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: offerId }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.quote ?? null;
  } catch {
    return null;
  }
}

export async function mintConfirmToken(quoteId: string): Promise<string | null> {
  try {
    const response = await fetch("/api/travel/confirm-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: quoteId }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.confirmation_token ?? null;
  } catch {
    return null;
  }
}
