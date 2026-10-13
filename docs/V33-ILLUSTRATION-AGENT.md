# V33 Illustration Agent — architecture and image prompts

Status: engineering preview; contract-tested with mocked external model responses. **No paid external generation, doocs/md upload, or WeChat/Zhihu editor paste has been verified.**

## What the agent does

1. **Understand / Plan** — on the current immutable master revision, propose 1 landscape cover and up to 2 scene illustrations anchored to stable paragraph IDs. Local deterministic planning requires no API. When configured, the optional reasoning LLM can rewrite the **scene briefs** and choose editorial / diagram / abstract style, but it cannot introduce new paragraph anchors or unsupported claims.
2. **Art direction / Prompt** — compose a provider-specific final prompt from the article title, validated scene, visual style, role, and global editorial constraints. Authors can inspect/edit the scene before paying for a generation. A scene update invalidates the previous image/approval, but preserves existing material in the private asset library.
3. **Generate** — choose OpenAI GPT Image, Google Nano Banana (Gemini), or Qwen Image **per shot**. Provider adapters normalize response image bytes for local storage. Models and API Keys are configured in server environment variables. Never send the whole article by default; only title, selected short excerpts and the validated scene brief.
4. **Review** — a human approves or rejects individual generated pictures. Generation is never equivalent to fact verification, image rights clearance, or channel QA.
5. **Deliver** — approved images still need channel-specific HTTPS image URLs, supplied after author-controlled upload. The generated Markdown is **a proposal only** and must pass the existing V30/V31 review before becoming a saved channel revision. Neither URL mapping nor copying Markdown proves images rendered in a real platform editor.

## State machine

`planned → generating → generated → approved / rejected`

`failed → generating` on explicit retry. Updating the visual brief resets the shot to `planned` and clears prior approval. A source article revision makes its entire plan stale (409); the old image assets remain for historical reference. Editing and approving a shot must not overwrite unrelated channels.

## Prompt recipe (previewable per model)

Input: `title`, `excerpt`, `role`, `scene`, `style`, `provider`.

Shared contract:

> Illustrate a Chinese-language technology article. Topic: {title}. Visual brief: {scene}. Contemporary editorial visual system in white/warm neutrals/low-saturation forest green. Cover 16:9 with a focal point and clean title safe area; section image 3:2. No written words, fictional dashboard screenshots, measurements without evidence, logos, watermarks, or identifiable people. The illustration is not evidence of a real-world experiment.

| Adapter | Prompt adjustment | Request | Response |
|---|---|---|---|
| OpenAI GPT Image 2/2.5 | Print-quality illustration, precise composition, visual metaphor | Images `POST /images/generations`, `1536x864` cover when supported; fallback `1536x1024` | `data[0].b64_json` |
| Google Nano Banana | Art-director instruction, coherent geometry and visual hierarchy | Gemini `models/{model}:generateContent`, `generationConfig.responseModalities=['IMAGE']`, aspectRatio | `candidates[].content.parts[].inlineData.data` |
| Qwen Image | Material consistency, foreground/background, clear silhouette | Alibaba `compatible-mode/v1/images/generations`, landscape `size` | Temporary OSS HTTPS URL; downloaded immediately to private asset library, validated against allowed Aliyun OSS domain and image magic bytes |

The exact model IDs are environment values, not hardwired into the authoring workflow. Qwen 3.0 and 2.1 model availability/regions depend on your provider account; use a base URL and key from the **same region**.

## Prompt planner protocol

`POST /api/illustrations/projects/:projectId/agent-plan`

Body: `{"expectedMasterRevision":1,"allowExternalAI":true}`. Requires separate text model configuration `CONTENT_ILLUSTRATION_PLANNER_*` and explicit consent to sending excerpts. Uses OpenAI-compatible Chat Completions and a validated JSON object:

```json
{
  "scenes": [
    {"role":"cover", "paragraphId":"", "scene":"A layered paper architecture showing an assistant connecting a set of tool cards under a single guiding beam of light.", "style":"editorial"},
    {"role":"section", "paragraphId":"existing paragraph ID", "scene":"Three abstract processing stages connected with one visible retry loop; avoid labels and numerical claims.", "style":"diagram"}
  ]
}
```

Exactly one result per provided slot, same order, valid role and paragraph IDs, 12–800 scene characters; malformed outputs fail rather than creating unanchored shots.

## Additional endpoints

- `GET /api/illustrations/projects/:id` → source revision, configured provider names (never keys), planner status, shots.
- `POST /api/illustrations/projects/:id/plan` → deterministic local plan (no external AI call).
- `GET /api/illustrations/projects/:id/shots/:shotId/prompt-preview?provider=gemini` → final prompt without paying.
- `PUT /api/illustrations/projects/:id/shots/:shotId/prompt` → `{expectedUpdatedAt,scene,style,provider}`; rejects stale edits and resets generated/approved state.
- `POST /api/illustrations/projects/:id/shots/:shotId/generate` → `{allowExternalAI:true,provider:'openai'|'gemini'|'qwen'}`.
- Existing approve/reject, per-channel mapping, handoff remain unchanged.

## Privacy and security

- Local-only server, explicit model-call opt-in, no `NEXT_PUBLIC_` secrets, no implicit auto-publish.
- Qwen result URLs are short-lived. Permit HTTPS Aliyun OSS hosts only, disable redirects, cap image response sizes, and validate bytes in `AssetService`.
- API keys are never included in error messages, storage tables or prompt previews.
- For private material, remove names/client details from selected excerpts *before* sending to an external LLM. Current workflow asks for author consent; it does not perform reliable redaction.
- Generated diagrams cannot be treated as screenshots, measured benchmark plots, or documentary evidence.
- Before public internet deployment: add authentication, CSRF safeguards, provider quotas/budgets, background job queue and request-level abuse controls.

## Sources

- OpenAI GPT Image model/API: https://developers.openai.com/api/docs/guides/image-generation
- Google Gemini image generation / Nano Banana: https://ai.google.dev/gemini-api/docs/image-generation
- Qwen Image OpenAI-compatible API: https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
