# Glossary

The words Cortext uses in its interface. Check here before adding or changing a user-facing string; [Contributing](../CONTRIBUTING.md#interface-text) covers how to write it. [Using Cortext](using-cortext.md) explains the same ideas for people using the app.

## Terms

| Term       | What it means                                                                                    | Notes                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document   | Anything in Cortext, including collections and what they hold.                                   | The default word. Not "page", "row", "item", "entry", or "record".                                                                                                             |
| Collection | A document that defines fields and holds other documents.                                        | Name it only when it behaves differently, such as defining fields or taking its documents with it to Trash. Not "database" or "table"; "database" is fine as a search keyword. |
| Field      | A typed slot that a collection defines, such as Price or Status, and its value on each document. | The same word in the table, on the document, and in formulas. Not "property", "column", or "attribute".                                                                        |
| Relation   | A field that links documents across collections.                                                 |                                                                                                                                                                                |
| Rollup     | A field that calculates something from the documents a relation points to.                       |                                                                                                                                                                                |
| Archive    | Keeps a document read only, out of the sidebar and search, in the Archived view.                 | The way back is "Unarchive". "Restore" is only for Trash.                                                                                                                      |
| Trash      | Where documents go before they are deleted for good.                                             | A proper noun: "Move to Trash", "in Trash", never "the trash".                                                                                                                 |

## Known gaps

DataViews ships two strings that use other words: "Properties" in the view options and "Hide column" in its table header menu. Cortext renames them to "Fields" and "Hide in view" with a translation filter in `src/components/dataViewsFieldTerms.js`. The lasting fix belongs upstream in `@wordpress/dataviews`, and the filter goes away with it.
