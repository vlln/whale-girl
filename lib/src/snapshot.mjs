// Read-only snapshot wire contract shared by the Node half and all clients.
export const SNAPSHOT_API_VERSION = 1
export const TURN_COMPLETED_MS = 4000

/** How long a recalled session memory rides /state after its recall edge: the
 * client dedupes on `at`, and the window keeps a later page reload from
 * replaying a greeting for a stale recall. Additive field, version unchanged. */
export const MEMORY_WINDOW_MS = 60000

/** A completion window is observable by every reader until its absolute deadline. */
export function turnCompletionSnapshot(until, nowMs) {
  const safeUntil = Number.isFinite(until) && until > 0 ? until : 0
  return { turnCompleted: safeUntil > nowMs, turnCompletedUntil: safeUntil }
}
