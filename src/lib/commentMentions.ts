export type Mention = { start: number; end: number; userId: string; name: string }

// Persist identity and a name snapshot without interpreting HTML or arbitrary URLs.
export function encodeComment(text: string, mentions: Mention[]) {
  let body = text
  for (const m of [...mentions].sort((a, b) => b.start - a.start)) {
    if (text.slice(m.start, m.end) !== '@' + m.name) continue
    body = body.slice(0, m.start) + '@[' + encodeURIComponent(m.name) + '](user:' + m.userId + ')' + body.slice(m.end)
  }
  return body.trim()
}

export function decodeComment(body: string): Array<{ text: string; userId?: string }> {
  const parts: Array<{ text: string; userId?: string }> = []
  const pattern = /@\[([^\]\r\n]*)\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi
  let start = 0
  for (const match of body.matchAll(pattern)) {
    parts.push({ text: body.slice(start, match.index) })
    try { parts.push({ text: '@' + decodeURIComponent(match[1]), userId: match[2] }) }
    catch { parts.push({ text: match[0] }) }
    start = match.index! + match[0].length
  }
  parts.push({ text: body.slice(start) })
  return parts
}

// Editing a label removes its association; inserting text outside it preserves it.
export function updateMentions(before: string, after: string, mentions: Mention[]): Mention[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = before.length
  let newEnd = after.length
  while (end > start && newEnd > start && before[end - 1] === after[newEnd - 1]) { end--; newEnd-- }
  const delta = after.length - before.length
  return mentions.flatMap((m) => {
    if (m.end <= start) return [m]
    if (m.start >= end) return [{ ...m, start: m.start + delta, end: m.end + delta }]
    return []
  })
}

export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([^@\r\n]*)$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null
}

