/** Reads a required env var, failing loudly instead of passing `undefined` on. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name}`)
  return value
}
