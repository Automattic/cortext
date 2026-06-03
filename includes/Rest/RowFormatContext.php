<?php
/**
 * Request-local metadata for row formatting.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * Holds field metadata for one `get_rows()` call. The controller passes this
 * object through the formatter instead of keeping cache state on itself.
 */
final class RowFormatContext {

	/**
	 * Field ID => field type.
	 *
	 * @var array<int, string>
	 */
	public array $field_types = array();

	/**
	 * Relation field ID => relation config.
	 *
	 * @var array<int, array{related_collection_id: int, target_slug: string}>
	 */
	public array $relation_field_meta = array();

	/**
	 * Rollup field ID => rollup config.
	 *
	 * @var array<int, array{relation_field_id: int, target_field_id: int, aggregator: string}>
	 */
	public array $rollup_field_meta = array();
}
