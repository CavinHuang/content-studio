export type TextChange = { kind: 'same' | 'removed' | 'added'; text: string }

// Bounded line LCS: large changes fall back to complete changed spans, never truncate text.
export function textDiff(before: string, after: string): TextChange[] {
  const a = before.split('\n'),
    b = after.split('\n')
  let prefix = 0,
    suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  )
    suffix++
  const left = a.slice(prefix, a.length - suffix),
    right = b.slice(prefix, b.length - suffix)
  const lines: { kind: TextChange['kind']; line: string }[] = a
    .slice(0, prefix)
    .map((line) => ({ kind: 'same', line }))
  if ((left.length + 1) * (right.length + 1) <= 100_000) {
    const width = right.length + 1
    const table = new Uint32Array((left.length + 1) * width)
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--)
        table[i * width + j] =
          left[i] === right[j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    let i = 0,
      j = 0
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        lines.push({ kind: 'same', line: left[i++]! })
        j++
      } else if (
        i < left.length &&
        (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
      )
        lines.push({ kind: 'removed', line: left[i++]! })
      else lines.push({ kind: 'added', line: right[j++]! })
    }
  } else {
    lines.push(
      ...left.map((line) => ({ kind: 'removed' as const, line })),
      ...right.map((line) => ({ kind: 'added' as const, line })),
    )
  }
  lines.push(...a.slice(a.length - suffix).map((line) => ({ kind: 'same' as const, line })))
  const groups: TextChange[] = []
  for (const item of lines) {
    const last = groups.at(-1)
    if (last?.kind === item.kind) last.text += '\n' + item.line
    else groups.push({ kind: item.kind, text: item.line })
  }
  return groups
}
