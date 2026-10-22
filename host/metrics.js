/**
 * Remote host metrics for the terminal status strip.
 *
 * One portable shell probe prints `KEY value` lines. Linux reads /proc; macOS
 * falls back to sysctl, vm_stat, top and netstat. Parsing and delta math stay
 * pure so they can be tested without an SSH server.
 */

export const METRICS_COMMAND = `
if [ -r /proc/stat ]; then
  echo "OS linux"
  awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print "CPU", t, $5+$6; exit}' /proc/stat
  awk 'BEGIN{t=0; a=0; f=0; b=0; c=0}
       /^MemTotal:/{t=$2}
       /^MemAvailable:/{a=$2}
       /^MemFree:/{f=$2}
       /^Buffers:/{b=$2}
       /^Cached:/{c=$2}
       END{if (a==0) a=f+b+c; print "MEM", t, a}' /proc/meminfo
  awk 'NR>2 {
         gsub(/^[ \\t]+/, "");
         split($0, a, ":");
         iface=a[1]; gsub(/[ \\t]+$/, "", iface);
         if (iface != "lo") {
           sub(/^[ \\t]+/, "", a[2]);
           n=split(a[2], f, /[ \\t]+/);
           rx+=f[1]; tx+=f[9];
         }
       }
       END{print "NET", rx+0, tx+0}' /proc/net/dev
else
  echo "OS darwin"
  echo "NCPU $(sysctl -n hw.ncpu 2>/dev/null || echo 0)"
  echo "MEMTOTAL $(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  vm_stat 2>/dev/null | awk 'BEGIN{ps=16384; a=0; w=0; c=0}
       /page size of/{ps=$8}
       /Pages active/{a=$3}
       /Pages wired down/{w=$4}
       /Pages occupied by compressor/{c=$5}
       END{print "MEMUSED", (a+w+c)*ps}'
  top -l 1 -n 0 2>/dev/null | awk '/CPU usage/{u=$3; s=$5; gsub(/[^0-9.]/,"",u); gsub(/[^0-9.]/,"",s); print "CPUUSED", u+s}'
  # top is unavailable inside restricted shells; per-process CPU is a portable fallback.
  ps -A -o %cpu= 2>/dev/null | awk '{s+=$1} END{if (NR>0) print "CPUUSED", (s>100?100:s)}'
  netstat -ibn 2>/dev/null | awk '$1!="lo0" && $7 ~ /^[0-9]+$/ {if($7>rx[$1])rx[$1]=$7; if($10>tx[$1])tx[$1]=$10}
       END{r=0; t=0; for(i in rx){r+=rx[i]; t+=tx[i]} print "NET", r, t}'
fi
`.trim()

/** Parse the probe's plain `KEY value…` output into numeric facts. */
export function parseMetricsOutput(text) {
  const facts = {
    os: 'unknown',
    ncpu: null,
    cpuTotal: null,
    cpuIdle: null,
    cpuUsed: null,
    memTotal: null,
    memAvailable: null,
    memUsed: null,
    netRx: null,
    netTx: null,
  }
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    const key = parts[0]
    const num = (index) => {
      const value = Number(parts[index])
      return Number.isFinite(value) ? value : null
    }
    if (key === 'OS') facts.os = parts[1] ?? 'unknown'
    else if (key === 'CPU') { facts.cpuTotal = num(1); facts.cpuIdle = num(2) }
    else if (key === 'CPUUSED') { if (facts.cpuUsed === null) facts.cpuUsed = num(1) }
    else if (key === 'MEM') {
      const total = num(1)
      const available = num(2)
      facts.memTotal = total === null ? null : total * 1024
      facts.memAvailable = available === null ? null : available * 1024
    } else if (key === 'MEMTOTAL') facts.memTotal = num(1)
    else if (key === 'MEMUSED') facts.memUsed = num(1)
    else if (key === 'NET') { facts.netRx = num(1); facts.netTx = num(2) }
    else if (key === 'NCPU') facts.ncpu = num(1)
  }
  if (facts.memUsed === null && facts.memTotal !== null && facts.memAvailable !== null) {
    facts.memUsed = Math.max(0, facts.memTotal - facts.memAvailable)
  }
  if (facts.memTotal !== null && facts.memTotal <= 0) facts.memTotal = null
  return facts
}

/** Turn one parsed sample plus the previous sample into UI metrics. */
export function deriveMetrics(sample, previous, now) {
  let cpu = Number.isFinite(sample.cpuUsed) ? sample.cpuUsed : null
  if (cpu === null && previous && sample.cpuTotal !== null && sample.cpuIdle !== null) {
    const totalDelta = sample.cpuTotal - previous.cpuTotal
    const idleDelta = sample.cpuIdle - previous.cpuIdle
    if (totalDelta > 0) cpu = 100 * (1 - idleDelta / totalDelta)
  }
  if (cpu !== null) cpu = Math.max(0, Math.min(100, cpu))

  let memory = null
  if (sample.memTotal !== null && sample.memUsed !== null && sample.memTotal > 0) {
    memory = {
      total: sample.memTotal,
      used: Math.max(0, sample.memUsed),
      percent: Math.max(0, Math.min(100, (sample.memUsed / sample.memTotal) * 100)),
    }
  }

  let network = null
  if (sample.netRx !== null && sample.netTx !== null) {
    let rxRate = null
    let txRate = null
    if (previous && now > previous.at) {
      const seconds = (now - previous.at) / 1000
      const rxDelta = sample.netRx - previous.netRx
      const txDelta = sample.netTx - previous.netTx
      if (seconds > 0 && rxDelta >= 0 && txDelta >= 0) {
        rxRate = rxDelta / seconds
        txRate = txDelta / seconds
      }
    }
    network = { rxBytes: sample.netRx, txBytes: sample.netTx, rxRate, txRate }
  }

  return {
    metrics: {
      connected: true,
      sampledAt: now,
      platform: sample.os,
      cpu,
      memory,
      network,
    },
    previous: {
      at: now,
      cpuTotal: sample.cpuTotal,
      cpuIdle: sample.cpuIdle,
      netRx: sample.netRx,
      netTx: sample.netTx,
    },
  }
}
