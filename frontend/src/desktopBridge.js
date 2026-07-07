// Thin bridge to the Electron desktop shell's native toolbar.
//
// When the app runs inside the desktop shell, its preload exposes `window.tbaiDesktop`
// ({ onCommand, postState }). In a normal browser that object is undefined and every
// function here is a no-op, so the web app behaves exactly as before — no desktop
// dependency leaks into the web build.

export const isDesktop = () =>
  typeof window !== "undefined" && !!window.tbaiDesktop;

/**
 * Subscribe to commands from the native toolbar. `handler` receives the command
 * object, e.g. { type: "navigate", page: "lists" }. Returns a disposer suitable for
 * a useEffect cleanup (a no-op outside the desktop shell).
 */
export function onDesktopCommand(handler) {
  if (!isDesktop()) return () => {};
  const dispose = window.tbaiDesktop.onCommand(handler);
  return typeof dispose === "function" ? dispose : () => {};
}

/**
 * Push a partial state snapshot up to the toolbar (merged on the toolbar side).
 * Accepts any subset of { page, isAdmin, models, currentModel, unreadCount }.
 */
export function postDesktopState(partial) {
  if (!isDesktop()) return;
  window.tbaiDesktop.postState(partial);
}
