# Data model

These are implementation notes for the current prototype. They are not a stable
public API.

## Current shape

Cortext stores its main data in WordPress posts and post meta:

-   `crtxt_page` stores workspace documents.
-   `crtxt_collection` stores collection definitions.
-   `crtxt_field` stores field definitions.
-   Each collection gets a row post type based on its slug.
-   Row values are stored as field-keyed post meta.

This keeps the data inspectable with normal WordPress tools while the product
surface can stay focused on knowledge base workflows.

## What can change

Post type names, meta keys, REST responses, block attributes, and stored content
shapes can change during early versions. We are not promising migrations yet.

The main thing to preserve is the principle, not the exact current shape:
Cortext data should remain WordPress data unless there is a strong reason to
leave that path.

## Import/export

Import and export are not part of the current data contract. The working import
payload sketch lives in
[data-model-intermediate-json.md](./data-model-intermediate-json.md). Treat it
as a draft, not an integration API.
