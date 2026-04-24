# Data model

The parent-level [architecture.md](../architecture.md) is the authoritative sketch for storage decisions (CPTs, field CPT, meta keys, loading shape). This document captures the client-facing contract and tracks implementation status; it will expand as the model lands.

## Target summary

- `cortext_page` CPT for hierarchical workspace documents.
- `cortext_collection` CPT, one post per collection definition. For each collection, a row CPT is dynamically registered as `crtxt_{slug}` (`crtxt_` is a vowel-stripped abbreviation of "cortext", chosen because WordPress's 20-character post type slug limit rules out the full `cortext_collection_` prefix).
- `cortext_field` CPT for field definitions, assigned to a collection via post meta and surfaced on each row CPT as dynamic meta keys.
- `cortext_supertag` global taxonomy attached to every collection CPT, so terms can cross collection boundaries.

## Single client contract

The shell reads one REST field on each row: `cortext_row_resolved_schema`. It returns the effective property set for that row, which is the union of the row's collection fields and the fields contributed by every supertag attached to it.

Keep row-schema knowledge out of bespoke endpoints. If the shell needs new properties, extend the resolved schema rather than adding a parallel endpoint; it keeps the client contract narrow and avoids divergence between server and client views of a row.

## UUID-based meta keys

Field identity is stable, but labels are not. Meta keys are UUIDs rather than slugs, so renaming a field label does not break stored values.

## Implementation status

Registered CPTs:

- `cortext_page` — hierarchical workspace documents.
- `cortext_collection` — collection definitions, with `notion_id` and `slug` meta. Fields are attached via multi-value `fields` meta (each value is a `cortext_field` post ID).
- `cortext_field` — field definitions, with `type`, `options`, `number_format`, `expression`, and `related_collection_id` meta.
- `crtxt_{slug}` — dynamically registered at `init` priority 20, one per published collection. Entry posts carry `notion_id` meta and `field-{$field_id}` meta per attached field.

Not yet registered: `cortext_supertag` taxonomy, `cortext_row_resolved_schema` REST field.
