/**
 * Push device platform normalizer (pure, isomorphic).
 *
 * Shared by the registration route so the value stored in
 * native_push_devices.platform is always one of the two supported
 * literals. 'web' is accepted from the admin browser flow (Phase B);
 * EVERYTHING else — including the native Android app that omits/sends
 * other values — defaults to 'android', preserving back-compat.
 */
export type DevicePlatform = "android" | "web";

export function normalizeDevicePlatform(value: unknown): DevicePlatform {
  return value === "web" ? "web" : "android";
}
