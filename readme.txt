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

**Important:** Cortext is still in beta. We recommend trying it somewhere low-stakes first. Some workflows may change during the beta.

= What you can try =

* Write nested documents in the WordPress block editor.
* Create typed collections and switch between table, grid, and list views.
* Connect entries with relation fields and rollups.
* Embed collection views in documents.
* Publish Cortext pages with your active WordPress theme.

Behind the scenes, Cortext stores documents, collection definitions, fields, and collection rows as WordPress posts and post meta. You can still inspect the raw data with normal WordPress tools.

== Installation ==

1. Install and activate Cortext somewhere you can experiment.
2. Open "Cortext" from the WordPress admin menu.
3. Try the workspace with sample content first.

Developers who want sample data can run `wp cortext seed` with WP-CLI.

== Frequently Asked Questions ==

= Is Cortext production ready? =

Not yet. Cortext is ready to try, but still early. Use it somewhere low-stakes before relying on it for important content.

= Does Cortext connect to external services? =

Only when you ask it to. Everyday use (writing documents, building collections, publishing pages) stays inside WordPress with no external calls.

The one exception is the optional Notion import. When you run it, Cortext sends the Notion token you provide and the collections you pick to api.notion.com so it can read that content into WordPress. Notion's Terms (https://www.notion.so/28ffdd083dc3473e9c2da6ec011b58ac) and Privacy Policy (https://www.notion.com/trust/privacy-policy) apply to that traffic.

The WP-CLI seeder is opt-in the same way: `wp cortext seed --with-real-images` (or the `--prefetch-*` flags) fetches sample cover art from public sources like Open Library, MusicBrainz, the Cover Art Archive, and Wikimedia/Wikidata. That only happens when you pass the flag.

= Where is the source for the built JavaScript and CSS? =

Source code and build tooling live at https://github.com/Automattic/cortext. The JavaScript and CSS shipped in the plugin package are built from that repository.

== Screenshots ==

1. The Cortext workspace showing a seeded Books collection with typed fields and relation data.

== Changelog ==

= 0.1.0 =
* Initial public beta.
