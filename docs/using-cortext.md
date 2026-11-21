# Using Cortext

Cortext turns a WordPress site into a knowledge base. You write documents in the block editor, keep structured records in collections, and publish any of it through your theme. Everything is stored as ordinary WordPress content, so nothing is locked away.

This page covers the main pieces and what you can do with them. Cortext is in beta, so expect some rough edges.

## The pieces

**Documents** are the basic unit, and everything in Cortext is a document. You write a document in the WordPress block editor, and documents nest inside each other to form an outline. A quick note, a full public page, and a collection are all documents, and so is everything inside a collection.

**Collections** are documents that hold other documents with the same properties. A collection describes a kind of thing you want to track, such as Books, People, or Tasks, and defines the properties every document in it shares.

**Properties** are the typed slots a collection defines, such as Price or Status. When you add a property you pick its type: Text, Number, Select, Multi-select, Date, Date and time, Checkbox, URL, Email, Relation, or Rollup. The type decides how you enter a value and how Cortext shows it. You can change a property's type later.

Each **document in a collection** has its own values for the collection's properties. It is a document like any other, so you can open it and write longer content below its properties.

**Layouts** are the ways to look at a collection. The same documents can show as a table, a grid of cards, or a list. Changing the layout or the sort order does not change the underlying data.

**Relations** connect documents across collections. A Relation property on Books that points at People lets you link each book to its author, and the link works from both sides.

**Rollups** summarize what a relation points to. A Rollup property can pull a value from the related documents, such as counting them or adding up one of their number properties.

## Doing things

- **Create a document.** Add a document from the sidebar, then write in the editor. Drag documents in the sidebar to nest them.
- **Create a collection.** Add a collection from the sidebar, or insert the "Collection view" block in a document and create one from there. Name it, then start adding properties.
- **Add properties.** Open the collection, add a property, and choose its type.
- **Add documents to a collection.** Add one from the table and fill in its properties inline, or open it to edit it in full.
- **Give a date an end.** Turn on "End date" in the date picker to set a start and an end, like a trip or a project. Filters for a day or a stretch of days match any range that overlaps them.
- **Switch layout.** Toggle between table, grid, and list to see the same documents differently.
- **Link documents.** Add a Relation property, pick the collection it points to, then connect documents from either side.
- **Summarize with a rollup.** Add a Rollup property on top of a relation to count or total the related documents.
- **Embed a collection.** Inside a document, insert the "Collection view" block to show a collection's documents in place.
- **Publish.** Publish a document to render it on your public site with the active WordPress theme.

## Where your data lives

Cortext stores everything as WordPress posts and post meta. You can inspect it from the normal WordPress admin and export it the usual way. Deactivating Cortext, or deleting the plugin, leaves your content in place.

For the technical shape of the data, contributors can read the [data model notes](architecture/data-model.md).
