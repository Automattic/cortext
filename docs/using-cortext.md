# Using Cortext

Cortext turns a WordPress site into a knowledge base. You write documents in the block editor, keep structured records in collections, and publish any of it through your theme. Everything is stored as ordinary WordPress content, so nothing is locked away.

This page covers the main pieces and what you can do with them. Cortext is in beta, so expect some rough edges.

## The pieces

**Documents** are the basic unit, and everything in Cortext is a document. You write a document in the WordPress block editor, and documents nest inside each other to form an outline. A quick note and a full public page are both documents; so are collections and rows, as the next pieces explain.

**Collections** are documents that hold structured records. A collection describes a kind of thing you want to track, such as Books, People, or Tasks, and it defines a schema: the fields every record shares.

**Fields** are the typed properties on a collection. When you add a field you pick its type: Text, Number, Select, Multi-select, Date, Date & time, Checkbox, URL, Email, Relation, or Rollup. The type decides how you enter a value and how Cortext shows it. You can change a field's type later.

**Rows** are the records inside a collection. Each row has its own values for the collection's fields. A row is also a document, so you can open it and write longer content below its properties.

**Layouts** are the ways to look at a collection. The same rows can show as a table, a grid of cards, or a list. Changing the layout or the sort order does not change the underlying data.

**Relations** connect rows across collections. A Relation field on Books that points at People lets you link each book to its author, and the link works from both sides.

**Rollups** summarize what a relation points to. A Rollup field can pull a value from the related rows, such as counting them or adding up one of their number fields.

## Doing things

- **Create a document.** Add a page from the sidebar, then write in the editor. Drag pages in the sidebar to nest them.
- **Create a collection.** Add a collection from the sidebar, or insert the "Collection view" block in a document and create one from there. Name it, then start adding fields.
- **Add fields.** Open the collection, add a field, and choose its type.
- **Add rows.** Add a row and fill in its fields inline, or open the row to edit it in full.
- **Switch layout.** Toggle between table, grid, and list to see the same rows differently.
- **Link rows.** Add a Relation field, pick the collection it points to, then connect rows from either side.
- **Summarize with a rollup.** Add a Rollup field on top of a relation to count or total the related rows.
- **Embed a collection.** Inside a document, insert the "Collection view" block to show a collection's rows in place.
- **Publish.** Publish a document to render it on your public site with the active WordPress theme.

## Where your data lives

Cortext stores everything as WordPress posts and post meta. You can inspect it from the normal WordPress admin and export it the usual way. Deactivating Cortext, or deleting the plugin, leaves your content in place.

For the technical shape of the data, contributors can read the [data model notes](architecture/data-model.md).
