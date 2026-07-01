// src/setup/auth.ts
export function isSetupAuthorized(provided: string | null, expected: string): boolean {
  return provided !== null && provided.length > 0 && provided === expected;
}
