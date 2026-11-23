=== Cortext ===
Contributors: priethor, mcsf
Tags: knowledge-base, collections, custom-post-types, block-editor, publishing
Requires at least: 7.1
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.4.0
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

Install Cortext from the WordPress plugin directory:

1. In wp-admin, go to Plugins, then Add New.
2. Search for "Cortext".
3. Install and activate Cortext, then open "Cortext" from the admin menu.
4. Try the workspace with sample content first.

It is beta software, so install it somewhere you can experiment first.

Developers who want sample data can run `wp cortext seed` with WP-CLI.

== Frequently Asked Questions ==

= Is Cortext production ready? =

Not yet. Cortext is ready to try, but still early. Use it somewhere low-stakes before relying on it for important content.

= Does Cortext connect to external services? =

Only when you ask it to. Everyday use stays inside WordPress with no external calls. The one exception is the optional Notion import; the External services section below covers what it sends and when.

= Where is the source for the built JavaScript and CSS? =

Source code and build tooling live at https://github.com/Automattic/cortext. The JavaScript and CSS shipped in the plugin package are built from that repository.

= What happens to my content if I deactivate Cortext? =

Your content stays in WordPress as posts and post meta. Deactivating Cortext, or deleting the plugin, does not remove it, and you can still see and export it with the normal WordPress tools.

= How do I report a bug or send feedback? =

Cortext is in beta and feedback helps. Open an issue at https://github.com/Automattic/cortext/issues. For a security problem, follow the security policy in that repository instead.

== External services ==

Cortext runs inside your WordPress install. The only external service it can reach is the optional Notion import.

The import reads content from a Notion workspace into Cortext. It runs only when you start an import and supply a Notion integration token; nothing leaves your site otherwise. When you run it, Cortext sends that token and the IDs of the collections you picked to the Notion API at api.notion.com, which returns the content to store in WordPress.

Notion's Terms of Service (https://www.notion.so/28ffdd083dc3473e9c2da6ec011b58ac) and Privacy Policy (https://www.notion.com/trust/privacy-policy) cover that traffic.

== Screenshots ==

1. The Cortext workspace showing a seeded Library page with a catalog table and detail panel.

== Changelog ==

= 0.4.0 =
Enhancements:

**Collections**

* Mute relation chips that point to archived documents. ([#481](https://github.com/Automattic/cortext/pull/481))
* Edit a rollup's relation, target and calculation after creating it. ([#510](https://github.com/Automattic/cortext/pull/510))

**Shell**

* Archive and restore documents from the workspace. ([#468](https://github.com/Automattic/cortext/pull/468))
* Preview the highlighted document in the command palette. ([#472](https://github.com/Automattic/cortext/pull/472))
* Record who trashed each document and add an Empty trash endpoint. ([#488](https://github.com/Automattic/cortext/pull/488))
* Give Trash its own view. ([#493](https://github.com/Automattic/cortext/pull/493))
* Give Archived its own view. ([#498](https://github.com/Automattic/cortext/pull/498))
* Open document actions on right-click in the sidebar. ([#512](https://github.com/Automattic/cortext/pull/512))

**Performance**

* Only load the Published list while its pane is open. ([#469](https://github.com/Automattic/cortext/pull/469))
* Fetch only the fields the shell's document lists use. ([#470](https://github.com/Automattic/cortext/pull/470))
* Look up default post meta by key instead of scanning every registered key. ([#475](https://github.com/Automattic/cortext/pull/475))
* Make the collection flag free in document lists. ([#477](https://github.com/Automattic/cortext/pull/477))
* Read each document's meta from its own fields only. ([#485](https://github.com/Automattic/cortext/pull/485))
* Show edited cell values as soon as the save returns. ([#491](https://github.com/Automattic/cortext/pull/491))

**Other**

* Record who archived each document and show archived rows in archived collections. ([#494](https://github.com/Automattic/cortext/pull/494))
* Skip rewriting formula values that didn't change. ([#502](https://github.com/Automattic/cortext/pull/502))
* Use one vocabulary across the interface. ([#509](https://github.com/Automattic/cortext/pull/509))

Bug fixes:

**Canvas**

* Keep collection pages intact when the editor loads after the page. ([#490](https://github.com/Automattic/cortext/pull/490))

**Collections**

* Show properties on rows archived or trashed before anyone opened them. ([#473](https://github.com/Automattic/cortext/pull/473))
* Reach collections past the first 100 in pickers and breadcrumbs. ([#478](https://github.com/Automattic/cortext/pull/478))
* Update rollups when the field they read changes. ([#500](https://github.com/Automattic/cortext/pull/500))
* Stop the posts endpoint from changing a field's structure. ([#508](https://github.com/Automattic/cortext/pull/508))
* Show the lock on locked rows and keep their height. ([#511](https://github.com/Automattic/cortext/pull/511))
* Create every document with the properties block. ([#524](https://github.com/Automattic/cortext/pull/524))

**Shell**

* Say when restoring makes nested documents public again. ([#476](https://github.com/Automattic/cortext/pull/476))

**Other**

* Stop Notion imports and row reordering from writing into hidden collections. ([#479](https://github.com/Automattic/cortext/pull/479))
* Keep edits made right before archiving or trashing a document. ([#480](https://github.com/Automattic/cortext/pull/480))
* Prevent documents that open blank from overwriting their content. ([#486](https://github.com/Automattic/cortext/pull/486))
* Reject REST edits to trashed documents. ([#496](https://github.com/Automattic/cortext/pull/496))
* Keep inspector labels readable in dark mode. ([#504](https://github.com/Automattic/cortext/pull/504))
* Show document actions in the collection and row inspectors. ([#505](https://github.com/Automattic/cortext/pull/505))
* Check read access to a collection before listing its rows. ([#549](https://github.com/Automattic/cortext/pull/549))

= 0.3.0 =
Enhancements:

**Shell**

* Archiving documents: Add server support (no UI yet). ([#425](https://github.com/Automattic/cortext/pull/425))

**Desktop**

* Desktop: Build the bundled PHP runtime on Windows. ([#408](https://github.com/Automattic/cortext/pull/408))

**Other**

* Upgrade support to WordPress 7.1. ([#447](https://github.com/Automattic/cortext/pull/447))
* I18n: Prepare Cortext for WordPress.org translations. ([#448](https://github.com/Automattic/cortext/pull/448))

Bug fixes:

**Canvas**

* Keep the block toolbar from covering DataViews menus. ([#418](https://github.com/Automattic/cortext/pull/418))

**Collections**

* Overlapping nested menus in the editor. ([#416](https://github.com/Automattic/cortext/pull/416))
* Trim the document properties inset to fit the drag handle. ([#417](https://github.com/Automattic/cortext/pull/417))
* Fix Collection pagination styles. ([#429](https://github.com/Automattic/cortext/pull/429))

**Shell**

* Keep sidebar document titles and icons in sync. ([#449](https://github.com/Automattic/cortext/pull/449))

**Other**

* A11y: Move focus into documents opened from the sidebar. ([#419](https://github.com/Automattic/cortext/pull/419))
* Keep archived content read-only. ([#430](https://github.com/Automattic/cortext/pull/430))
* Keep mention icons when moving the caret. ([#431](https://github.com/Automattic/cortext/pull/431))

= 0.2.0 =
Enhancements:

**Canvas**

* Add inline document mentions. ([#376](https://github.com/Automattic/cortext/pull/376))
* Add backlinks for document mentions. ([#379](https://github.com/Automattic/cortext/pull/379))

**Collections**

* Add formula fields to collections. ([#274](https://github.com/Automattic/cortext/pull/274))

**Shell**

* Add sidebar settings view mode. ([#385](https://github.com/Automattic/cortext/pull/385))
* Add experiment controls to Cortext settings. ([#388](https://github.com/Automattic/cortext/pull/388))

**Desktop**

* Desktop: Add desktop auto-updates. ([#381](https://github.com/Automattic/cortext/pull/381))
* Desktop: authenticate local runtime requests. ([#397](https://github.com/Automattic/cortext/pull/397))
* Desktop: assign each profile a runtime origin. ([#403](https://github.com/Automattic/cortext/pull/403))
* Desktop: Remove POSIX dependencies from snapshots and runtime. ([#404](https://github.com/Automattic/cortext/pull/404))
* Desktop: Build the snapshot on Windows. ([#405](https://github.com/Automattic/cortext/pull/405))
* Desktop: lock down and test the packaged app. ([#407](https://github.com/Automattic/cortext/pull/407))

**Performance**

* Performance: Calculate table footer totals on the server. ([#378](https://github.com/Automattic/cortext/pull/378))
* Perf: Lazy-load and paginate the sidebar tree. ([#380](https://github.com/Automattic/cortext/pull/380))
* Perf: Add an ID-only response for rows. ([#393](https://github.com/Automattic/cortext/pull/393))

= 0.1.1 =
Patch release for the 0.1 beta line. In this release:

* Added richer demo content entry points for empty workspaces.
* Fixed row reordering so the first drag works in scrolled collections.
* Fixed canvas flicker when opening or leaving row documents.
* Moved the Cortext admin menu below the core WordPress items.
* Improved release packaging and automation for distributed builds.

= 0.1.0 =
First public beta. In this release you can:

* Write nested documents in the WordPress block editor.
* Create typed collections and switch between table, grid, and list views.
* Edit rows inline, and connect entries with relation fields and rollups.
* Embed collection views inside documents.
* Publish Cortext pages with your active WordPress theme.
