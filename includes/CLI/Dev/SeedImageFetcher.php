<?php
/**
 * Developer-only image fetcher for the dummy-collection seeder.
 *
 * Holds every part of the seeder that reaches an external service: resolving
 * real cover art and portraits (Open Library, MusicBrainz, the Cover Art
 * Archive, Wikidata / Wikimedia Commons), the Lorem Picsum fallback, and the
 * `--prefetch-*` routines that download those assets into `seed-assets/` so
 * they can be committed and shipped offline.
 *
 * This file lives under `includes/CLI/Dev/`, which `build-zip.sh` and
 * `.distignore` keep out of the distributed plugin. The shipped seeder uses
 * only the bundled `seed-assets/` and never instantiates this class, so the
 * published package makes no remote-asset calls. Run the seeder from a
 * checkout of the repository to fetch real images or refresh the bundle.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI\Dev;

defined( 'ABSPATH' ) || exit;

use Cortext\Media\CortextMedia;

final class SeedImageFetcher {

	/**
	 * Map of book title => author, for Open Library lookups.
	 *
	 * @var array<string,string>
	 */
	private array $book_authors;

	/**
	 * Map of album title => artist, for Cover Art Archive lookups.
	 *
	 * @var array<string,string>
	 */
	private array $album_artists;

	/**
	 * Whether book/album icons may reach for a real cover when Commons misses.
	 *
	 * @var bool
	 */
	private bool $fetch_real_images;

	/**
	 * Sets up the fetcher with the relation maps used for cover lookups.
	 *
	 * @param array<string,string> $book_authors      Map of book title => author.
	 * @param array<string,string> $album_artists     Map of album title => artist.
	 * @param bool                 $fetch_real_images Whether to reach for real covers on Commons misses.
	 */
	public function __construct( array $book_authors = array(), array $album_artists = array(), bool $fetch_real_images = false ) {
		$this->book_authors      = $book_authors;
		$this->album_artists     = $album_artists;
		$this->fetch_real_images = $fetch_real_images;
	}

	/**
	 * Downloads an image from a URL into the media library and returns the
	 * attachment ID. Idempotent across reseeds: subsequent calls with the
	 * same URL hit the existing attachment instead of re-downloading.
	 * Returns 0 on failure (no network, bad response, file write error).
	 *
	 * @param string $url Absolute http(s) URL to an image.
	 */
	public function ensure_attachment_from_url( string $url ): int {
		$hash     = substr( md5( $url ), 0, 12 );
		$filename = 'seed-icon-' . $hash . '.jpg';

		$existing = get_posts(
			array(
				'post_type'      => 'attachment',
				'name'           => sanitize_title( pathinfo( $filename, PATHINFO_FILENAME ) ),
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'post_status'    => 'inherit',
			)
		);
		if ( $existing ) {
			return $this->tag_attachment( (int) $existing[0] );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$tmp = download_url( $url, 30 );
		if ( is_wp_error( $tmp ) ) {
			$this->warning( "Failed to download icon from {$url}: " . $tmp->get_error_message() );
			return 0;
		}

		$upload_dir = wp_upload_dir();
		if ( ! empty( $upload_dir['error'] ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
			@unlink( $tmp );
			return 0;
		}

		$dest = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], $filename );
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
		if ( ! @rename( $tmp, $dest ) && ! @copy( $tmp, $dest ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
			@unlink( $tmp );
			return 0;
		}
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
		@unlink( $tmp );

		$filetype  = wp_check_filetype( $dest );
		$attach_id = wp_insert_attachment(
			array(
				'guid'           => trailingslashit( $upload_dir['url'] ) . basename( $dest ),
				'post_mime_type' => $filetype['type'] ?? 'image/jpeg',
				'post_title'     => pathinfo( $filename, PATHINFO_FILENAME ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			),
			$dest
		);
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return 0;
		}

		$metadata = wp_generate_attachment_metadata( $attach_id, $dest );
		wp_update_attachment_metadata( $attach_id, $metadata );

		return $this->tag_attachment( (int) $attach_id );
	}

	/**
	 * Returns a deterministic image URL for a row in one of the visually
	 * meaningful seeded collections, or null if the collection isn't eligible.
	 * First tries to resolve the row to a real Wikimedia Commons file via
	 * Wikidata (so an author row gets that author's actual portrait); falls
	 * back to Lorem Picsum when no Commons image is available. Commons files
	 * carry their own per-image license (commonly CC-BY-SA): see each file's
	 * Commons page for credit; Picsum serves Unsplash photos under the
	 * Unsplash License (attribution appreciated, not required).
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	public function row_icon_url( string $collection_slug, string $title ): ?string {
		$icon_collections = array( 'authors', 'musicians', 'books', 'albums' );
		if ( ! in_array( $collection_slug, $icon_collections, true ) ) {
			return null;
		}
		$commons = $this->commons_image_url( $collection_slug, $title );
		if ( null !== $commons ) {
			return $commons;
		}
		// Books and albums rarely have P18 on Wikidata (covers are fair-use
		// only), so when the user opts in to real images, reach for Open
		// Library / Cover Art Archive instead of the picsum fallback. The
		// real cover doubles as the icon: a Discworld book row gets the
		// actual Discworld cover top-left and again as featured image.
		if ( $this->fetch_real_images && in_array( $collection_slug, array( 'books', 'albums' ), true ) ) {
			$cover = $this->real_cover_url( $collection_slug, $title );
			if ( null !== $cover ) {
				return $cover;
			}
		}
		$seed = sanitize_title( $collection_slug . '-' . $title );
		return 'https://picsum.photos/seed/' . rawurlencode( $seed ) . '/256/256';
	}

	/**
	 * Looks up a real book or album cover URL with transient caching, the
	 * same way `commons_image_url()` caches Wikidata lookups. Books resolve
	 * via Open Library; albums via MusicBrainz + Cover Art Archive. Returns
	 * null when no cover is available; cached as `''` so misses don't re-hit.
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	public function real_cover_url( string $collection_slug, string $title ): ?string {
		$cache_key = 'cortext_seed_cover_' . md5( $collection_slug . '|' . $title );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			return '' === $cached ? null : (string) $cached;
		}

		$resolved = $this->resolve_real_cover_url( $collection_slug, $title );
		set_transient( $cache_key, $resolved ?? '', MONTH_IN_SECONDS );
		return $resolved;
	}

	/**
	 * Labels a resolved icon/cover URL by the service it came from, for log
	 * output.
	 *
	 * @param string $url Resolved image URL.
	 */
	public function row_icon_source_label( string $url ): string {
		if ( false !== strpos( $url, 'commons.wikimedia.org' ) ) {
			return 'commons';
		}
		if ( false !== strpos( $url, 'openlibrary.org' ) ) {
			return 'open-library';
		}
		if ( false !== strpos( $url, 'coverartarchive.org' ) ) {
			return 'cover-art-archive';
		}
		return 'picsum';
	}

	/**
	 * Walks the icon-bearing collections, resolves each row's icon URL, and
	 * downloads the file into `seed-assets/icons/` so it can be committed and
	 * reused by future seeds. Idempotent: existing bundle files are kept.
	 *
	 * These files ship in the repo, so keep them CC0. The current bundle uses
	 * Met Open Access art; see `seed-assets/CREDITS.md`.
	 *
	 * @param array<int,array<string,mixed>> $collections Collection specs to walk (already compacted or full).
	 */
	public function prefetch_icons( array $collections ): void {
		$bundle_dir = CORTEXT_PATH . 'seed-assets/icons';
		if ( ! is_dir( $bundle_dir ) && ! wp_mkdir_p( $bundle_dir ) ) {
			$this->error( "Failed to create {$bundle_dir}" );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$downloaded = 0;
		$cached     = 0;
		$missed     = 0;
		$total      = 0;

		foreach ( $collections as $spec ) {
			$slug = (string) ( $spec['slug'] ?? '' );
			foreach ( ( $spec['entries'] ?? array() ) as $entry ) {
				$title = (string) ( $entry['title'] ?? '' );
				if ( '' === $title ) {
					continue;
				}
				$url = $this->row_icon_url( $slug, $title );
				if ( null === $url ) {
					continue;
				}
				++$total;
				$dest = $this->bundle_icon_path( $slug, $title );
				if ( file_exists( $dest ) ) {
					++$cached;
					continue;
				}
				$tmp = download_url( $url, 30 );
				if ( is_wp_error( $tmp ) ) {
					$this->warning( "Failed to download icon for {$slug}/{$title}: " . $tmp->get_error_message() );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				if ( ! @copy( $tmp, $dest ) ) {
					// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
					@unlink( $tmp );
					$this->warning( "Failed to write {$dest}" );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
				@unlink( $tmp );
				++$downloaded;
				$this->log( "Bundled {$slug}/{$title} -> " . basename( $dest ) );
			}
		}

		$this->success(
			sprintf(
				'Prefetched %d / %d icons (%d already bundled, %d failed). Bundle directory: %s',
				$downloaded,
				$total,
				$cached,
				$missed,
				$bundle_dir
			)
		);
	}

	/**
	 * Walks book and album rows, resolves each to a real cover URL via
	 * Open Library / Cover Art Archive, and downloads into
	 * `seed-assets/covers/`. Existing bundle files are kept (so a curated
	 * stand-in survives), so re-running this is a way to fill in any gaps
	 * left by manual curation.
	 *
	 * @param array<int,array<string,mixed>> $collections Collection specs to walk (already compacted or full).
	 */
	public function prefetch_covers( array $collections ): void {
		$bundle_dir = CORTEXT_PATH . 'seed-assets/covers';
		if ( ! is_dir( $bundle_dir ) && ! wp_mkdir_p( $bundle_dir ) ) {
			$this->error( "Failed to create {$bundle_dir}" );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$downloaded = 0;
		$cached     = 0;
		$missed     = 0;
		$total      = 0;

		foreach ( $collections as $spec ) {
			$slug = (string) ( $spec['slug'] ?? '' );
			if ( ! in_array( $slug, array( 'books', 'albums' ), true ) ) {
				continue;
			}
			foreach ( ( $spec['entries'] ?? array() ) as $entry ) {
				$title = (string) ( $entry['title'] ?? '' );
				if ( '' === $title ) {
					continue;
				}
				$url = $this->real_cover_url( $slug, $title );
				if ( null === $url ) {
					continue;
				}
				++$total;
				$dest = CORTEXT_PATH . 'seed-assets/covers/' . sanitize_title( $slug ) . '-' . sanitize_title( $title ) . '.jpg';
				if ( file_exists( $dest ) ) {
					++$cached;
					continue;
				}
				$tmp = download_url( $url, 30 );
				if ( is_wp_error( $tmp ) ) {
					$this->warning( "Failed to download cover for {$slug}/{$title}: " . $tmp->get_error_message() );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				if ( ! @copy( $tmp, $dest ) ) {
					// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
					@unlink( $tmp );
					$this->warning( "Failed to write {$dest}" );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
				@unlink( $tmp );
				++$downloaded;
				$this->log( "Bundled cover {$slug}/{$title} -> " . basename( $dest ) );
			}
		}

		$this->success(
			sprintf(
				'Prefetched %d / %d covers (%d already bundled, %d failed).',
				$downloaded,
				$total,
				$cached,
				$missed
			)
		);
	}

	private function resolve_real_cover_url( string $collection_slug, string $title ): ?string {
		if ( 'books' === $collection_slug ) {
			$author = $this->book_authors[ $title ] ?? '';
			return $this->open_library_cover_url( $title, $author );
		}
		if ( 'albums' === $collection_slug ) {
			$artist = $this->album_artists[ $title ] ?? '';
			return $this->cover_art_archive_url( $title, $artist );
		}
		return null;
	}

	private function open_library_cover_url( string $title, string $author ): ?string {
		$params = array(
			'title' => $title,
			'limit' => 5,
		);
		if ( '' !== $author ) {
			$params['author'] = $author;
		}
		$data = $this->fetch_json( 'https://openlibrary.org/search.json?' . http_build_query( $params ) );
		if ( null === $data || empty( $data['docs'] ) ) {
			return null;
		}
		foreach ( $data['docs'] as $doc ) {
			$cover_id = (int) ( $doc['cover_i'] ?? 0 );
			if ( $cover_id > 0 ) {
				return 'https://covers.openlibrary.org/b/id/' . $cover_id . '-L.jpg';
			}
		}
		return null;
	}

	private function cover_art_archive_url( string $title, string $artist ): ?string {
		// MusicBrainz requires an explicit User-Agent and applies a 1 req/s
		// rate limit. The transient cache layer keeps this from biting once
		// covers are resolved; on first prefetch, allow ~1s per row.
		$query    = sprintf( 'release:"%s" AND artist:"%s"', addslashes( $title ), addslashes( $artist ) );
		$response = wp_remote_get(
			'https://musicbrainz.org/ws/2/release/?' . http_build_query(
				array(
					'query' => $query,
					'fmt'   => 'json',
					'limit' => 10,
				)
			),
			array(
				'timeout' => 15,
				'headers' => array(
					'User-Agent' => 'CortextSeeder/1.0 (https://github.com/Automattic/cortext)',
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) || empty( $data['releases'] ) ) {
			return null;
		}

		foreach ( $data['releases'] as $release ) {
			$mbid = (string) ( $release['id'] ?? '' );
			if ( '' === $mbid ) {
				continue;
			}
			$cover_url = "https://coverartarchive.org/release/{$mbid}/front-500";
			$check     = wp_remote_head(
				$cover_url,
				array(
					'timeout'     => 10,
					'redirection' => 3,
				)
			);
			if ( is_wp_error( $check ) ) {
				continue;
			}
			$code = (int) wp_remote_retrieve_response_code( $check );
			if ( 200 === $code ) {
				return $cover_url;
			}
		}
		return null;
	}

	/**
	 * Resolves a row to a Wikimedia Commons file URL by searching Wikidata
	 * for the title (with a collection-specific hint to disambiguate) and
	 * grabbing the entity's `P18` (image) claim. Returns the Commons
	 * `Special:FilePath` URL with `?width=256`, which 302s to a thumbnail.
	 * Returns null on any failure (no entity, no P18, network error) so the
	 * caller can fall back.
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function commons_image_url( string $collection_slug, string $title ): ?string {
		// Resolving a Commons URL takes two HTTP round-trips to Wikidata,
		// which dominates seed time. Cache the resolved URL (or a sentinel
		// for misses) per (slug, title) so a `--reset` reseed reuses prior
		// lookups instead of re-querying. Cache TTL is generous because
		// Wikidata P18 is stable; clear `cortext_seed_commons_*` transients
		// to force a refresh.
		$cache_key = 'cortext_seed_commons_' . md5( $collection_slug . '|' . $title );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			return '' === $cached ? null : (string) $cached;
		}

		$resolved = $this->resolve_commons_image_url( $collection_slug, $title );
		set_transient( $cache_key, $resolved ?? '', MONTH_IN_SECONDS );
		return $resolved;
	}

	private function resolve_commons_image_url( string $collection_slug, string $title ): ?string {
		// Wikidata's `wbsearchentities` matches labels/aliases, so appending an
		// English hint to the query kills matches. Disambiguate by scanning
		// the top results' descriptions for collection-appropriate keywords
		// instead, and fall through to the top hit if none match.
		$keyword_map = array(
			'authors'   => array( 'author', 'writer', 'novelist', 'poet', 'essayist' ),
			'musicians' => array( 'musician', 'singer', 'composer', 'band', 'rapper', 'guitarist', 'drummer', 'pianist', 'rock', 'jazz', 'pop', 'electronic' ),
			'books'     => array( 'novel', 'book', 'novella', 'short story', 'story collection' ),
			'albums'    => array( 'album', 'studio album', 'compilation', 'live album', 'ep' ),
		);
		$keywords    = $keyword_map[ $collection_slug ] ?? null;
		if ( null === $keywords ) {
			return null;
		}

		$entity_id = $this->wikidata_resolve_entity( $title, $keywords );
		if ( null === $entity_id ) {
			return null;
		}

		$filename = $this->wikidata_image_filename( $entity_id );
		if ( null === $filename ) {
			return null;
		}

		return 'https://commons.wikimedia.org/wiki/Special:FilePath/'
			. rawurlencode( $filename )
			. '?width=256';
	}

	/**
	 * Searches Wikidata for `$title` and returns the QID of the first result
	 * whose description contains one of the collection-appropriate keywords.
	 * Falls back to the top hit if none of the top results match (better than
	 * dropping the row entirely; wrong matches still get caught downstream
	 * when the entity has no P18). Returns null only when search is empty.
	 *
	 * @param string            $title    Row title.
	 * @param array<int,string> $keywords Lowercase keywords to look for in entity descriptions.
	 */
	private function wikidata_resolve_entity( string $title, array $keywords ): ?string {
		$url  = 'https://www.wikidata.org/w/api.php?' . http_build_query(
			array(
				'action'   => 'wbsearchentities',
				'search'   => $title,
				'language' => 'en',
				'format'   => 'json',
				'limit'    => 10,
			)
		);
		$data = $this->fetch_json( $url );
		if ( null === $data || empty( $data['search'] ) ) {
			return null;
		}
		foreach ( $data['search'] as $hit ) {
			$description = strtolower( (string) ( $hit['description'] ?? '' ) );
			if ( '' === $description ) {
				continue;
			}
			foreach ( $keywords as $keyword ) {
				if ( false !== strpos( $description, $keyword ) ) {
					return isset( $hit['id'] ) ? (string) $hit['id'] : null;
				}
			}
		}
		return isset( $data['search'][0]['id'] ) ? (string) $data['search'][0]['id'] : null;
	}

	private function wikidata_image_filename( string $entity_id ): ?string {
		$url    = 'https://www.wikidata.org/w/api.php?' . http_build_query(
			array(
				'action' => 'wbgetentities',
				'ids'    => $entity_id,
				'props'  => 'claims',
				'format' => 'json',
			)
		);
		$data   = $this->fetch_json( $url );
		$claims = $data['entities'][ $entity_id ]['claims']['P18'] ?? null;
		if ( ! is_array( $claims ) ) {
			return null;
		}
		foreach ( $claims as $claim ) {
			$value = $claim['mainsnak']['datavalue']['value'] ?? '';
			if ( '' !== $value ) {
				return (string) $value;
			}
		}
		return null;
	}

	private function fetch_json( string $url ): ?array {
		$response = wp_remote_get( $url, array( 'timeout' => 15 ) );
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );
		return is_array( $data ) ? $data : null;
	}

	private function bundle_icon_path( string $collection_slug, string $title ): string {
		$slug = sanitize_title( $collection_slug );
		$key  = sanitize_title( $title );
		return CORTEXT_PATH . 'seed-assets/icons/' . $slug . '-' . $key . '.jpg';
	}

	private function tag_attachment( int $attachment_id ): int {
		if ( $attachment_id > 0 ) {
			( new CortextMedia() )->tag( $attachment_id );
		}

		return $attachment_id;
	}

	private function log( string $message ): void {
		if ( class_exists( '\WP_CLI' ) ) {
			\WP_CLI::log( $message );
		}
	}

	private function warning( string $message ): void {
		if ( class_exists( '\WP_CLI' ) ) {
			\WP_CLI::warning( $message );
		}
	}

	private function success( string $message ): void {
		if ( class_exists( '\WP_CLI' ) ) {
			\WP_CLI::success( $message );
		}
	}

	private function error( string $message ): void {
		if ( class_exists( '\WP_CLI' ) ) {
			\WP_CLI::error( $message );
		}

		// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Exception message is returned to the CLI caller, not rendered here.
		throw new \RuntimeException( $message );
	}
}
