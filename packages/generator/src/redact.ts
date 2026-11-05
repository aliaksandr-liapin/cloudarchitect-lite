/** Returns `err` with `apiKey` masked in its message; keeps `name` and `.status`. */
export function redactKey(err: unknown, apiKey: string): unknown {
  if (!(err instanceof Error) || !apiKey || !err.message.includes(apiKey)) return err;
  const clean = new Error(err.message.replaceAll(apiKey, '[redacted]'));
  clean.name = err.name;
  const status = (err as { status?: unknown }).status;
  if (status !== undefined) Object.assign(clean, { status });
  return clean;
}
