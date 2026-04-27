# Data model

The parent-level [architecture.md](../architecture.md) is the authoritative sketch for storage decisions (CPTs, field CPT, meta keys, loading shape). This document captures the client-facing contract and tracks implementation status; it will expand as the model lands.

## Target summary

- `crtxt_page` CPT for hierarchical workspace documents.
- `crtxt_collection` CPT, one post per collection definition. For each collection, a row CPT is dynamically registered as `crtxt_{slug}` (`crtxt_` is the shared data prefix and leaves room for the collection slug under WordPress's 20-character post type limit).
- `crtxt_field` CPT for field definitions, assigned to a collection via post meta and surfaced on each row CPT as dynamic meta keys.
- `cortext_supertag` global taxonomy attached to every collection CPT, so terms can cross collection boundaries.

## Single client contract

The shell reads one REST field on each row: `cortext_row_resolved_schema`. It returns the effective property set for that row, which is the union of the row's collection fields and the fields contributed by every supertag attached to it.

Keep row-schema knowledge out of bespoke endpoints. If the shell needs new properties, extend the resolved schema rather than adding a parallel endpoint; it keeps the client contract narrow and avoids divergence between server and client views of a row.

## UUID-based meta keys

Field identity is stable, but labels are not. Meta keys are UUIDs rather than slugs, so renaming a field label does not break stored values.

## Implementation status

Registered CPTs:

- `crtxt_page` — hierarchical workspace documents.
- `crtxt_collection` — collection definitions, with `notion_id` and `slug` meta. Fields are attached via multi-value `fields` meta (each value is a `crtxt_field` post ID).
- `crtxt_field` — field definitions, with `type`, `options`, `number_format`, `expression`, and `related_collection_id` meta.
- `crtxt_{slug}` — dynamically registered at `init` priority 20, one per published collection. Entry posts carry `notion_id` meta and `field-{$field_id}` meta per attached field.

Not yet registered: `cortext_supertag` taxonomy, `cortext_row_resolved_schema` REST field.

## Import from intermediate JSON

A future importer should consume the intermediate JSON format defined in [data-model-intermediate-json.md](./data-model-intermediate-json.md). Some possibilities as of this writing:
- Input is a file; entry point will be a WP-CLI command (`wp cortext import <file.json>`).
- Importing would be requested via the web application and delegated to a WordPress background job.

### Import order

Relations between databases require the related entry's WP post ID to already exist. Always import in this order:

1. For each database: create the `crtxt_collection` post, then call `CollectionEntries::register_for_collection()` so the entry CPT is available in the same request.
2. For each database: create `crtxt_field` posts, attach to collection via `add_post_meta( $collection_id, 'fields', $field_id )`, and register their entry-level meta.
3. Insert all entries **without** relation values. Build a lookup map `notion_entry_id → wp_post_id`.
4. Resolve and write relation values using the lookup map.

### Notion type → cortext type mapping

| Notion type | cortext type | Notes |
|-------------|-------------|-------|
| `title` | _(post_title)_ | Not stored as a field value |
| `rich_text` | `text` | |
| `number` | `number` | Store `format` as field meta |
| `select` | `select` | Store `options` as field meta |
| `multi_select` | `multiselect` | Store `options` as field meta |
| `status` | `select` | Treat like `select`; store `groups` as extra meta if needed |
| `date` | `date` or `datetime` | Use `datetime` if value contains `T` |
| `checkbox` | `checkbox` | |
| `url` | `url` | |
| `email` | `email` | |
| `phone_number` | `text` | No phone type yet |
| `people` | _(skip)_ | No `user_ref` type yet; store name string as `text` if needed |
| `relation` | `relation` | Value becomes WP post ID of the related entry |
| `formula` | `formula` | Store `expression` as field meta; value is frozen at export time |
| `rollup` | _(skip)_ | Derived; can be re-derived from relation + formula |

### Lossy conversions and edge cases

- **`status` groups**: Notion's `status` type layers groups (To-do / In progress / Complete) on top of options. Storing just the options (like `select`) preserves data fidelity; groups can be stored as `status_groups` meta on the field if the UI needs them.
- **`people`**: Notion user IDs have no WordPress equivalent. Interim: store name strings as `text`. Revisit when `user_ref` lands.
- **`formula` / `rollup`**: Values are correct as of the export date. Formulas in WP are a future concern; store the computed value as `text` for now.
- **Date vs datetime**: the extracted value is ISO 8601. If it contains a `T` (e.g. `2026-04-16T14:00:00Z`), use `datetime`; otherwise `date`.
- **Skipped types during entry insert**: `title` (already in `post_title`), `rollup` (derived), `people` (no type yet), `relation` (deferred to step 4).
