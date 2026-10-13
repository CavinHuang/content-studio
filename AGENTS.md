# Coding Agent brief — Content Studio

- Keep Next.js 16 App Router as the single primary web frontend. Do not create a second competing editor data model.
- Preserve V27 domain invariants: immutable revisions, `expectedRevision` conflict detection, independent master/wechat/zhihu, four per-channel manual checks, export != actual publish, and explicit sourcing of evidence.
- AI model output and community problem signals are hypotheses, not established facts. Protect private notes; no automatic publication.
- Never write real secrets, DB files, or user data to Git; honor .gitignore.
- `node:sqlite` requires Node 22.13+ and a persistent single-process disk. Never deploy to Edge or a stateless serverless runtime.
- Default to localhost; require separate security work for authentication, authorization, CSRF, backups and multi-tenancy before production deployment.
- Every change: run `npm run check`, `npm test`, `npm run build` once dependencies are available; update QA reports honestly.
- User-facing interface: restrained off-white, forest green accent, five creator nav items, clear evidence/provenance, no noise.
