import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const tokens = JSON.parse(await readFile('docs/ux/design-tokens.json', 'utf8'))
assert.equal(tokens.color.background, '#fffcf7')
assert.equal(tokens.color.primary, '#34583b')
assert.equal(tokens.color.accent, '#f3e4d7')
assert.equal(tokens.color.sidebar, '#f2eee5')
assert.equal(tokens.radius.base, '0.625rem')
assert(
  !tokens.fontFamily && !tokens.fontSize && !tokens.density,
  'Do not reintroduce a competing type/spacing system',
)
// Relative luminance from the design palette's sRGB values (WCAG).
const luminance = (value) => {
  assert(/^#[\da-f]{6}$/i.test(value), `Expected an sRGB design color: ${value}`)
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
for (const [front, back] of [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'agent'],
  ['muted-foreground', 'sidebar'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'sidebar-accent'],
  ['muted-foreground', 'accent'],
  ['success', 'success-background'],
  ['warning', 'warning-background'],
  ['destructive-foreground', 'destructive'],
]) {
  const pair = [luminance(tokens.color[front]), luminance(tokens.color[back])].sort((a, b) => b - a)
  const ratio = (pair[0] + 0.05) / (pair[1] + 0.05)
  assert(ratio >= 4.5, `${front}/${back}: contrast below 4.5`)
  console.log(`${front}/${back}: ${ratio.toFixed(2)}:1`)
}
const root = 'src/renderer/src'
const entry = await readFile(`${root}/main.tsx`, 'utf8')
assert(
  !/styles\.css|design-system\.css|page-details\.css|fontsource/.test(entry),
  'Obsolete override/font imports',
)
const foundation = await readFile(`${root}/foundation.css`, 'utf8')
assert(foundation.includes("@import 'tailwindcss'") && foundation.includes("@import 'shadcn/tailwind.css'"))
assert(!/--font-sans:|--text-(?:sm|base):|--spacing:/.test(foundation), 'Keep the upstream Tailwind scales')
const layout = await readFile(`${root}/workspace.css`, 'utf8')
assert(layout.includes('@layer components'), 'Business layout must yield to component utility classes')
assert(
  !/!important|font-size:\s*\d|font:\s*\d|--font-ui|--density-/.test(layout),
  'Do not add custom type or competing density overrides',
)
assert(
  !/\.(?:sidebar-brand|sidebar-actions|sidebar-bottom|global-nav|project-item|project-children)\b/.test(
    layout,
  ),
  'Sidebar appearance belongs to the upstream components and explicit business composition classes',
)
assert(
  !/\.field\s+(?:input|textarea|select)\b|\.field\s*>\s*(?:input|textarea|select)\b/.test(layout),
  'Form control appearance belongs to the upstream Input/Textarea/NativeSelect, not ancestor CSS',
)
assert(
  !/\.search-field(?::focus-within|\s+input)\s*\{/.test(layout),
  'InputGroup owns search borders and focus; do not stack another outline',
)
assert(!/\.editor-view-switch[^\{]*\sbutton\b/.test(layout), 'Use the upstream Tabs for document views')
assert(
  !/agent-thread-popover|thread-item|agent-material-popover|brief-sentence/.test(layout),
  'Compose menus and fields with upstream components, without legacy control overrides',
)
const composition = await readFile(`${root}/components/ui.tsx`, 'utf8')
assert(
  !/<Label\s+className="field/.test(composition),
  'Keep FieldLabel and controls separate to avoid bold input text',
)
assert(
  composition.includes('<UIField') &&
    composition.includes('<FieldLabel') &&
    composition.includes('<FieldDescription'),
)
const button = await readFile(`${root}/components/ui/button.tsx`, 'utf8')
assert(button.includes("default: 'h-9 px-4 py-2"))
assert(!/unstyled:|unset:/.test(button), 'Use standard component variants and explicit composition classes')
const files = [
  `${root}/App.tsx`,
  `${root}/components/ui.tsx`,
  `${root}/components/Agent.tsx`,
  `${root}/components/StudioSidebar.tsx`,
  `${root}/components/CreationFlow.tsx`,
  `${root}/components/CreationComparison.tsx`,
  ...(await readdir(`${root}/pages`)).filter((n) => n.endsWith('.tsx')).map((n) => `${root}/pages/${n}`),
]
for (const file of files) {
  const source = await readFile(file, 'utf8')
  assert(
    !/<Card\b[^>]*\b(?:source-card|subtitle-row)\b/.test(source),
    `${file}: table rows must not stack Card frames inside an existing bordered list`,
  )
  for (const match of source.matchAll(/<(?:button|input|select|textarea)\b[^>]*>/g)) {
    const tag = match[0]
    // Radix Slot delegates the official sub-menu styles and behavior to this button.
    const composedSubButton =
      /^<button\b/.test(tag) &&
      /<SidebarMenuSubButton\b[^>]*\basChild\b[^>]*>\s*$/.test(source.slice(0, match.index))
    assert(
      /^<input\b[\s\S]*type="file"/.test(tag) || composedSubButton,
      `${file}: native control bypasses shadcn/ui`,
    )
  }
  assert(!/variant="unstyled"|size="unset"/.test(source), `${file}: obsolete variants`)
}
// Copy gates from the v2.3 word table (docs/ux/DESIGN-SYSTEM.md N1/N4, UX-FIX-PLAN §1 门禁扩展).
// App.tsx is not listed yet: its design-overview helper intentionally names docs/ux/index.html and
// is owned by another batch; every page, panel component and studio data module is covered here.
const copyFiles = [
  `${root}/components/ui.tsx`,
  `${root}/components/Agent.tsx`,
  `${root}/components/StudioSidebar.tsx`,
  `${root}/components/CreationFlow.tsx`,
  `${root}/components/CreationComparison.tsx`,
  `${root}/studio/creation.ts`,
  `${root}/studio/mock.ts`,
  `${root}/studio/store.tsx`,
  `${root}/studio/types.ts`,
  ...(await readdir(`${root}/pages`)).filter((n) => n.endsWith('.tsx')).map((n) => `${root}/pages/${n}`),
]
for (const file of copyFiles) {
  const source = await readFile(file, 'utf8')
  assert(
    !/[\u4e00-\u9fff][?!.,;:]/.test(source),
    `${file}: half-width punctuation directly after CJK (N4: use full-width ？！。，；：)`,
  )
  // Service names like 自然叙述（Mock） are entity names and may keep （Mock） — no other copy may.
  const withoutServiceNames = source.replaceAll(/(?:创作助手|视觉助手|自然叙述)（Mock）/g, '')
  assert(
    !/[（(]\s*Mock\s*[)）]/.test(withoutServiceNames),
    `${file}: user-visible copy must not carry a (Mock) suffix (N1: badge or description carries the demo state)`,
  )
  assert(!/docs\/|src\//.test(source), `${file}: user-visible strings must not leak repository paths (E2)`)
}
console.log('Tailwind/shadcn foundation, standard controls and business CSS boundaries verified.')
