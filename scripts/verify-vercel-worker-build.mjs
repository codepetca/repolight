import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'

const output = new URL('../.vercel/output/', import.meta.url)
const readJson = file => JSON.parse(readFileSync(new URL(file, output), 'utf8'))
const config = readJson('config.json')
assert.deepEqual(config.daemons ?? {}, {}, 'The hosted build must not contain daemons.')
assert.deepEqual(config.schedules?.['repolight-analysis-recovery'], {
  schedule: '0 * * * *', function: 'api/internal/analysis-recovery',
})
const routes = JSON.stringify(config.routes)

for (const [name, trigger, topic] of [
  ['analysis-wake', 'queue/v2beta', 'repolight-analysis-wake-v1'],
  ['analysis-recovery', 'schedule/v1beta', undefined],
]) {
  const base = `functions/api/internal/${name}`
  const deployed = readJson(`${base}.func/.vc-config.json`)
  assert.equal(deployed.runtime, 'nodejs22.x')
  assert.equal(deployed.maxDuration, 210)
  assert.equal(deployed.experimentalTriggers?.length, 1)
  assert.equal(deployed.experimentalTriggers[0].type, trigger)
  assert.equal(deployed.experimentalTriggers[0].topic, topic)
  assert.ok(!routes.includes(name), `Build Output contains a public route for ${name}.`)

  const alias = new URL(`${base}.rsc.func`, output)
  if (existsSync(alias)) assert.equal(realpathSync(alias), realpathSync(new URL(`${base}.func`, output)))
}
console.log('Verified private on-demand functions, hourly recovery schedule and no daemon.')
