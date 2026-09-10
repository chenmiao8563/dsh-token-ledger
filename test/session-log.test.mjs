/**
 * Session log decoding tests.
 *
 * The frame walker is the one piece of this package that parses a binary
 * format, so it gets structural tests: exact round trips, several frames per
 * file, and a truncated file that must fail loudly rather than yield half a
 * ledger.
 *
 * @module dsh-token-ledger/test/session-log.test
 */

import assert from 'node:assert/strict'
import { zstdCompressSync } from 'node:zlib'
import { test } from 'node:test'

import { decodeSessionLogBuffer, frameLengthAt, parseJsonLines, splitZstdFrames } from '../lib/session-log.js'
import { ALPHA_EVENTS, encodeSessionLog, withSeq } from './fixtures.mjs'

test('splits concatenated frames and covers every byte', () => {
  const events = withSeq(ALPHA_EVENTS)
  for (const eventsPerFrame of [1, 2, 3, 7, events.length]) {
    const buffer = encodeSessionLog(events, { eventsPerFrame })
    const frames = splitZstdFrames(buffer)
    assert.equal(frames.length, Math.ceil(events.length / eventsPerFrame), `eventsPerFrame=${eventsPerFrame}`)
    const covered = frames.reduce((sum, frame) => sum + frame.length, 0)
    assert.equal(covered, buffer.length)
    assert.deepEqual(decodeSessionLogBuffer(buffer), events)
  }
})

test('reads a single frame carrying many lines', () => {
  const events = withSeq(ALPHA_EVENTS)
  const buffer = encodeSessionLog(events, { eventsPerFrame: events.length })
  assert.equal(splitZstdFrames(buffer).length, 1)
  assert.equal(decodeSessionLogBuffer(buffer).length, events.length)
})

test('frameLengthAt reports the exact length of the frame at an offset', () => {
  const events = withSeq(ALPHA_EVENTS)
  const first = encodeSessionLog(events.slice(0, 2), { eventsPerFrame: 2 })
  const rest = encodeSessionLog(events.slice(2), { eventsPerFrame: 2 })
  const buffer = Buffer.concat([first, rest])

  const frames = splitZstdFrames(buffer)
  // Two events in the first frame, the remaining sixteen in frames of two.
  assert.equal(frames.length, 1 + Math.ceil((events.length - 2) / 2))
  assert.equal(frames[0].length, first.length)
  // Walking to any frame's offset must report that frame's length exactly.
  for (const frame of frames) {
    assert.equal(frameLengthAt(buffer, frame.offset), frame.length, `offset ${frame.offset}`)
  }
  assert.equal(frames.reduce((sum, frame) => sum + frame.length, 0), buffer.length)
})

test('rejects a buffer that does not start with a frame', () => {
  assert.throws(() => frameLengthAt(Buffer.from('not zstd at all'), 0), /no zstd magic/)
  assert.throws(() => splitZstdFrames(Buffer.from([1, 2, 3, 4, 5])), /no zstd magic/)
})

test('rejects a truncated frame instead of returning partial data', () => {
  const buffer = encodeSessionLog(withSeq(ALPHA_EVENTS), { eventsPerFrame: 2 })
  // Chopping bytes off the end must not decode as a shorter log.
  assert.throws(() => decodeSessionLogBuffer(buffer.subarray(0, buffer.length - 5)), /truncated/)
  // And a buffer cut to just the magic number is not silently empty.
  assert.throws(() => decodeSessionLogBuffer(buffer.subarray(0, 4)), /truncated/)
})

test('parseJsonLines skips the torn trailing line a killed writer leaves', () => {
  const text = '{"a":1}\n{"b":2}\n{"c":'
  assert.deepEqual(parseJsonLines(text), [{ a: 1 }, { b: 2 }])
  assert.deepEqual(parseJsonLines(''), [])
  assert.deepEqual(parseJsonLines('\n\n'), [])
})

test('an empty log decodes to no events', () => {
  const empty = zstdCompressSync(Buffer.from(''))
  assert.deepEqual(decodeSessionLogBuffer(empty), [])
})
