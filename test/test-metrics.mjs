import assert from 'node:assert/strict'
import { parseMetricsOutput, deriveMetrics } from '../host/metrics.js'

const linux1 = parseMetricsOutput(`
OS linux
CPU 1000 800
MEM 8000000 4000000
NET 1000 200
`)
assert.equal(linux1.os, 'linux')
assert.equal(linux1.cpuTotal, 1000)
assert.equal(linux1.cpuIdle, 800)
assert.equal(linux1.memTotal, 8000000 * 1024)
assert.equal(linux1.memUsed, 4000000 * 1024)
assert.equal(linux1.netRx, 1000)

const first = deriveMetrics(linux1, null, 1000)
assert.equal(first.metrics.cpu, null, 'CPU needs two samples on Linux')
assert.equal(first.metrics.memory.percent, 50)
assert.equal(first.metrics.network.rxRate, null)
assert.equal(first.previous.at, 1000)

const linux2 = parseMetricsOutput(`
OS linux
CPU 1100 860
MEM 8000000 4000000
NET 3000 1200
`)
const second = deriveMetrics(linux2, first.previous, 3000)
assert.equal(Math.round(second.metrics.cpu), 40, 'delta total 100, idle 60 -> 40% busy')
assert.equal(second.metrics.network.rxRate, 1000, '2000 bytes over 2s')
assert.equal(second.metrics.network.txRate, 500)

const darwin = parseMetricsOutput(`
OS darwin
NCPU 8
MEMTOTAL 8000000000
MEMUSED 2000000000
CPUUSED 12.5
NET 5000 1000
`)
assert.equal(darwin.os, 'darwin')
assert.equal(darwin.ncpu, 8)
assert.equal(darwin.cpuUsed, 12.5)
const mac = deriveMetrics(darwin, null, 5000)
assert.equal(mac.metrics.cpu, 12.5)
assert.equal(mac.metrics.memory.percent, 25)
assert.equal(mac.metrics.network.rxBytes, 5000)

const empty = parseMetricsOutput('')
assert.equal(empty.os, 'unknown')
assert.equal(empty.memTotal, null)
assert.deepEqual(deriveMetrics(empty, null, 1).metrics.memory, null)

console.log('METRICS TEST PASS')
