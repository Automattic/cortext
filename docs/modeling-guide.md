# Content Modeling Guide

How to think about collections and cross-type taxonomies: when to use which, with concrete examples. If you've used Notion, Tana, or Anytype, you already know most of this.

A note on naming: the pitch calls these "cross-type taxonomies" (inspired by Tana's super tags). The final user-facing name is TBD, but the mental model is the same regardless. Internally the WordPress taxonomy is registered as `cortext_supertag`.

## Mental model in plain words

- A **collection** is a group of one kind of thing. Tasks, Projects, People. In Notion this is called a "database"; in WordPress terms, each collection is its own custom post type (CPT).
- A **row** is one item in that collection. A specific task, a specific project. A row is a post of the collection's CPT.
- A **cross-type taxonomy term** (working term: "cross-type tag") is a reusable label you can stick on any row, regardless of which collection it's in. "High-priority", "Deadline-driven", "Needs legal review". In WordPress terms, a term in one global taxonomy attached to every collection CPT.
- Each cross-type tag carries **extra fields** that get added to any row you stick it on. "High-priority" might contribute a `priority_reason` text field. "Deadline-driven" might contribute a `deadline_review_date` date field.

The plain-English rule:

> A row's fields = its collection's fields, plus the fields of every cross-type tag stuck on it.

Two rows in the same collection can have different fields if they carry different cross-type tags.

## Worked example

You keep all your notes in a single Notes collection, with fields: `title` (text), `created_at` (datetime).

Some of those notes are meetings. You'd want `date` and `attendees` on those, but it'd be messy to add them to every Note type since they don't apply to most. You create a **Meeting** cross-type tag that contributes `date` (date) and `attendees` (multiselect) to any row you stick it on.

Four notes:

| Row | Tags |
|-----|------|
| "Reading list" |  |
| "Q2 kickoff meeting" | Meeting |
| "Random ideas" |  |
| "Product review" | Meeting |

### Fields each row has

- "Reading list": `title`, `created_at`.
- "Q2 kickoff meeting": `title`, `created_at`, `date`, `attendees`.
- "Random ideas": `title`, `created_at`.
- "Product review": `title`, `created_at`, `date`, `attendees`.

The meeting notes have four fields; the rest have the Notes defaults. Same collection, different fields per row. That's polymorphism, computed per row.

### What the UI shows

Opening "Q2 kickoff meeting" (row page): DataForm at the top shows all four fields, with a source badge next to `date` and `attendees` ("from Meeting"). Below DataForm: free-form Gutenberg content for your notes.

Opening the Notes collection view: DataViews shows columns `title` and `created_at`. Because at least one row has Meeting-contributed fields, DataViews also shows `date` and `attendees` columns. "Reading list" and "Random ideas" have empty cells in those extra columns.

### Cross-collection use

The Meeting tag isn't limited to Notes. Apply it to a row in another collection (a Task like "prep for kickoff", or a Project like "onboarding workshop") and it contributes the same `date` and `attendees` fields there. That's cross-collection polymorphism: the tag is a reusable schema that travels with rows across collection boundaries.

## Where to draw the line: collection or cross-type tag?

The single best test is:

> "Can a thing exist without this?"

- Can a Task exist without being "High-priority"? Yes. High-priority is a **cross-type tag**.
- Can something exist without being a Task? Yes (it's a Project, or a Person). Task is a **collection**.

The grammar rule: collections are **nouns**, cross-type tags are **adjectives** or **roles**. A Task (noun) can be Urgent (adjective), Recurring (adjective), Client-facing (role). You wouldn't spin up a separate `UrgentTasks` collection any more than you'd have separate `red_cars` and `blue_cars` tables.

A collection is the answer to "what is this?", deserves a top-level sidebar slot, and its fields apply to every row. A cross-type tag is optional (some rows have it, some don't), its fields are only meaningful when it's present, and it's cross-cutting: meaningful on Tasks, Projects, and Emails alike.

## Edge cases

### When a cross-type tag would wholesale redefine the row

If "Event" as a cross-type tag adds `location`, `start_time`, `attendees`, `rsvps`, and `recurrence_rule`, it's not really an aspect anymore. It's a different noun. If 100 percent of Event-tagged rows get treated as events, make Event a collection.

### When unsure, lean toward collection

A cross-type tag can graduate to a collection later (painful migration: new CPT, copy tagged rows, re-key meta; tractable, but painful). Demoting a collection to a cross-type tag loses the per-CPT REST endpoint, admin UX, and hook granularity, all of which users may have built on. The wrong direction is cheaper to undo.

### When even a collection feels too heavy

A small ad-hoc grouping ("stuff I'm reviewing") is neither a collection nor a cross-type tag. It's a saved **view** with a filter. Don't model everything as schema.

## Practical starting point

A sane starter workspace:

- Three to seven collections, covering the major nouns of your life: Tasks, Projects, People, Notes, Books, Meetings, Journal.
- A dozen or so cross-type tags for cross-cutting aspects: Urgent, Recurring, Archived, Reviewed, Template, Client-facing, Waiting-for-reply, Idea.

If you find yourself reaching for a 15th collection because "it has slightly different fields", stop. Ask whether it's really a new noun, or just an aspect of an existing one.
