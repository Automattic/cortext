=== Cortext ===
Contributors: priethor, mcsf
Tags: knowledge-base, collections, custom-post-types, block-editor, publishing
Requires at least: 6.9
Tested up to: 6.9
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Build a WordPress-native knowledge base with nested pages, typed collections, views, and public publishing.

== Description ==

Cortext is an experimental knowledge base workspace for WordPress. It combines nested documents, typed collections, multiple views, relation fields, rollups, and public publishing inside your own site.

**Important:** Cortext is an early beta. Do not use it on production sites or with data you cannot afford to lose. The data layer will change, and early builds do not include migrations or upgrade paths.

= What you can try =

* Create nested documents with the WordPress block editor.
* Model typed collections with table, grid, and list views.
* Add relation fields, rollups, and row details.
* Embed collection views inside documents.
* Publish Cortext pages through your active WordPress theme.

Cortext stores documents, collection definitions, fields, and collection rows as WordPress posts and post meta, so the data remains inspectable with normal WordPress tools.

== Installation ==

1. Install and activate Cortext.
2. Open "Cortext" from the WordPress admin menu.
3. Start with a test site. Cortext is still a beta and its stored data is not stable yet.

Developers who want sample data can run `wp cortext seed` with WP-CLI.

== Frequently Asked Questions ==

= Is Cortext production ready? =

No. Cortext is a beta for testing the model and interface. Treat anything you create with it as disposable until the storage model is stable.

= Does Cortext send data to an external service? =

No. Cortext runs inside WordPress and does not connect to an external service during normal plugin use.

= Where is the source for the built JavaScript and CSS? =

The source code and build tools are maintained at https://github.com/Automattic/cortext. The packaged assets are built with `pnpm run build`; the release ZIP is built with `pnpm run build:zip`.

== Screenshots ==

1. The Cortext workspace showing a seeded Books collection with typed fields and relation data.

== Changelog ==

= 0.1.0 =
* Initial public beta.
