/** Inspect repository candidates or an extracted package without logging matched content. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { homedir } from 'node:os'

const repository = resolve(import.meta.dirname, '..')
const directory = process.argv[2] ? resolve(process.argv[2]) : null
const violations = []
const paths = []
if (directory) {
  async function walk(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name)
      const name = relative(directory, path).replaceAll('\\', '/')
      if (entry.isSymbolicLink() || entry.name === 'node_modules') {
        violations.push({ file: name, rule: 'unexpected-link-or-dependency' })
      } else if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) paths.push(path)
    }
  }
  await walk(directory)
} else {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repository, encoding: 'utf8' })
  paths.push(...[...new Set(listed.split('\0').filter(Boolean))].map(path => resolve(repository, path)))
}

const patterns = [
  ['personal-machine-path', /(?:\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+|\b[A-Z]:[\\/]+Projects[\\/]+[^\\/\s"'<>]+)/iu],
  ['credential-like-literal', /(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/u],
  ['private-key', new RegExp('-{5}BEGIN (?:[A-Z]+ )?PRIVATE KEY-{5}', 'u')],
]
const localPaths = [repository, homedir()].filter(path => path.length > 8).map(path => path.replaceAll('\\', '/').toLowerCase())
let bytes = 0
let files = 0
function inspect(buffer, file) {
  const views = [buffer.toString('utf8'), buffer.toString('utf16le')]
  for (const text of views) {
    const normalized = text.replaceAll('\\\\', '\\').replaceAll('\\', '/').toLowerCase()
    if (localPaths.some(path => normalized.includes(path))) violations.push({ file, rule: 'local-environment-path' })
    for (const [rule, pattern] of patterns) if (pattern.test(text.replaceAll('\\\\', '\\'))) violations.push({ file, rule })
  }
  // Bundled image data may contain metadata too.
  for (const match of views[0].matchAll(/data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/giu)) {
    const image = Buffer.from(match[1], 'base64')
    for (const [rule, pattern] of patterns) if (pattern.test(image.toString('utf8')) || pattern.test(image.toString('utf16le'))) violations.push({ file, rule: `embedded-image-${rule}` })
  }
}
for (const path of paths) {
  const metadata = await lstat(path).catch(() => null)
  if (!metadata?.isFile()) continue
  const file = relative(directory ?? repository, path).replaceAll('\\', '/')
  if (/(?:^|\/)(?:\.git|\.client-build|dist|profiles|sessions|compat-checks)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:log|pem|key|tgz|tar\.gz)$/iu.test(file)) {
    violations.push({ file, rule: 'private-or-generated-artifact-path' })
  }
  const buffer = await readFile(path)
  inspect(buffer, file)
  if (/^(?:src\/compat\/|src\/client\/provider-settings\.tsx$)/u.test(file) && /https?:\/\/[a-z0-9]/iu.test(buffer.toString('utf8'))) {
    violations.push({ file, rule: 'fixed-production-endpoint' })
  }
  files++
  bytes += buffer.length
}
const unique = [...new Map(violations.map(item => [JSON.stringify(item), item])).values()]
if (unique.length) process.stderr.write(JSON.stringify({ violations: unique }, null, 2) + '\n')
assert.equal(unique.length, 0, 'Distribution inspection failed; matched content was not printed.')
console.log(JSON.stringify({ scope: directory ? 'extracted-package' : 'repository-candidates', files, bytes, violations: 0 }))
