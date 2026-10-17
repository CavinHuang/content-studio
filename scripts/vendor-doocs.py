"""Vendor the audited doocs editor/renderer subset from a local pinned checkout.

Usage: python scripts/vendor-doocs.py /path/to/doocs-md
No network access, dependency installation, or upstream code execution.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SHA = '1bdad48d20048bddc8d32afb1b75a6475169f163'
source = Path(sys.argv[1]).resolve()
if subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() != SHA:
    raise SystemExit('Expected audited doocs commit ' + SHA)
if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=all'], text=True).strip():
    raise SystemExit('The audited doocs checkout must be clean')
dest = Path(__file__).resolve().parents[1] / 'vendor' / 'doocs'
dest.mkdir(parents=True, exist_ok=True)
files = [
    'core/src/renderer/renderer-impl.ts',
    'core/src/types/marked-tokens.ts',
    *['core/src/extensions/' + n + '.ts' for n in ['alert', 'component', 'emoji', 'emoji-data', 'footnotes', 'markup', 'ruby', 'slider', 'toc']],
    *['core/src/utils/' + n + '.ts' for n in ['basicHelpers', 'front-matter', 'languages', 'scan', 'svgCache']],
    *['shared/src/editor/' + n + '.ts' for n in ['markdown', 'format', 'codeLanguages']],
    'shared/src/utils/readingTime.ts',
    'shared/src/utils/formatDoc.ts',
    *['shared/src/types/' + p.name for p in (source / 'packages/shared/src/types').glob('*.ts')],
]
manifest = {}
for name in sorted(set(files)):
    original = (source / 'packages' / name).read_text()
    content = original
    if name.endswith('renderer-impl.ts'):
        start = content.index('import {\n  getBuiltInRegistry,')
        end = content.index("from '../extensions'", start) + len("from '../extensions'")
        imports = [('getBuiltInRegistry, markedComponent', 'component'), ('markedAlert', 'alert'), ('markedEmoji', 'emoji'), ('markedFootnotes', 'footnotes'), ('markedMarkup', 'markup'), ('markedRuby', 'ruby'), ('markedSlider', 'slider'), ('markedToc', 'toc')]
        content = content[:start] + '\n'.join("import { " + names + " } from '../extensions/" + path + "'" for names, path in imports) + content[end:]
        content = re.sub(r'  markdownParser.use\(MDKatex\([\s\S]*?\n  \}, true\)\)\n', '', content)
        for extension in ['markedMermaid', 'markedPlantUML', 'markedInfographic']:
            content = re.sub(r'  markdownParser.use\(' + extension + r'\([\s\S]*?\n  \}\)\)\)?\n', '', content)
        content = content.replace("export { initializeMermaid } from '../extensions/mermaid'", '')
    if name.endswith('extensions/alert.ts'):
        content = content.replace("from '../utils'", "from '../utils/basicHelpers'")
    if name.endswith('utils/languages.ts'):
        start = content.index('const HLJS_VERSION')
        end = content.index('function formatHighlightedCode', start)
        content = content[:start] + '''// Content Studio: only bundled grammars; no runtime CDN module execution.
export async function loadAndRegisterLanguage(language: string, hljs: HLJSApi): Promise<void> {
  if (!hljs.getLanguage(language)) throw new Error('Language grammar is not bundled')
}

''' + content[end:]
    target = dest / name
    def resolve_shared(match):
        suffix = match.group(1)
        location = dest / 'shared/src' / suffix
        rel = os.path.relpath(location, target.parent).replace(os.sep, '/')
        return "'" + (rel if rel.startswith('.') else './' + rel) + "'"
    content = re.sub(r"'@md/shared/([^']+)'", resolve_shared, content)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    manifest[name] = {'upstreamSha256': hashlib.sha256(original.encode()).hexdigest(), 'vendoredSha256': hashlib.sha256(content.encode()).hexdigest()}
(dest / 'LICENSE').write_text((source / 'LICENSE').read_text())
(dest / 'manifest.json').write_text(json.dumps({'commit': SHA, 'files': manifest}, ensure_ascii=False, indent=2) + '\n')
print('Vendored', len(manifest), 'files from', SHA)
