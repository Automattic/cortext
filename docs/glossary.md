# Glossary

The words Cortext uses in its interface, and how to write them. Check here before adding or changing a user-facing string. [Using Cortext](using-cortext.md) explains the same ideas for people using the app.

## Terms

| Term | What it means | Notes |
| --- | --- | --- |
| Document | Anything in Cortext, including collections and what they hold. | The default word. Not "page", "row", "item", "entry", or "record". |
| Collection | A document that defines fields and holds other documents. | Name it only when it behaves differently, such as defining fields or taking its documents with it to Trash. Not "database" or "table"; "database" is fine as a search keyword. |
| Field | A typed slot that a collection defines, such as Price or Status, and its value on each document. | The same word in the table, on the document, and in formulas. Not "property", "column", or "attribute". |
| Relation | A field that links documents across collections. | |
| Rollup | A field that calculates something from the documents a relation points to. | |
| Archive | Keeps a document read only, out of the sidebar and search, in the Archived view. | The way back is "Unarchive". "Restore" is only for Trash. |
| Trash | Where documents go before they are deleted for good. | A proper noun: "Move to Trash", "in Trash", never "the trash". |

## Writing rules

- **Tone.** Friendly and a little playful. When two words are equally clear, pick the warmer one: "Side peek", not "Side panel"; "Center peek", not "Center modal". Clarity still wins over cuteness.
- **Name what people do, not how it is built.** "Side peek" says what you are doing; "side panel", "pop-up", and "modal" describe the widget. The same goes for "drawer", "popover", and "toggle".
- **Sentence case** for every label, button, menu item, and title: "Add to favorites", not "Add To Favorites". WordPress admin post type labels follow core's own casing.
- **Errors** start with "Could not", then say what failed: "Could not save the formula." Do not use "We couldn't" or "Cortext could not", or blame the user. Contractions are fine elsewhere ("This can't be undone.").
- **Next step.** When the user can fix the problem, say how and use the term from the table: "Unarchive this collection before changing its fields."
- **Quotes.** Put curly quotes around names the user typed, like “%s”. Keep straight quotes in formula examples and in REST errors about field IDs or operators.
- **Ellipsis.** Use the single character `…`. Add it to menu items that open another step ("Change type…", "Empty Trash…") and to progress states ("Saving…").
- **No title.** A document without a title shows as `(untitled)`.
- **Whole sentences.** Do not build a label by dropping another label into a sentence, like "Open in %s". It breaks sentence case and translation. Write each variant out.
- **Say where an action applies** when the same action exists in more than one place: "Hide in view" in a table hides the field in that view, and "Hide in documents" hides it on every document in the collection.
- **"Row" and "column"** describe only the shape of the table, as in "Resize column" or moving a row to a new position. They are not names for documents or fields.
- **Other apps.** Name Notion only in import copy. Do not compare Cortext to other apps in interface text.

## Known gaps

DataViews ships its own strings that do not follow this glossary yet: "Properties" in the view options and "Hide column" in its table header menu. Both belong upstream in `@wordpress/dataviews`.
