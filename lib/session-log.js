/**
 * Offline reader for DSH session logs.
 *
 * A DSH session log is a concatenation of independent Zstandard frames, each
 * frame holding a chunk of newline-delimited JSON. Node's zstd entry points
 * stop after the first frame, so the frames must be delimited explicitly
 * before decompression.
 *
 * This module walks the frame structure described by RFC 8878 (magic number,
 * frame header, block headers, optional content checksum) instead of scanning
 * for the magic byte sequence, because a magic scan can match bytes inside
 * compressed block payloads and silently split a frame in half.
 *
 * Every function here is synchronous, dependency-free, and read-only.
 *
 * @module dsh-token-ledger/session-log
 */

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** Zstandard frame magic number, stored little-endian: 0xFD2FB528. */
const ZSTD_MAGIC = 0xfd2fb528

/** A Zstandard frame can be at most 128 KiB of header plus blocks; this bounds a walk. */
const MAX_DICTIONARY_ID_BYTES = [0, 1, 2, 4]

/**
 * Read the length of the frame starting at `start`.
 *
 * @param {Buffer} buffer - the whole file.
 * @param {number} start - offset of the frame's magic number.
 * @returns {number} the frame length in bytes.
 * @throws {Error} when the frame is truncated or structurally invalid.
 */
export function frameLengthAt(buffer, start) {
  if (start + 4 > buffer.length) throw new Error(`truncated frame magic at offset ${start}`)
  if (buffer.readUInt32LE(start) !== ZSTD_MAGIC) {
    throw new Error(`no zstd magic at offset ${start}`)
  }

  let cursor = start + 4
  if (cursor + 1 > buffer.length) throw new Error(`truncated frame header at offset ${start}`)
  const descriptor = buffer.readUInt8(cursor)
  cursor += 1

  const contentSizeFlag = (descriptor >> 6) & 0x3
  const singleSegment = (descriptor >> 5) & 0x1
  const checksumFlag = (descriptor >> 2) & 0x1
  const dictionaryIdFlag = descriptor & 0x3

  // Window_Descriptor is present only when Single_Segment_flag is clear.
  if (singleSegment === 0) cursor += 1
  cursor += MAX_DICTIONARY_ID_BYTES[dictionaryIdFlag]

  // 0 bytes when the flag is 0 and a single segment is declared is not allowed;
  // the spec maps flag 0 to 1 byte in that case.
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment === 1 ? 1 : 0) : 1 << contentSizeFlag
  cursor += contentSizeBytes

  if (cursor > buffer.length) throw new Error(`truncated frame header at offset ${start}`)

  // Walk the block sequence to find where this frame ends.
  for (;;) {
    if (cursor + 3 > buffer.length) throw new Error(`truncated block header at offset ${cursor}`)
    const header = buffer.readUInt8(cursor) | (buffer.readUInt8(cursor + 1) << 8) | (buffer.readUInt8(cursor + 2) << 16)
    const lastBlock = (header & 0x1) === 1
    const blockType = (header >> 1) & 0x3
    const blockSize = header >> 3
    cursor += 3
    if (blockType === 3) throw new Error(`reserved block type at offset ${cursor - 3}`)
    cursor += blockType === 1 ? 1 : blockSize
    if (cursor > buffer.length) throw new Error(`truncated block payload at offset ${start}`)
    if (lastBlock) break
  }

  if (checksumFlag === 1) cursor += 4
  if (cursor > buffer.length) throw new Error(`truncated content checksum at offset ${start}`)
  return cursor - start
}

/**
 * Delimit every Zstandard frame in a buffer.
 *
 * @param {Buffer} buffer - a DSH session log's raw bytes.
 * @returns {{ offset: number, length: number }[]} frames in file order.
 */
export function splitZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const length = frameLengthAt(buffer, offset)
    frames.push({ offset, length })
    offset += length
  }
  return frames
}

/**
 * Decode a buffer of concatenated Zstandard frames into its raw text and then
 * into JSON events.
 *
 * @param {Buffer} buffer - a DSH session log's raw bytes.
 * @returns {object[]} every parseable JSON record, in order. Unparseable lines
 *   are skipped rather than failing the whole log.
 */
export function decodeSessionLogBuffer(buffer) {
  const parts = []
  for (const frame of splitZstdFrames(buffer)) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.offset, frame.offset + frame.length)))
  }
  return parseJsonLines(Buffer.concat(parts).toString('utf8'))
}

/**
 * Split newline-delimited JSON into records, skipping lines that do not parse.
 *
 * @param {string} text - the decompressed log text.
 * @returns {object[]} the parsed records.
 */
export function parseJsonLines(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A torn trailing line is normal for a log whose writer was killed.
    }
  }
  return events
}

/**
 * Read and decode one DSH session log file.
 *
 * @param {string} path - path to a `session.jsonl.zstd` file.
 * @returns {object[]} every JSON event in the log, in order.
 */
export function readSessionLog(path) {
  return decodeSessionLogBuffer(readFileSync(path))
}
