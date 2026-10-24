/**
 * Stub until the probe runs and lib/qloo/api.ts is implemented.
 *
 * When built (playbook Prompt I), this will run the full agent for the four landing examples
 * (lib/examples.ts) plus about ten likely judge inputs, with createRecorder from
 * lib/server/replay.ts, and store every Qloo response (through the Qloo client cache) and each
 * Recording with saveRecording, with no expiry. /api/plan then replays those runs, labelled
 * "cached run", without counting against visitor limits.
 *
 * It must run against the real Qloo source only: saveRecording refuses mock runs.
 */
console.error("warm-cache: not implemented until probe runs (see docs/after-key.md).");
process.exit(1);
