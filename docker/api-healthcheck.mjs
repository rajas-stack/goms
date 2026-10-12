try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/api/trpc/health.check`, { signal: AbortSignal.timeout(4000) })
  const json = await response.json()
  if (!response.ok || json.result?.data?.ok !== true) process.exit(1)
} catch { process.exit(1) }
