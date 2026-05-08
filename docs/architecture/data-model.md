# Data model

The parent-level [architecture.md](../architecture.md) is the main sketch for storage decisions: CPTs, field CPT, meta keys, and loading shape. This page tracks the prototype as it exists today. It is not a stable public API. Stored shapes may change without backward compatibility until the data model settles.

## Target summary

-   `crtxt_page` CPT for hierarchical workspace documents.
-   `crtxt_collection` CPT, one post per collection definition. For each collection, a row CPT is dynamically registered as `crtxt_{slug}` (`crtxt_` is the shared data prefix and leaves room for the collection slug under WordPress's 20-character post type limit).
-   `crtxt_field` CPT for field definitions, assigned to a collection via post meta and surfaced on each row CPT as dynamic meta keys.
-   `cortext_supertag` global taxonomy attached to every collection CPT, so terms can cross collection boundaries.

## Single client contract

The target shell contract is one REST field on each row: `cortext_row_resolved_schema`. It will return the effective property set for that row: collection fields plus fields contributed by every attached cross-type tag.

Keep row-schema knowledge out of one-off endpoints. If the shell needs new properties, extend the resolved schema instead of adding a parallel endpoint. That keeps the client contract small and reduces drift between server and client views of a row.

## Field-id-based meta keys

Field labels can change. Field IDs should not. Entry values use `field-{$field_id}` meta keys rather than label-derived slugs, so renaming a field does not break stored values.

## Implementation status

Registered CPTs:

-   `crtxt_page` — hierarchical workspace documents.
-   `crtxt_collection` — collection definitions, with `slug` meta. Fields are attached via multi-value `fields` meta (each value is a `crtxt_field` post ID).
-   `crtxt_field` — field definitions, with `type`, `options`, `number_format`, `expression`, and `related_collection_id` meta.
-   `crtxt_{slug}` — dynamically registered at `init` priority 20, one per published collection. Entry posts carry `field-{$field_id}` meta per attached field.

Not yet registered: `cortext_supertag` taxonomy, `cortext_row_resolved_schema` REST field.

## Future import shape

Import is a stretch goal, not part of the current data contract. The working sketch lives in [data-model-intermediate-json.md](./data-model-intermediate-json.md). Treat it as a draft for discussion, not as something callers can rely on.
