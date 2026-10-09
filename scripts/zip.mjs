// A small zip writer and reader (store + deflate, no zip64, no encryption): enough for `bun run package` and its tests,
// so packaging needs no `zip` binary. Entries are written in the order given, with a fixed timestamp, so the same
// files always give the same bytes.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const DOS_TIME = 0 // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01

/** @param {Buffer} buffer @param {number} at */
const u16 = (buffer, at) => buffer.readUInt16LE(at)
/** @param {Buffer} buffer @param {number} at */
const u32 = (buffer, at) => buffer.readUInt32LE(at)

/**
 * @param {{ name: string, data: Buffer }[]} entries `name` uses "/" and has no leading slash
 * @returns {Buffer}
 */
export function createZip(entries) {
  /** @type {Buffer[]} */
  const parts = []
  /** @type {Buffer[]} */
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const deflated = packed.length < data.length
    const body = deflated ? packed : data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(deflated ? 8 : 0, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(0x031e, 4) // made by: Unix, 3.0
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(deflated ? 8 : 0, 10)
    head.writeUInt16LE(DOS_TIME, 12)
    head.writeUInt16LE(DOS_DATE, 14)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(body.length, 20)
    head.writeUInt32LE(data.length, 24)
    head.writeUInt16LE(nameBytes.length, 28)
    head.writeUInt32LE((0o100644 << 16) >>> 0, 38) // external attributes: a regular file, rw-r--r--
    head.writeUInt32LE(offset, 42)

    parts.push(local, nameBytes, body)
    central.push(head, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, ...central, end])
}

/**
 * Read a zip made by `createZip` (or any zip without zip64 / encryption).
 * @param {Buffer} zip
 * @returns {Map<string, Buffer>} name -> bytes (directories are not listed)
 */
export function readZip(zip) {
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (u32(zip, at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('not a zip file')

  const count = u16(zip, end + 10)
  let at = u32(zip, end + 16)
  /** @type {Map<string, Buffer>} */
  const files = new Map()

  for (let i = 0; i < count; i++) {
    if (u32(zip, at) !== 0x02014b50) throw new Error('broken zip directory')

    const method = u16(zip, at + 10)
    const crc = u32(zip, at + 16)
    const packedSize = u32(zip, at + 20)
    const size = u32(zip, at + 24)
    const nameLength = u16(zip, at + 28)
    const extraLength = u16(zip, at + 30)
    const commentLength = u16(zip, at + 32)
    const local = u32(zip, at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)

    at += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue

    const dataAt = local + 30 + u16(zip, local + 26) + u16(zip, local + 28)
    const body = zip.subarray(dataAt, dataAt + packedSize)
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)

    if (data.length !== size || crc32(data) !== crc) throw new Error(`broken zip entry ${name}`)
    files.set(name, data)
  }

  return files
}
