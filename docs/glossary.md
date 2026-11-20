# Glossary

The words Cortext uses in its interface, and how to write them. Check here before adding or changing a user-facing string. [Using Cortext](using-cortext.md) explains the same ideas for people using the app.

## Terms

| Term | What it means | Notes |
| --- | --- | --- |
| Document | Anything in Cortext, including collections and what they hold. | The default word. Not "page", "row", "item", "entry", or "record". |
| Collection | A document that defines fields and holds other documents. | Name it only when it behaves differently, such as defining fields or taking its documents with it to Trash. Not "database" or "table"; "database" is fine as a search keyword. |
| Nested document | A document inside another document in the outline. | Not "child" or "subpage". |
| Field | A typed slot that a collection defines, such as Price or Status, and its value on each document. | The same word in the table, on the document, and in formulas. Not "property", "column", or "attribute". |
| Built-in field | Title, Created, Last edited, and the other fields every document has. | |
| Option | One choice in a Select or Multi-select field. | Not "choice" or "tag". |
| Relation | A field that links documents across collections. | |
| Rollup | A field that summarizes what a relation points to. | |
| Formula | A field computed from other fields of the same document. | |
| Linked collection view | A data view block that shows a collection from somewhere else. | |
| Detail view | How a document opens from a table: Side peek, Center modal, or Full view. | |
| Favorites | Documents added to the Favorites section of the sidebar. | The action is "Add to favorites". Not "star" or "pin". |
| Pin | Keeps the side peek open when you go to another document. | Only for the side peek. |
| Recents | Documents you opened recently. | |
| Home | The document Cortext opens first. | The action is "Set as home". |
| Mention | An inline link to another document, inserted with @. | |
| Backlink | A mention of this document from another one. | |
| Publish, Public | Publishing makes a document public on the web. "Public" is the state. | Not "share". The undo is "Unpublish". |
| Lock | Makes a document read only until someone unlocks it. | Not "freeze". |
| Archive, Archived | Archiving keeps a document read only, out of the sidebar and search. "Archived" is the view. | Leave it with "Unarchive" in messages. The button in the Archived view is "Restore". |
| Trash | Where documents go before they are deleted for good. | A proper noun: "Move to Trash", "in Trash", never "the trash". Leave it with "Restore". "Delete permanently" is final. |
| Command palette | The search and command box. | |
| Experiments | Features that are still being built, which site admins can turn on. | |

## Writing rules

- **Sentence case** for every label, button, menu item, and title: "Add to favorites", not "Add To Favorites". WordPress admin post type labels follow core's own casing.
- **Errors** start with "Could not", then say what failed: "Could not save the formula." Do not use "We couldn't" or "Cortext could not", or blame the user. Contractions are fine elsewhere ("This can't be undone.").
- **Next step.** When the user can fix the problem, say how and use the term from the table: "Unarchive this collection before changing its fields."
- **Quotes.** Put curly quotes around names the user typed, like “%s”. Keep straight quotes in formula examples and in REST errors about field IDs or operators.
- **Ellipsis.** Use the single character `…`. Add it to menu items that open another step ("Change type…", "Empty Trash…") and to progress states ("Saving…").
- **No title.** A document without a title shows as `(untitled)`.
- **Say where an action applies** when the same action exists in more than one place: "Hide in view" in a table hides the field in that view, and "Hide in documents" hides it on every document in the collection.
- **"Row" and "column"** describe only the shape of the table, as in "Resize column" or moving a row to a new position. They are not names for documents or fields.
- **Other apps.** Name Notion only in import copy. Do not compare Cortext to other apps in interface text.

## Known gaps

DataViews ships its own strings that do not follow this glossary yet: "Properties" in the view options and "Hide column" in its table header menu. Both belong upstream in `@wordpress/dataviews`.
