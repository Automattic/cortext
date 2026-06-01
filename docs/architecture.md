# Architecture

Cortext is a WordPress plugin for building a knowledge base with documents, collections, and typed rows. This page gives the contributor-level picture. It is not a public API contract.

The short version: Cortext keeps its data in WordPress, then adds a focused admin shell on top.

## Storage

Cortext currently uses WordPress posts and post meta for the main data model:

-   Pages are hierarchical WordPress posts with block content.
-   Collections describe a type of record, such as tasks, books, or people.
-   Fields describe the properties that belong to a collection.
-   Rows are records inside a collection.
-   Field values are stored as row metadata.

Treat the exact post types, meta keys, REST responses, and block attributes as internal implementation details for now. Do not build external integrations against them yet.

## Admin shell

The main product surface is a full-screen React app in wp-admin. It has a sidebar for pages and collections, a block editor canvas for documents, and collection views for records.

Collection views use WordPress's DataViews package where it fits, with Cortext code around it for inline editing, relations, rollups, row details, and embedded views inside pages.

## Frontend

Cortext pages can render on the public site through a thin plugin template. The active WordPress theme still owns the public page surface. Cortext's shell theme does not leak into published content.

## What we are still testing

Several ideas are still being tested, including reusable schema across collections, import/export, upgrade handling, and the shape of a stable REST contract. For now, treat this repo as beta software and avoid building critical workflows on it.

More detailed notes live in:

-   [Shell architecture](architecture/shell.md)
-   [Data model](architecture/data-model.md)
-   [Theming](theming.md)
