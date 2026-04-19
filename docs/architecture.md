# Architecture

## Content model

Nomenclature | WordPress primitive
-|-
Collection   | `cortext_collection` CPT
Field        | `cortext_field` CPT
Entry        | `cortext_collection_{$slug}` CPT
Field value  | `cortext_field` post meta

### Creating a new database

- we create a new database

```php
$collection_id = wp_insert_post( 'cortext_collection', [ ... ] );
register_post_type( 'cortext_collection_books, [ ... ] );
```

- we add a new row

```php
$book_id = wp_insert_post( 'cortext_collection_books', $data );
```

- we add a new column

```php
$field_id = wp_insert_post( 'cortext_field', $field_details );
add_post_meta( $field_id, 'type', 'text' );
add_post_meta( $collection_id, 'fields', $field_id );

$type = get_post_meta( $field_id, 'type' );
register_post_meta( 'cortext_collection_books', "field-{$field_id}", [ $type, ... ] );
```

- we add a cell value

```php
update_post_meta( $book_id, "field-{$field_id}", $value );
```

### Loading a collection on the client

```php
$collection_object = get_posts( 'cortext_collection', [ 'slug' => 'book' ] );
$collection_id = $collection->ID;

$collection_items = get_posts( "cortext_collection_{$slug}" );

$collection_fields_ids = get_post_meta( $collection_id, 'fields' );
$collection_fields = get_posts( 'cortext_field', [ 'post_id__in' => $collection_fields_ids ] );

foreach ( $collection_items as $item ) {
    $row_fields = get_post_meta( $item->ID );
}

// etc.
```

### Fields

To start off, maybe:

- text
- number
- email
- url
- select
- multiselect
- date
- datetime
- checkbox
- relation
- formula

Later, _maybe_: `image`, `file`, `user_ref`, `post_ref`, `color`, `repeater`, `group`, conditional display.

## UI shell

A single React SPA mounted on a full-screen admin page.

```
┌───────────────┬────────────────────────────────────┐
│               │  Page/Row title                     │
│    Sidebar    ├────────────────────────────────────┤
│    ━━━━━━     │                                     │
│    Pages      │   EditorProvider + BlockCanvas      │
│    └ child    │   (documents and rows)              │
│    ━━━━━━     │                                     │
│    Collections│   or                                │
│    - Tasks    │                                     │
│    - Docs     │   <DataViews>                       │
│    ━━━━━━     │                                     │
│    Supertags  │                                     │
│    - Urgent   │                                     │
└───────────────┴────────────────────────────────────┘
```

Chrome is hidden via the `is-fullscreen-mode` body class (the Site Editor pattern). Phase 2 may move to a custom URL via rewrite rule and `template_redirect`. The React shell is URL-agnostic, so the move is plumbing rather than architecture.
