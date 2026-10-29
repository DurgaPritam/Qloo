type Env = Record<string, string | undefined>;

/**
 * Whether Takeover may serve paying customers (paid plans, the public API) with Qloo data. The
 * hackathon key and quota can't: in production both stay off until the commercial agreement with
 * Qloo is in place and QLOO_COMMERCIAL_TERMS=1 is set. Local and preview runs use test mode.
 */
export const qlooCommercialReady = (env: Env = process.env): boolean => env.VERCEL_ENV !== "production" || env.QLOO_COMMERCIAL_TERMS === "1";

export const COMMERCIAL_PENDING = "Paid plans open once Takeover's commercial agreement with Qloo is in place.";
