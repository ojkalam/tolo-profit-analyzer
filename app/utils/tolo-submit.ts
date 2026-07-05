import type { SubmitTarget } from "react-router";

type ToloSubmitFn = (target: SubmitTarget, options: object) => void;

/**
 * Submit a plain object to an action as JSON. Centralizes the one cast needed
 * because our payloads carry validated-but-loosely-typed config blobs that
 * don't statically satisfy react-router's JsonValue.
 */
export function toloSubmitJson(
  submit: ToloSubmitFn,
  data: Record<string, unknown>,
): void {
  submit(data as unknown as SubmitTarget, {
    method: "post",
    encType: "application/json",
  });
}
