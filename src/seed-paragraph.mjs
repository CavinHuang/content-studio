// Default first paragraph of a brand-new editorial project (used by
// EditorialService.create, src/editorial.mjs). Kept in its own
// dependency-free module so server-side services and pure client-safe
// adapters (src/creator-home.mjs) can tell the untouched template from
// author-written content without duplicating the string.
export const SEED_PARAGRAPH_TEXT =
  "请用自己的实践、观察和可靠来源逐段写作，未经核实的结论不可直接发表。";
