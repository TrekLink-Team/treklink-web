// The backend version reported by GET /api/health (specs/platform/api-design/01-get-health.md).
// A compiled constant, so every host reports it: the Vercel function ships backend/dist without
// package.json (D-089), and importing package.json through resolveJsonModule would emit a run-time
// require and move the build output to dist/src. backend-version.spec.ts fails when this value and
// backend/package.json "version" differ, so a version bump updates both in the same commit.
export const BACKEND_VERSION = '0.1.0';
