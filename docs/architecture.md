# Architecture

## Content model

| Nomenclature | WordPress primitive       |
| ------------ | ------------------------- |
| Collection   | `crtxt_collection` CPT    |
| Field        | `crtxt_field` CPT         |
| Entry        | `crtxt_{$slug}` CPT       |
| Field value  | `crtxt_{$slug}` post meta |

### Creating a new database

-   we create a new database

```php
$collection_id = wp_insert_post( 'crtxt_collection', [ ... ] );
register_post_type( 'crtxt_books', [ ... ] );
```

-   we add a new row

```php
$book_id = wp_insert_post( 'crtxt_books', $data );
```

-   we add a new column

```php
$field_id = wp_insert_post( 'crtxt_field', $field_details );
add_post_meta( $field_id, 'type', 'text' );
add_post_meta( $collection_id, 'fields', $field_id );

$type = get_post_meta( $field_id, 'type', true );
register_post_meta( 'crtxt_books', "field-{$field_id}", [ $type, ... ] );
```

-   we add a cell value

```php
update_post_meta( $book_id, "field-{$field_id}", $value );
```

### Loading a collection on the client

```php
$collection_object = get_posts( 'crtxt_collection', [ 'slug' => 'book' ] );
$collection_id = $collection->ID;

$collection_items = get_posts( "crtxt_{$slug}" );

$collection_fields_ids = get_post_meta( $collection_id, 'fields', false );
$collection_fields = array_map( 'get_post', $collection_fields_ids );

foreach ( $collection_items as $item ) {
    $row_fields = get_post_meta( $item->ID );
}

// etc.
```

### Fields

To start off, maybe:

-   text
-   number
-   email
-   url
-   select
-   multiselect
-   date
-   datetime
-   checkbox
-   relation
-   formula

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

Chrome is hidden via the `is-fullscreen-mode` body class, following the Site Editor pattern. Page routes mount the block editor canvas. Collection routes skip the editor canvas and mount DataViews directly in the shell on a light surface. DataViews is app UI, not block-theme content. Phase 2 may move the shell to a custom URL via rewrite rule and `template_redirect`; the React shell is URL-agnostic, so that change is mostly plumbing.

## Theming

Shell chrome uses Cortext-owned semantic tokens in `src/styles/_tokens.scss`. Published pages and the editor iframe use the active WordPress block theme. Collection tables count as shell UI, but they stay on a light canvas until DataViews can be themed without breaking contrast. Details: [theming.md](theming.md).
