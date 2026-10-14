# V35 · Reference-driven image edits / 候选图人工择优

## Scope

After V34 creates an illustration for a stable article slot, an author can ask a configured image API to **edit that image**. Unlike blind regeneration, the original file is sent as image input, and the instruction describes what to change. The original remains the active image until the author explicitly selects a candidate and separately approves its use.

### Workflow

1. Complete article, create plan, generate image, and optionally approve original (V32–V34).
2. In `/illustrations`, choose the current image or a previous candidate of **the same image slot** as the reference.
3. Enter a bounded instruction (12–800 characters), select OpenAI, Gemini Nano Banana, or Qwen; consent to sending the reference image to that provider.
4. The provider adapter sends the image **bytes** using its own protocol. Exactly **one** charged edit request is made per click. No automatic fallback.
5. The output is stored as an immutable candidate (`article_illustration_candidates`) associated with the source asset, instruction, provider/model, article revision and visual profile revision. Success/failure attempts are audited in `article_illustration_edits`.
6. Preview candidate alongside current image. Rejecting a candidate does not touch the active image. Choosing one makes it the **unapproved** active image, clears the old advisory review, and requires separate explicit human approval.
7. Publication-stage mapping remains asset-specific. The new image never inherits the old image's manually provided WeChat/Zhihu URL. Publishing is not automatic.

## Providers and current protocols

| Provider | Endpoint | Image input | Output |
| --- | --- | --- | --- |
| OpenAI GPT Image | `POST {CONTENT_IMAGE_OPENAI_BASE_URL}/images/edits` | multipart file `image` and `prompt` | base64 `data[0].b64_json` |
| Gemini Nano Banana | `POST {CONTENT_IMAGE_GEMINI_BASE_URL}/models/{model}:generateContent` | `contents[].parts[].inlineData` plus text | `candidates[].content.parts[].inlineData` |
| Qwen Image 3 | `POST {CONTENT_IMAGE_QWEN_BASE_URL}/images/generations` | JSON extension `image: data:image/*;base64,...` | temporary trusted Alibaba OSS URL or base64 |

API versions and model names vary by supplier/account; use `.env.local` configuration. An existing GPT Image generation adapter is reused; **image editing is a separate call contract**. Unspecified edit capability of a custom gateway must be tested with its own key. This feature does not implement masks, face editing, external reference URLs, or multi-image composition.

## Backend API

All endpoints are localhost/self-hosted and **require deployment authentication before exposure to the public internet**.

- `GET /api/illustrations/projects/:projectId`: includes each shot's `candidates[]` and `editAttempts[]`.
- `GET /api/illustrations/projects/:projectId/shots/:shotId/candidates`: list immutable candidates for this slot only.
- `GET /api/illustrations/projects/:projectId/shots/:shotId/edits`: audit attempts, errors abbreviated.
- `POST /api/illustrations/projects/:projectId/shots/:shotId/candidates`: `{allowExternalAI:true,expectedUpdatedAt,referenceAssetId,provider,instruction}`. Creates **one** candidate and returns `{candidate,shot}` with HTTP 201. Requires explicit consent; refuses stale source, invalid format, foreign slot reference, concurrent image operation or unconfigured provider.
- `POST /api/illustrations/projects/:projectId/shots/:shotId/candidates/:candidateId/decision`: `{decision:'select'|'reject',expectedUpdatedAt}`. Explicit selection never auto-approves or publishes.

The API enforces record ownership and optimistic locks. Changing the article body or visual profile invalidates candidate selection, and errors during remote editing do not replace the official asset.

## Acceptance and limits

- `npm test`: includes provider protocol mocks, scope and version tests, explicit consent, failed edit audit, immutability, concurrency, reject/select flow.
- `npm run check`: Node syntax.
- `npm run build`: must be executed in GitHub Actions with dependency installation (Next.js is not installed in this execution environment).
- **Real provider images, user-paid calls, WeChat/Zhihu actual paste, image quality, license, and accessibility remain unverified.** A candidate is an AI-created visual, never documentary evidence.
- Image assets are SQLite local blobs (<=6 MiB each); reference images are sent externally only with click-time consent. Neither keys nor image bytes are serialized into the regular JSON responses. Deploy behind authentication and secure backups before real use.

### Reference links

- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://ai.google.dev/gemini-api/docs/image-generation
- https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
