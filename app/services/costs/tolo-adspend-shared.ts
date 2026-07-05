// Client-safe ad-spend constants (imported by the ad-spend route UI). Kept out
// of the .server module so nothing server-only reaches the browser bundle.
export type ToloAdChannel = "meta" | "google" | "tiktok" | "other";

export const TOLO_AD_CHANNELS: ToloAdChannel[] = [
  "meta",
  "google",
  "tiktok",
  "other",
];
