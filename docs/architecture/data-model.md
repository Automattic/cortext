# Data model

These are implementation notes for the current beta. They are not a stable public API.

## Current shape

Cortext stores its main data in WordPress posts and post meta:

-   `crtxt_document` stores every editable record. A document is a page, a collection, or a row depending on its state: a `cortext_fields` meta makes it a collection (schema-defining), a `crtxt_trait` taxonomy term makes it a row of that collection, and neither makes it a plain page.
-   `crtxt_trait` is the taxonomy that wires rows to their collection. Each collection document mirrors itself as a term in this taxonomy (term slug = the collection's post id).
-   `crtxt_field` stores field definitions.
-   Row values are stored as field-keyed post meta (`field-<id>`) on the row document.

This keeps the data inspectable with normal WordPress tools while the product surface can stay focused on knowledge base workflows.

## What can change

Post type names, meta keys, REST responses, block attributes, and stored content shapes can change during early versions. We are not promising migrations yet.

The main thing to preserve is the principle, not the exact current shape: Cortext data should remain WordPress data unless there is a strong reason to leave that path.
