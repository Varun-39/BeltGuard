// Run: node --experimental-strip-types src/commands.check.ts
import assert from 'node:assert/strict'
import { parseCommand } from './commands.ts'

const sel = (id: string) => ({ type: 'select', id })
assert.deepEqual(parseCommand('show idler four'), sel('idler04'))
assert.deepEqual(parseCommand('Bearing'), sel('idler04'))
assert.deepEqual(parseCommand('go to the splice'), sel('splice'))
assert.deepEqual(parseCommand('take-up'), sel('takeup'))
assert.deepEqual(parseCommand('show take up'), sel('takeup'))
assert.deepEqual(parseCommand('tail pulley'), sel('tail'))
assert.deepEqual(parseCommand('head pulley'), sel('head'))      // not "belt"/"pulley" ambiguity
assert.deepEqual(parseCommand('drive motor'), sel('head'))
assert.deepEqual(parseCommand('open the camera'), sel('camera'))
assert.deepEqual(parseCommand('belt'), sel('belt'))
assert.deepEqual(parseCommand('back to overview'), { type: 'overview' })
assert.deepEqual(parseCommand('pause'), { type: 'pause' })
assert.deepEqual(parseCommand('go live'), { type: 'resume' })
assert.deepEqual(parseCommand("what's wrong"), { type: 'status' })
assert.equal(parseCommand('hello there'), null)
assert.equal(parseCommand('   '), null)
console.log('commands ok')
