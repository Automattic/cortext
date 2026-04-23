# Data model

The parent-level [architecture.md](../architecture.md) is the authoritative sketch for storage decisions (CPTs, field CPT, meta keys, loading shape). This document captures the client-facing contract and tracks implementation status; it will expand as the model lands.

## Target summary

- `cortext_page` CPT for hierarchical workspace documents.
- `cortext_collection` CPT, one post per collection definition. For each collection, a row CPT is dynamically registered as `cortext_collection_{slug}`.
- `cortext_field` CPT for field definitions, assigned to a collection via post meta and surfaced on each row CPT as dynamic meta keys.
- `cortext_supertag` global taxonomy attached to every collection CPT, so terms can cross collection boundaries.

## Single client contract

The shell reads one REST field on each row: `cortext_row_resolved_schema`. It returns the effective property set for that row, which is the union of the row's collection fields and the fields contributed by every supertag attached to it.

Keep row-schema knowledge out of bespoke endpoints. If the shell needs new properties, extend the resolved schema rather than adding a parallel endpoint; it keeps the client contract narrow and avoids divergence between server and client views of a row.

## UUID-based meta keys

Field identity is stable, but labels are not. Meta keys are UUIDs rather than slugs, so renaming a field label does not break stored values.

## Implementation status

Early PoC. No CPTs or taxonomies are registered yet; the shell currently edits core `page` posts as a stand-in for `cortext_page` (see [shell.md](./shell.md)). Fill this document in as `register_post_type`, `register_taxonomy`, and `register_rest_field` calls land.
