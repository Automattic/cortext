=== Cortext ===
Contributors: priethor, mcsf
Tags: knowledge-base, collections, custom-post-types, block-editor, publishing
Requires at least: 6.9
Tested up to: 7.0
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Build a WordPress-native knowledge base with pages, typed collections, views, and public publishing.

== Description ==

Cortext is a beta knowledge base workspace for WordPress. It gives you documents, typed collections, multiple views, relation fields, rollups, and public pages without moving your data out of WordPress.

**Important:** Cortext is still in beta. We recommend starting on a test or staging site and keeping backups of anything important. Some workflows may change during the beta.

= What you can try =

* Write nested documents in the WordPress block editor.
* Create typed collections and switch between table, grid, and list views.
* Connect entries with relation fields and rollups.
* Embed collection views in documents.
* Publish Cortext pages with your active WordPress theme.

Behind the scenes, Cortext stores documents, collection definitions, fields, and collection rows as WordPress posts and post meta. You can still inspect the raw data with normal WordPress tools.

== Installation ==

1. Install and activate Cortext on a test site.
2. Open "Cortext" from the WordPress admin menu.
3. Try the workspace with sample content first.

Developers who want sample data can run `wp cortext seed` with WP-CLI.

== Frequently Asked Questions ==

= Is Cortext production ready? =

Not yet. Cortext is ready to try, but still early. Start on staging and keep backups before relying on it for important content.

= Does Cortext send data to an external service? =

No. Cortext runs inside WordPress and does not call an external service during normal plugin use.

= Where is the source for the built JavaScript and CSS? =

Source code and build tooling live at https://github.com/Automattic/cortext. The JavaScript and CSS shipped in the plugin package are built from that repository.

== Screenshots ==

1. The Cortext workspace showing a seeded Books collection with typed fields and relation data.

== Changelog ==

= 0.1.0 =
* Initial public beta.
