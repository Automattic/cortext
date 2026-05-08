# Content Modeling Guide

Cortext is easiest to use when collections stay boring.

A collection should be one kind of thing: tasks, projects, people, books,
meetings. Each row in that collection should feel like an example of that thing.
If you cannot name the collection with a noun, it is probably not a collection.

Good starting collections:

-   Tasks
-   Projects
-   People
-   Notes
-   Books
-   Meetings

## When to add a collection

Add a collection when the rows share the same basic shape.

For example, a Books collection might have fields for author, status, rating, and
date finished. A People collection might have fields for email, company, and
role. Those are different enough to deserve separate collections.

Do not add a collection just because a few rows need an extra field. That is how
workspaces turn into a maze of near-duplicates.

## When a view is enough

Use views for temporary or filtered slices:

-   Open tasks
-   Books to buy
-   Projects with no next action
-   Notes from this month

Those are not new kinds of things. They are useful ways to look at existing
things.

## Ideas for later

Reusable schema across collections may still become part of Cortext, but it is
not a feature today. We should not force people to learn names or rules for it
until the model is real.

For now, model the knowledge base with simple collections and useful views.
