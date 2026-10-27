const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync('src/lib/commentMentions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const helpers = { exports: {} }
new Function('exports', 'module', compiled)(helpers.exports, helpers)
const { encodeComment, decodeComment, updateMentions, mentionQuery } = helpers.exports
const id = 'd6d7fa97-c3dc-450c-8e08-50d7c9b64026'
const mention = { start: 5, end: 17, userId: id, name: 'mario mario' }
test('selected identity and name survive storage and reload', () => {
  const body = encodeComment('Ciao @mario mario!', [mention])
  assert.deepEqual(decodeComment(body).filter(p => p.userId), [{ text: '@mario mario', userId: id }])
})
test('typing a name alone does not create an identity', () => {
  assert.equal(encodeComment('@mario mario', []), '@mario mario')
  assert.deepEqual(decodeComment('@mario mario'), [{ text: '@mario mario' }])
})
test('editing before, within and after a mention preserves only valid associations', () => {
  const m = { ...mention, end: 17 }
  const before = 'Ciao @mario mario !'
  // Exact range excludes trailing space.
  m.end = 17
  assert.equal(updateMentions(before, 'X' + before, [m])[0].start, 6)
  assert.equal(updateMentions(before, before.replace('mario', 'Maria'), [m]).length, 0)
  assert.deepEqual(updateMentions(before, before + 'ok', [m]), [m])
  assert.deepEqual(updateMentions(before, '', [m]), [])
})
test('trigger supports full names and caret, excludes emails and newlines', () => {
  assert.equal(mentionQuery('@mario ma', 9).query, 'mario ma')
  assert.equal(mentionQuery('a@b.it', 6), null)
  assert.equal(mentionQuery('@a\nhello', 8), null)
  assert.equal(mentionQuery('Hi @ma suffix', 6).query, 'ma')
})
test('special names round trip and malformed encoding remains text', () => {
  const name = 'Léa [A] % 😀'
  const text = '@' + name
  assert.equal(decodeComment(encodeComment(text, [{ start: 0, end: text.length, userId: id, name }]))[1].text, text)
  const malformed = '@[%](user:' + id + ')'
  assert.equal(decodeComment(malformed).map(p => p.text).join(''), malformed)
})



const routeSource = ts.transpileModule(fs.readFileSync('src/app/api/tasks/mention-members/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
async function requestMembers({ personal = false, outsider = false, pending = false, solo = false, authenticated = true } = {}) {
  const rows = {
    tasks: { project_id: 'project', owner_id: 'owner', approval_status: pending ? 'pending' : 'approved' },
    projects: { owner_id: solo ? id : 'owner', is_personal: personal },
    project_members: outsider || solo ? [] : [{ user_id: id }, { user_id: 'inactive' }, { user_id: 'other' }],
    users: [{ id, full_name: 'mario mario', is_active: true }, { id: 'owner', full_name: 'ates', is_active: true }, { id: 'inactive', full_name: 'Inactive', is_active: false }, { id: 'other', full_name: 'Other member', is_active: true }],
  }
  const admin = { from(table) {
    let data = rows[table]
    const builder = {
      select() { return builder },
      eq(column, value) { if (table === 'users') data = data.filter(row => row[column] === value); return builder },
      in(column, values) { data = data.filter(row => values.includes(row[column])); return builder },
      order() { return builder },
      single() { return Promise.resolve({ data }) },
      maybeSingle() { return Promise.resolve({ data }) },
      then(resolve) { return Promise.resolve({ data }).then(resolve) },
    }
    return builder
  } }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', routeSource)((name) => {
    if (name === 'next/server') return { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } }
    return { requireUser: async () => authenticated ? { user: { id }, admin } : null }
  }, module.exports, module)
  return module.exports.GET({ nextUrl: new URL('https://test.local/api/tasks/mention-members?taskId=' + id) })
}
test('endpoint excludes self, inactive users and includes project owner', async () => {
  const result = await requestMembers()
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.members.map(m => m.id), ['owner', 'other'])
})
test('personal Inbox and project without other members return no suggestions', async () => {
  assert.deepEqual((await requestMembers({ personal: true, solo: true })).data.members, [])
  assert.deepEqual((await requestMembers({ solo: true })).data.members, [])
})
test('endpoint rejects unauthenticated, outsider and hidden pending task access', async () => {
  assert.equal((await requestMembers({ authenticated: false })).status, 401)
  assert.equal((await requestMembers({ outsider: true })).status, 404)
  assert.equal((await requestMembers({ pending: true })).status, 404)
  assert.equal((await requestMembers({ personal: true })).status, 404)
})

