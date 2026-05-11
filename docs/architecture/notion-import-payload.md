# Draft Notion import payload shape

This is a technical sketch for a possible Notion importer. It is not implemented,
and it is not a stable API. It describes the normalized structure we would expect
from a Notion import before Cortext turns it into WordPress posts, fields, and meta.

The payload is self-contained: all databases, their schemas, and their entries
live in one object, so relations can be resolved by ID without extra network calls.

## Top-level envelope

```json
{
  "extracted_at": "2026-04-19T12:00:00Z",
  "databases": [ /* DatabaseObject[] */ ]
}
```

## DatabaseObject

```json
{
  "id":    "3468bd85-3edc-803a-aa0d-eeb72fb159cc",
  "slug":  "venues",
  "title": "Venues",
  "fields":   [ /* FieldObject[] — the schema */ ],
  "entries":  [ /* EntryObject[] — the rows */ ]
}
```

`slug` is derived from `title` (lowercase, spaces → hyphens). It is used as the CPT
suffix in WordPress (`crtxt_{slug}`).

## FieldObject

All fields share a base shape; some types carry extra config.

```json
{
  "id":   "notion-property-id",
  "name": "Status",
  "type": "status"
}
```

Type-specific additions:

| Type | Extra keys |
|------|-----------|
| `select` | `"options": [{ "id", "name", "color" }]` |
| `multi_select` | `"options": [{ "id", "name", "color" }]` |
| `status` | `"options": [{ "id", "name", "color" }]`, `"groups": [{ "id", "name", "color", "option_ids" }]` |
| `relation` | `"related_database_id": "<notion-db-id>"` |
| `number` | `"format": "number" \| "dollar" \| …` |
| `formula` | `"expression": "<formula string>"` |
| `rollup` | `"relation_field": "<name>"`, `"rollup_field": "<name>"`, `"function": "<sum\|count\|…>"` |

## EntryObject

```json
{
  "id":     "3468bd85-3edc-8095-bf2e-d03138c83d9a",
  "title":  "Hello, world",
  "values": {
    "<field-id>": <FieldValue>
  }
}
```

`title` is always the value of the `title`-type property. It maps to the WP post title
and is also mirrored in `values` under its field id.

`values` is keyed by **field id** (not name) to survive field renames.

## FieldValue types

| Notion type | Value shape | Notes |
|-------------|-------------|-------|
| `title` | `"string"` | Always present |
| `rich_text` | `"string"` | Plain text only |
| `number` | `42 \| null` | |
| `select` | `"Option name" \| null` | |
| `multi_select` | `["A", "B"]` | |
| `status` | `"Option name" \| null` | Treated like `select` |
| `date` | `"2026-04-16" \| null` | ISO 8601 date or datetime |
| `checkbox` | `true \| false` | |
| `url` | `"https://…" \| null` | |
| `email` | `"user@example.com" \| null` | |
| `phone_number` | `"+358…" \| null` | |
| `people` | `[{ "id": "<notion-user-id>", "name": "Miguel" }]` | Names may be unavailable |
| `relation` | `["<notion-entry-id>", …]` | IDs into `entries` of the related database |
| `formula` | `<string \| number \| boolean \| null>` | Computed at export time |
| `rollup` | `<number \| array \| null>` | Computed at export time; skip on import |

Relations store **entry IDs**, not resolved objects. The importer resolves them by looking
up the target entry in the extracted payload, so there is no need for a separate lookup
pass.

## Full example (the two test databases)

```json
{
  "extracted_at": "2026-04-19T12:00:00Z",
  "databases": [
    {
      "id":    "3468bd85-3edc-803a-aa0d-eeb72fb159cc",
      "slug":  "venues",
      "title": "Venues",
      "fields": [
        { "id": "title", "name": "Name", "type": "title" }
      ],
      "entries": [
        { "id": "3468bd85-3edc-807c-906d-d0b783a824e6", "title": "Hotel Indigo Helsinki", "values": { "title": "Hotel Indigo Helsinki" } },
        { "id": "3468bd85-3edc-80af-8b7e-f1327f9bf68c", "title": "NoHo space",            "values": { "title": "NoHo space" } }
      ]
    },
    {
      "id":    "c18e9347-bb55-4c69-b2cf-02e9e404b7aa",
      "slug":  "meetings",
      "title": "Meetings",
      "fields": [
        { "id": "title",     "name": "Meeting",   "type": "title" },
        { "id": "date-id",   "name": "Date",      "type": "date" },
        { "id": "status-id", "name": "Status",    "type": "status",
          "options": [
            { "id": "pQqa", "name": "Upcoming",    "color": "default" },
            { "id": "gpc[", "name": "In Progress", "color": "default" },
            { "id": "RsCS", "name": "Done",        "color": "default" }
          ],
          "groups": [
            { "id": "``xN", "name": "To-do",       "color": "default", "option_ids": ["pQqa"] },
            { "id": "t;k@", "name": "In progress", "color": "default", "option_ids": ["gpc["] },
            { "id": "MVrq", "name": "Complete",    "color": "default", "option_ids": ["RsCS"] }
          ]
        },
        { "id": "notes-id",    "name": "Notes",     "type": "rich_text" },
        { "id": "location-id", "name": "Location",  "type": "relation",
          "related_database_id": "3468bd85-3edc-803a-aa0d-eeb72fb159cc" },
        { "id": "attendees-id","name": "Attendees", "type": "people" }
      ],
      "entries": [
        {
          "id": "3468bd85-3edc-8095-bf2e-d03138c83d9a",
          "title": "Hello, world",
          "values": {
            "title":        "Hello, world",
            "date-id":      "2026-04-16",
            "status-id":    null,
            "notes-id":     "Haaaaaaaa",
            "location-id":  ["3468bd85-3edc-807c-906d-d0b783a824e6"],
            "attendees-id": [{ "id": "user-uuid", "name": "Miguel" }]
          }
        },
        {
          "id": "d262f00e-c221-4f91-81ef-4ee34154a01b",
          "title": "Weekly Sync",
          "values": {
            "title":        "Weekly Sync",
            "date-id":      null,
            "status-id":    "Upcoming",
            "notes-id":     "",
            "location-id":  [],
            "attendees-id": []
          }
        }
      ]
    }
  ]
}
```
