// Pure helpers for the build-time deploy notification.
// scripts/notify-deploy.mjs mirrors this logic (it cannot import TS directly).
export function shouldNotifyDeploy(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

export function buildDeployMessage(sha: string | undefined): string {
  const short = (sha ?? "").slice(0, 7);
  return `🚀 mail-manager deployed${short ? ` (${short})` : ""}.`;
}
