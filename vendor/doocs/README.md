# doocs/md editor and renderer subset

Source: https://github.com/doocs/md/tree/1bdad48d20048bddc8d32afb1b75a6475169f163

Includes the upstream Markdown editing extensions, format commands, renderer,
and supporting modules under its accompanying WTFPL license. React hosts these
modules directly; no second article store or public editor site is used.

Reproduce with `python scripts/vendor-doocs.py /path/to/pinned/doocs-md`.
`manifest.json` records source and transformed file hashes.

Local changes: workspace aliases become relative imports; renderer imports only
the supported extensions; automatic MathJax/PlantUML/Mermaid/infographic execution
is omitted, leaving their source editable; highlighting uses bundled grammars
without executing CDN scripts. Content Studio supplies its own sanitized preview,
theme, persistence, image handling and AI UI. This is an integration of doocs
modules, not the complete standalone Vue application's feature set.
