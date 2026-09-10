/**
 * Synthetic DSH session fixtures.
 *
 * Tests and CI must never depend on a developer's private session logs, so the
 * ledger is exercised against hand-built event sequences with hand-computed
 * expected totals. The times are local noons, which makes the expected
 * calendar day the same in every timezone.
 *
 * @module dsh-token-ledger/test/fixtures
 */

import { zstdCompressSync } from 'node:zlib'

/** Local noon on 2026-01-15. */
export const DAY1 = new Date(2026, 0, 15, 12, 0, 0).getTime()
/** Local noon on 2026-01-16. */
export const DAY2 = new Date(2026, 0, 16, 12, 0, 0).getTime()
/** Local noon on 2026-01-17. */
export const DAY3 = new Date(2026, 0, 17, 12, 0, 0).getTime()

/** The provider/model every fixture call is attributed to. */
export const ROUTE = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

/**
 * A `request/header` recording the calling configuration.
 *
 * @param {{ provider?: string, model?: string, time?: number }} [options] - overrides.
 * @returns {object} the event.
 */
export function headerEvent({ provider = ROUTE.provider, model = ROUTE.model, time = DAY1 } = {}) {
  return {
    type: 'request/header',
    seq: 0,
    time,
    data: { header: { config: { provider, model, reasoningEffort: 'high', maxTokens: 256000 } } },
  }
}

/**
 * A user message.
 *
 * @param {string} text - message text.
 * @param {number} [time] - event time.
 * @returns {object} the event.
 */
export function userMessage(text, time = DAY1) {
  return { type: 'user/message', time, data: { role: 'user', content: [{ type: 'text', text }] } }
}

/**
 * A streaming `usage` chunk: a candidate sample, never authoritative alone.
 *
 * @param {{ turn: number, step: number, usage: object, time?: number }} input - the sample.
 * @returns {object} the event.
 */
export function usageChunk({ turn, step, usage, time = DAY1 }) {
  return { type: 'assistant/chunk', time, data: { turn, step, chunk: { type: 'usage', usage } } }
}

/**
 * Non-usage streaming content, which the ledger must ignore.
 *
 * @param {{ turn: number, step: number, time?: number }} input - location.
 * @returns {object} the event.
 */
export function textChunk({ turn, step, time = DAY1 }) {
  return { type: 'assistant/chunk', time, data: { turn, step, chunk: { type: 'text', text: 'hi' } } }
}

/**
 * A completed assistant message. Omitting `usage` models a cancelled or
 * max-token step, which must not be counted.
 *
 * @param {{ turn: number, step: number, usage?: object, time?: number }} input - the message.
 * @returns {object} the event.
 */
export function assistantMessage({ turn, step, usage, time = DAY1 }) {
  const data = { turn, step, message: { role: 'assistant', content: [] } }
  if (usage !== undefined) data.usage = usage
  return { type: 'assistant/message', time, data }
}

/**
 * A compaction summary, which is one provider call.
 *
 * @param {{ usage?: object, time?: number }} input - the summary.
 * @returns {object} the event.
 */
export function compactionSummary({ usage, time = DAY2 }) {
  const data = {}
  if (usage !== undefined) data.usage = usage
  return { type: 'compaction/summary', time, data }
}

/**
 * A step boundary, which discards any unfulfilled streaming sample.
 *
 * @param {number} turn - the turn.
 * @param {number} step - the step.
 * @param {number} [time] - event time.
 * @returns {object} the event.
 */
export function stepEnd(turn, step, time = DAY1) {
  return { type: 'step/end', time, data: { turn, step } }
}

/**
 * The usage of `sess-alpha`, with the arithmetic spelled out so the expected
 * totals in the test are auditable by reading this file.
 *
 * Commit ledger for `sess-alpha`:
 *
 * | location            | provider usage                        | counted |
 * | ------------------- | ------------------------------------- | ------- |
 * | turn 1 step 1       | chunk 1000/50/200 then same message    |    1250 |
 * | turn 1 step 2       | message 300/40/1500                    |    1840 |
 * | turn 1 step 3       | chunk 500/10/0 then message 500/20/900 |    1420 |
 * | turn 1 step 4       | message without usage                  |       0 |
 * | turn 1 step 5       | chunk 777/7/0, never fulfilled         |       0 |
 * | compaction (day 2)  | 1200/80/300                            |    1580 |
 * | turn 2 step 1       | message 100/30/0, reasoning 25         |     130 |
 * | **total**           |                                        |  **6220** |
 *
 * input 3100 + output 220 + cacheRead 2900 + cacheWrite 0 = 6220.
 */
export const ALPHA_EVENTS = [
  headerEvent({ time: DAY1 }),
  userMessage('count my tokens', DAY1),
  textChunk({ turn: 1, step: 1, time: DAY1 }),
  usageChunk({ turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200 }, time: DAY1 }),
  assistantMessage({
    turn: 1,
    step: 1,
    usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200, totalTokens: 1250 },
    time: DAY1,
  }),
  stepEnd(1, 1, DAY1),
  assistantMessage({
    turn: 1,
    step: 2,
    usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 1500, totalTokens: 1840 },
    time: DAY1,
  }),
  stepEnd(1, 2, DAY1),
  // Same attempt: the later, larger final value must replace the sample.
  usageChunk({ turn: 1, step: 3, usage: { inputTokens: 500, outputTokens: 10 }, time: DAY1 }),
  assistantMessage({
    turn: 1,
    step: 3,
    usage: { inputTokens: 500, outputTokens: 20, cacheReadTokens: 900, totalTokens: 1420 },
    time: DAY1,
  }),
  stepEnd(1, 3, DAY1),
  assistantMessage({ turn: 1, step: 4, time: DAY1 }),
  stepEnd(1, 4, DAY1),
  // A failed attempt: a sample arrives but no completed message ever does.
  usageChunk({ turn: 1, step: 5, usage: { inputTokens: 777, outputTokens: 7 }, time: DAY1 }),
  stepEnd(1, 5, DAY1),
  compactionSummary({ usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 300 }, time: DAY2 }),
  // A compaction summary with no usage must be skipped, not crash.
  compactionSummary({ time: DAY2 }),
  assistantMessage({
    turn: 2,
    step: 1,
    usage: { inputTokens: 100, outputTokens: 30, reasoningTokens: 25, totalTokens: 130 },
    time: DAY3,
  }),
]

/** Expected fold of {@link ALPHA_EVENTS}. */
export const ALPHA_EXPECTED = {
  calls: 5,
  inputTokens: 3100,
  outputTokens: 220,
  cacheReadTokens: 2900,
  cacheWriteTokens: 0,
  totalTokens: 6220,
  reasoningTokens: 25,
  sessionDays: { '2026-01-15': 4510, '2026-01-16': 1580, '2026-01-17': 130 },
}

/**
 * A forked session. The first four events are the inherited prefix and must
 * never be counted; the header inside that prefix must still supply the route.
 */
export const BETA_EVENTS = [
  userMessage('parent turn', DAY1),
  headerEvent({ time: DAY1 }),
  assistantMessage({
    turn: 1,
    step: 1,
    usage: { inputTokens: 999999, outputTokens: 1, totalTokens: 1000000 },
    time: DAY1,
  }),
  stepEnd(1, 1, DAY1),
  assistantMessage({
    turn: 2,
    step: 1,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    time: DAY3,
  }),
]

/** The inherited prefix length of {@link BETA_EVENTS}. */
export const BETA_INHERITED = 4

/** Expected fold of `sess-beta`: only the post-fork call counts. */
export const BETA_EXPECTED = { calls: 1, totalTokens: 15, modelKey: 'deepseek-official/deepseek-v4-flash' }

/** Expected fold of both fixture sessions together. */
export const COMBINED_EXPECTED = { calls: 6, totalTokens: 6220 + 15 }

/**
 * The events above are ordered as a real log is; give each a sequence number so
 * the fixture looks like stored data.
 *
 * @param {object[]} events - fixture events.
 * @returns {object[]} events carrying `seq`.
 */
export function withSeq(events) {
  return events.map((event, index) => ({ ...event, seq: index }))
}

/**
 * Encode events as a DSH-shaped log: concatenated Zstandard frames of JSONL.
 *
 * Frames are cut on event boundaries, mirroring how DSH flushes its log, and
 * `eventsPerFrame` lets a test produce a file with many frames.
 *
 * @param {object[]} events - the events to encode.
 * @param {{ eventsPerFrame?: number }} [options] - framing options.
 * @returns {Buffer} the encoded log.
 */
export function encodeSessionLog(events, { eventsPerFrame = 1 } = {}) {
  const frames = []
  for (let index = 0; index < events.length; index += eventsPerFrame) {
    const chunk = events.slice(index, index + eventsPerFrame)
    const text = chunk.map((event) => JSON.stringify(event)).join('\n') + '\n'
    frames.push(zstdCompressSync(Buffer.from(text, 'utf8')))
  }
  return Buffer.concat(frames)
}

/**
 * A minimal live-Session stand-in exposing the members the ledger reads.
 *
 * @param {string} id - session id.
 * @param {object[]} events - the session's events.
 * @param {{ inheritedEventCount?: number }} [options] - extra session fields.
 * @returns {object} a session-like object.
 */
export function fakeSession(id, events, { inheritedEventCount } = {}) {
  const session = {
    id,
    seq: events.length,
    header: {},
    eventAt: (index) => events[index],
  }
  if (inheritedEventCount !== undefined) session.inheritedEventCount = inheritedEventCount
  return session
}
