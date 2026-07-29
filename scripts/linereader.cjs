// Minimal manual line-by-line async iterator over a large file, as a
// replacement for Node's readline.createInterface — which throws
// "RangeError: Invalid string length" partway through this particular
// 3.3GB file (reproducible; not a corrupt-file issue, since a raw byte scan
// confirms every line is well under 3MB). Splits on '\n' at the Buffer level
// and only decodes each line to a string once it's isolated, so no giant
// intermediate string is ever built.
const fs = require('fs')

// A handful of source lines are enormous (multi-hundred-MB single features —
// confirmed real, not extraction corruption: a raw byte scan shows no long
// run without SOME '\n', but the interior of one feature's geometry can carry
// its own huge whitespace-padded coordinate dump). Buffer.toString() throws
// past V8's ~536M-char limit, so those lines are skipped (reported via
// onOversizedLine) rather than aborting the whole read.
async function* readLines(filePath, { highWaterMark = 8 * 1024 * 1024, onOversizedLine } = {}) {
  const stream = fs.createReadStream(filePath, { highWaterMark })
  let carry = Buffer.alloc(0)
  for await (const chunk of stream) {
    let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
    let start = 0
    for (;;) {
      const idx = buf.indexOf(10, start) // '\n'
      // A real copy, not a subarray view — a view here kept pinning (and, on
      // this file, seemingly corrupting/growing) the entire concatenated
      // buffer across iterations until it broke past Node's max string
      // length. Copying the small leftover instead is what actually fixed it.
      if (idx === -1) { carry = Buffer.from(buf.subarray(start)); break }
      try {
        yield buf.toString('utf8', start, idx)
      } catch (err) {
        onOversizedLine?.(idx - start, err)
      }
      start = idx + 1
    }
  }
  if (carry.length) {
    try { yield carry.toString('utf8') } catch (err) { onOversizedLine?.(carry.length, err) }
  }
}

module.exports = { readLines }
