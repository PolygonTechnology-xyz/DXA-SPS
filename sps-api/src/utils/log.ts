const COLORS = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
  white:   "\x1b[37m",
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

function tag(label: string, color: string) {
  return `${color}[${label}]${COLORS.reset}`
}

export const log = {
  route:    (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("ROUTE",   COLORS.cyan)}    ${msg}`),
  chat:     (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("CHAT",    COLORS.blue)}    ${msg}`),
  tool:     (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("TOOL",    COLORS.magenta)} ${msg}`),
  sse:      (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("SSE",     COLORS.green)}    ${msg}`),
  analyze:  (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("ANALYZE", COLORS.yellow)}  ${msg}`),
  interview:(msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("INTERVW", COLORS.cyan)}  ${msg}`),
  error:    (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("ERROR",   COLORS.red)}   ${msg}`),
  info:     (msg: string) => console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("INFO",    COLORS.white)}   ${msg}`),
}

// ── Timing ────────────────────────────────────────────────────────────────────

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function logTime(msg: string) {
  console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${tag("TIME", COLORS.yellow)}     ${msg}`)
}

// Times one stage. `firstToken()` marks when streaming output starts; `done()` logs
// total time, time-to-first-token, token usage and output speed (tokens/sec).
export function startTimer(label: string) {
  const t0 = performance.now()
  let ttft: number | null = null
  return {
    firstToken() { if (ttft === null) ttft = performance.now() - t0 },
    elapsed() { return secs(performance.now() - t0) },
    done(usage?: { input_tokens: number; output_tokens: number }, extra = "") {
      const total = performance.now() - t0
      const parts = [`${label.padEnd(26)} total=${secs(total)}`]
      if (ttft !== null) parts.push(`first-token=${secs(ttft)}`)
      if (usage) {
        const genMs = total - (ttft ?? 0)
        parts.push(`in=${usage.input_tokens} out=${usage.output_tokens}`)
        if (genMs > 0) parts.push(`speed=${Math.round(usage.output_tokens / (genMs / 1000))} tok/s`)
      }
      if (extra) parts.push(extra)
      logTime(parts.join("  "))
    },
  }
}
