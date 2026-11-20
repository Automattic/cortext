# Using Cortext

Cortext turns a WordPress site into a knowledge base. You write documents in the block editor, keep structured records in collections, and publish any of it through your theme. Everything is stored as ordinary WordPress content, so nothing is locked away.

This page covers the main pieces and what you can do with them. Cortext is in beta, so expect some rough edges.

## The pieces

**Documents** are the basic unit, and everything in Cortext is a document. You write a document in the WordPress block editor, and documents nest inside each other to form an outline. A quick note, a full public page, and a collection are all documents, and so is everything inside a collection.

**Collections** are documents that hold other documents with the same fields. A collection describes a kind of thing you want to track, such as Books, People, or Tasks, and defines the fields every document in it shares.

**Fields** are the typed slots a collection defines, such as Price or Status. When you add a field you pick its type: Text, Number, Select, Multi-select, Date, Date and time, Checkbox, URL, Email, Relation, or Rollup. The type decides how you enter a value and how Cortext shows it. You can change a field's type later.

Each **document in a collection** has its own values for the collection's fields. It is a document like any other, so you can open it and write longer content below its fields.

**Layouts** are the ways to look at a collection. The same documents can show as a table, a grid of cards, or a list. Changing the layout or the sort order does not change the underlying data.

**Relations** connect documents across collections. A Relation field on Books that points at People lets you link each book to its author, and the link works from both sides.

**Rollups** summarize what a relation points to. A Rollup field can pull a value from the related documents, such as counting them or adding up one of their number fields.

## Doing things

- **Create a document.** Add a page from the sidebar, then write in the editor. Drag pages in the sidebar to nest them.
- **Create a collection.** Add a collection from the sidebar, or insert the "Collection view" block in a document and create one from there. Name it, then start adding fields.
- **Add fields.** Open the collection, add a field, and choose its type.
- **Add documents to a collection.** Add one from the table and fill in its fields inline, or open it to edit it in full.
- **Switch layout.** Toggle between table, grid, and list to see the same documents differently.
- **Link documents.** Add a Relation field, pick the collection it points to, then connect documents from either side.
- **Summarize with a rollup.** Add a Rollup field on top of a relation to count or total the related documents.
- **Embed a collection.** Inside a document, insert the "Collection view" block to show a collection's documents in place.
- **Publish.** Publish a document to render it on your public site with the active WordPress theme.

## Where your data lives

Cortext stores everything as WordPress posts and post meta. You can inspect it from the normal WordPress admin and export it the usual way. Deactivating Cortext, or deleting the plugin, leaves your content in place.

For the technical shape of the data, contributors can read the [data model notes](architecture/data-model.md).
