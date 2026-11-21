<?php
/**
 * Turns a document's blocks into Markdown.
 *
 * Blocks are walked with `parse_blocks()`, and their saved HTML is read
 * with the HTML API, so headings, lists, quotes, code, tables, images and
 * inline formatting come out as their Markdown equivalents. Markup with no
 * Markdown equivalent keeps its text. Cortext's own blocks that only frame
 * the editor (icon, cover, properties) are left out; a collection view
 * becomes a link to its collection.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Abilities;

use Cortext\Documents;
use Cortext\PostType\Document;
use WP_HTML_Processor;

defined( 'ABSPATH' ) || exit;

final class MarkdownSerializer {

	/**
	 * Blocks that draw the document's frame in the editor. Their data is
	 * returned next to the Markdown, not inside it.
	 */
	private const FRAME_BLOCKS = array(
		'cortext/document-cover',
		'cortext/document-icon',
		'cortext/document-properties',
	);

	private const BLOCK_TAGS = array(
		'ADDRESS',
		'ARTICLE',
		'ASIDE',
		'BLOCKQUOTE',
		'DD',
		'DETAILS',
		'DIV',
		'DL',
		'DT',
		'FIGCAPTION',
		'FIGURE',
		'FOOTER',
		'H1',
		'H2',
		'H3',
		'H4',
		'H5',
		'H6',
		'HEADER',
		'HR',
		'LI',
		'MAIN',
		'NAV',
		'OL',
		'P',
		'PRE',
		'SECTION',
		'SUMMARY',
		'TABLE',
		'UL',
	);

	// Hard line break inside a paragraph.
	private const LINE_BREAK = "\\\n";

	/**
	 * Markdown for a document's `post_content`.
	 *
	 * @param string $content Serialized blocks.
	 */
	public function serialize( string $content ): string {
		return $this->blocks( parse_blocks( $content ) );
	}

	/**
	 * YAML front matter with one `Label: value` line per property. Values
	 * are written as JSON, which YAML reads as is, so text, numbers, lists
	 * and checkboxes keep their type.
	 *
	 * @param array<int,array{label:string,value:mixed}> $properties Properties in display order.
	 */
	public function front_matter( array $properties ): string {
		if ( count( $properties ) === 0 ) {
			return '';
		}

		$lines = array( '---' );
		foreach ( $properties as $property ) {
			$label   = $property['label'];
			$key     = preg_match( '/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u', $label ) ? rtrim( $label ) : $this->json( $label );
			$lines[] = $key . ': ' . $this->json( $property['value'] );
		}
		$lines[] = '---';

		return implode( "\n", $lines );
	}

	/**
	 * Markdown for a list of parsed blocks, one block per paragraph.
	 *
	 * @param array<int,array<string,mixed>> $blocks Parsed blocks.
	 */
	private function blocks( array $blocks ): string {
		return $this->join( array_map( array( $this, 'block' ), $blocks ), "\n\n" );
	}

	/**
	 * Markdown for one parsed block.
	 *
	 * @param array<string,mixed> $block Parsed block.
	 */
	private function block( array $block ): string {
		$name  = $block['blockName'] ?? null;
		$inner = $block['innerBlocks'] ?? array();

		if ( in_array( $name, self::FRAME_BLOCKS, true ) ) {
			return '';
		}

		if ( 'cortext/data-view' === $name ) {
			return $this->collection_view( (int) ( $block['attrs']['collectionId'] ?? 0 ) );
		}

		// List items only hold text and nested lists, so the whole list reads
		// from its HTML, which also covers lists saved without item blocks.
		if ( 'core/list' === $name || count( $inner ) === 0 ) {
			return $this->html( $this->static_html( $block ) );
		}

		$wrapper = implode( '', array_filter( $block['innerContent'] ?? array(), 'is_string' ) );

		if ( 'core/quote' === $name ) {
			$cite = $this->find( $this->tree( $wrapper ) ?? array(), 'CITE' );
			return $this->quote(
				$this->join( array( $this->blocks( $inner ), null === $cite ? '' : $this->inline( $cite['children'] ) ), "\n\n" )
			);
		}

		// Groups, columns, details and other containers: their own text, such
		// as a summary, then their inner blocks.
		return $this->join( array( $this->html( $wrapper ), $this->blocks( $inner ) ), "\n\n" );
	}

	/**
	 * A link to the collection a collection view shows, when the user can
	 * edit it.
	 *
	 * @param int $collection_id Collection post ID.
	 */
	private function collection_view( int $collection_id ): string {
		$collection = ( new Documents() )->find( $collection_id );
		if ( null === $collection || ! Document::is_collection( $collection_id ) ) {
			return '';
		}

		return sprintf(
			/* translators: %s: Markdown link to the collection. */
			__( 'Collection view: %s', 'cortext' ),
			'[' . $this->escape( $collection['title'] ) . '](' . $this->destination( (string) get_permalink( $collection_id ) ) . ')'
		);
	}

	/**
	 * The block's saved HTML with its inner blocks' HTML in place.
	 *
	 * @param array<string,mixed> $block Parsed block.
	 */
	private function static_html( array $block ): string {
		$html  = '';
		$index = 0;
		foreach ( $block['innerContent'] ?? array() as $chunk ) {
			$html .= is_string( $chunk )
				? $chunk
				: $this->static_html( $block['innerBlocks'][ $index++ ] );
		}
		return $html;
	}

	/**
	 * Markdown for an HTML fragment. Markup the HTML API can't read keeps
	 * its text.
	 *
	 * @param string $html HTML fragment.
	 */
	private function html( string $html ): string {
		if ( '' === trim( $html ) ) {
			return '';
		}

		$tree = $this->tree( $html );
		if ( null === $tree ) {
			return trim( html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		}

		return $this->block_children( $tree );
	}

	/**
	 * Reads an HTML fragment into nested nodes. Text nodes are strings, and
	 * elements are `{ tag, attrs, children }`.
	 *
	 * @param string $html HTML fragment.
	 * @return array<int,string|array<string,mixed>>|null Null when the HTML API can't read the fragment.
	 */
	private function tree( string $html ): ?array {
		$processor = WP_HTML_Processor::create_fragment( $html );
		if ( null === $processor ) {
			return null;
		}

		$children = $this->read_children( $processor );
		return null === $processor->get_last_error() ? $children : null;
	}

	/**
	 * Reads nodes up to the closer of the current element.
	 *
	 * @param WP_HTML_Processor $processor Processor on the parent element.
	 * @return array<int,string|array<string,mixed>>
	 */
	private function read_children( WP_HTML_Processor $processor ): array {
		$children = array();

		while ( $processor->next_token() ) {
			$type = $processor->get_token_type();
			if ( '#text' === $type ) {
				$children[] = $processor->get_modifiable_text();
				continue;
			}
			if ( '#tag' !== $type ) {
				continue;
			}
			if ( $processor->is_tag_closer() ) {
				return $children;
			}

			$attrs = array();
			foreach ( array( 'href', 'src', 'alt', 'start' ) as $attribute ) {
				$value = $processor->get_attribute( $attribute );
				if ( is_string( $value ) ) {
					$attrs[ $attribute ] = $value;
				}
			}

			$children[] = array(
				'tag'      => (string) $processor->get_tag(),
				'attrs'    => $attrs,
				'children' => $processor->expects_closer() ? $this->read_children( $processor ) : array(),
			);
		}

		return $children;
	}

	/**
	 * Block-level Markdown for a list of nodes. Runs of text and inline
	 * elements become paragraphs.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes     Nodes.
	 * @param string                                $separator Between blocks.
	 */
	private function block_children( array $nodes, string $separator = "\n\n" ): string {
		$parts  = array();
		$inline = array();

		foreach ( $nodes as $node ) {
			if ( is_array( $node ) && in_array( $node['tag'], self::BLOCK_TAGS, true ) ) {
				$parts[] = $this->paragraph( $inline );
				$parts[] = $this->block_node( $node );
				$inline  = array();
				continue;
			}
			$inline[] = $node;
		}
		$parts[] = $this->paragraph( $inline );

		return $this->join( $parts, $separator );
	}

	/**
	 * A paragraph from a run of inline nodes.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes Inline nodes.
	 */
	private function paragraph( array $nodes ): string {
		return trim( (string) preg_replace( '/\n +/', "\n", $this->inline( $nodes ) ) );
	}

	/**
	 * Markdown for one block-level element.
	 *
	 * @param array<string,mixed> $node Block-level element.
	 */
	private function block_node( array $node ): string {
		$tag = $node['tag'];

		if ( preg_match( '/^H([1-6])$/', $tag, $level ) ) {
			$text = $this->single_line( $this->inline( $node['children'] ) );
			return '' === $text ? '' : str_repeat( '#', (int) $level[1] ) . ' ' . $text;
		}

		return match ( $tag ) {
			'UL', 'OL'   => $this->list( $node ),
			'BLOCKQUOTE' => $this->quote( $this->block_children( $node['children'] ) ),
			'PRE'        => $this->fence( $this->text( $node['children'] ) ),
			'HR'         => '---',
			'TABLE'      => $this->table( $node ),
			default      => $this->block_children( $node['children'] ),
		};
	}

	/**
	 * A Markdown list. Nested lists are indented under their item.
	 *
	 * @param array<string,mixed> $node `UL` or `OL` element.
	 */
	private function list( array $node ): string {
		$ordered = 'OL' === $node['tag'];
		$number  = $ordered && isset( $node['attrs']['start'] ) && is_numeric( $node['attrs']['start'] )
			? (int) $node['attrs']['start']
			: 1;
		$items   = array();

		foreach ( $node['children'] as $child ) {
			if ( ! is_array( $child ) || 'LI' !== $child['tag'] ) {
				continue;
			}

			$marker  = $ordered ? ( $number++ ) . '. ' : '- ';
			$body    = $this->block_children( $child['children'], "\n" );
			$indent  = str_repeat( ' ', strlen( $marker ) );
			$items[] = rtrim( $marker . preg_replace( '/\n(?=[^\n])/', "\n" . $indent, $body ) );
		}

		return implode( "\n", $items );
	}

	private function quote( string $markdown ): string {
		if ( '' === $markdown ) {
			return '';
		}

		return implode(
			"\n",
			array_map(
				static fn( string $line ): string => '' === $line ? '>' : '> ' . $line,
				explode( "\n", $markdown )
			)
		);
	}

	private function fence( string $code ): string {
		$code = rtrim( $code, "\n" );
		if ( '' === $code ) {
			return '';
		}

		$fence = str_repeat( '`', max( 3, $this->longest_backtick_run( $code ) + 1 ) );
		return "{$fence}\n{$code}\n{$fence}";
	}

	/**
	 * A pipe table. The first row is the header.
	 *
	 * @param array<string,mixed> $node `TABLE` element.
	 */
	private function table( array $node ): string {
		$rows = array();
		foreach ( $this->table_rows( $node['children'] ) as $row ) {
			$cells = array();
			foreach ( $row['children'] as $cell ) {
				if ( is_array( $cell ) && in_array( $cell['tag'], array( 'TH', 'TD' ), true ) ) {
					$text    = trim( $this->inline( $cell['children'] ) );
					$cells[] = str_replace( array( self::LINE_BREAK, "\n", '|' ), array( '<br>', ' ', '\|' ), $text );
				}
			}
			$rows[] = $cells;
		}

		$columns = count( $rows ) > 0 ? max( array_map( 'count', $rows ) ) : 0;
		if ( 0 === $columns ) {
			return '';
		}

		$lines = array();
		foreach ( $rows as $index => $cells ) {
			$lines[] = '| ' . implode( ' | ', array_pad( $cells, $columns, '' ) ) . ' |';
			if ( 0 === $index ) {
				$lines[] = '|' . str_repeat( ' --- |', $columns );
			}
		}

		return implode( "\n", $lines );
	}

	/**
	 * `TR` elements of a table, through its sections but not nested tables.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes Table children.
	 * @return array<int,array<string,mixed>>
	 */
	private function table_rows( array $nodes ): array {
		$rows = array();
		foreach ( $nodes as $node ) {
			if ( ! is_array( $node ) ) {
				continue;
			}
			if ( 'TR' === $node['tag'] ) {
				$rows[] = $node;
			} elseif ( in_array( $node['tag'], array( 'THEAD', 'TBODY', 'TFOOT' ), true ) ) {
				$rows = array_merge( $rows, $this->table_rows( $node['children'] ) );
			}
		}
		return $rows;
	}

	/**
	 * Inline Markdown for a list of nodes.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes Nodes.
	 */
	private function inline( array $nodes ): string {
		$markdown = '';
		foreach ( $nodes as $node ) {
			$markdown .= is_string( $node ) ? $this->escape( (string) preg_replace( '/\s+/', ' ', $node ) ) : $this->inline_node( $node );
		}
		return $markdown;
	}

	/**
	 * Inline Markdown for one element.
	 *
	 * @param array<string,mixed> $node Element.
	 */
	private function inline_node( array $node ): string {
		$children = $node['children'];

		switch ( $node['tag'] ) {
			case 'STRONG':
			case 'B':
				return $this->wrap( '**', $this->inline( $children ) );
			case 'EM':
			case 'I':
				return $this->wrap( '*', $this->inline( $children ) );
			case 'S':
			case 'DEL':
			case 'STRIKE':
				return $this->wrap( '~~', $this->inline( $children ) );
			case 'CODE':
				return $this->code_span( $this->single_line( $this->text( $children ) ) );
			case 'BR':
				return self::LINE_BREAK;
			case 'IMG':
				$src = $node['attrs']['src'] ?? '';
				return '' === $src ? '' : '![' . $this->escape( $node['attrs']['alt'] ?? '' ) . '](' . $this->destination( $src ) . ')';
			case 'A':
				$text = $this->inline( $children );
				$href = $node['attrs']['href'] ?? '';
				return '' === $href || '' === trim( $text ) ? $text : '[' . trim( $text ) . '](' . $this->destination( $href ) . ')';
		}

		$markdown = $this->inline( $children );
		return in_array( $node['tag'], self::BLOCK_TAGS, true ) ? $markdown . "\n" : $markdown;
	}

	/**
	 * Wraps text in an emphasis marker, keeping surrounding spaces outside
	 * so the marker still applies.
	 *
	 * @param string $marker   Markdown marker.
	 * @param string $markdown Inner Markdown.
	 */
	private function wrap( string $marker, string $markdown ): string {
		if ( '' === trim( $markdown ) ) {
			return $markdown;
		}

		preg_match( '/^(\s*)(.*?)(\s*)$/s', $markdown, $parts );
		return $parts[1] . $marker . $parts[2] . $marker . $parts[3];
	}

	private function code_span( string $code ): string {
		if ( '' === $code ) {
			return '';
		}

		$ticks = str_repeat( '`', $this->longest_backtick_run( $code ) + 1 );
		$pad   = str_starts_with( $code, '`' ) || str_ends_with( $code, '`' ) ? ' ' : '';
		return $ticks . $pad . $code . $pad . $ticks;
	}

	/**
	 * Plain text of a list of nodes, with line breaks kept.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes Nodes.
	 */
	private function text( array $nodes ): string {
		$text = '';
		foreach ( $nodes as $node ) {
			if ( is_string( $node ) ) {
				$text .= $node;
			} else {
				$text .= 'BR' === $node['tag'] ? "\n" : $this->text( $node['children'] );
			}
		}
		return $text;
	}

	/**
	 * First element with the given tag, searched depth first.
	 *
	 * @param array<int,string|array<string,mixed>> $nodes Nodes.
	 * @param string                                $tag   Upper-case tag name.
	 * @return array<string,mixed>|null
	 */
	private function find( array $nodes, string $tag ): ?array {
		foreach ( $nodes as $node ) {
			if ( ! is_array( $node ) ) {
				continue;
			}
			if ( $tag === $node['tag'] ) {
				return $node;
			}
			$found = $this->find( $node['children'], $tag );
			if ( null !== $found ) {
				return $found;
			}
		}
		return null;
	}

	/**
	 * Escapes characters that would otherwise read as Markdown formatting.
	 *
	 * @param string $text Plain text.
	 */
	private function escape( string $text ): string {
		return addcslashes( $text, '\\`*_[]' );
	}

	/**
	 * A link or image URL that stays inside its parentheses.
	 *
	 * @param string $url URL.
	 */
	private function destination( string $url ): string {
		return strtr(
			$url,
			array(
				' ' => '%20',
				'(' => '%28',
				')' => '%29',
			)
		);
	}

	private function single_line( string $markdown ): string {
		return trim( (string) preg_replace( '/\s+/', ' ', str_replace( self::LINE_BREAK, ' ', $markdown ) ) );
	}

	private function longest_backtick_run( string $text ): int {
		preg_match_all( '/`+/', $text, $runs );
		return count( $runs[0] ) > 0 ? max( array_map( 'strlen', $runs[0] ) ) : 0;
	}

	private function json( mixed $value ): string {
		return (string) wp_json_encode( $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	}

	/**
	 * Joins the non-empty parts.
	 *
	 * @param array<int,string> $parts     Rendered parts.
	 * @param string            $separator Between non-empty parts.
	 */
	private function join( array $parts, string $separator ): string {
		return implode( $separator, array_filter( $parts, static fn( string $part ): bool => '' !== $part ) );
	}
}
