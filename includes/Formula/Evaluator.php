<?php
/**
 * Evaluates compiled Cortext formula ASTs.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

use Cortext\Relations;
use WP_Post;

final class Evaluator {

	/**
	 * @param array<string,mixed> $ast Compiled formula AST.
	 * @return array{value:mixed,type:string}
	 * @throws FormulaEvalError When evaluation fails.
	 */
	public function evaluate( array $ast, WP_Post $row ): array {
		return $this->evaluate_node( $ast, $row );
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_node( array $node, WP_Post $row ): array {
		return match ( $node['node'] ?? '' ) {
			'literal' => array(
				'value' => $node['value'] ?? null,
				'type'  => (string) ( $node['type'] ?? 'text' ),
			),
			'prop' => $this->evaluate_prop( $node, $row ),
			'unary' => $this->evaluate_unary( $node, $row ),
			'binary' => $this->evaluate_binary( $node, $row ),
			'call' => $this->evaluate_call( $node, $row ),
			default => throw new FormulaEvalError(
				'cortext_formula_invalid_ast',
				__( 'We couldn\'t calculate this formula.', 'cortext' )
			),
		};
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_prop( array $node, WP_Post $row ): array {
		$type = (string) ( $node['type'] ?? 'text' );
		if ( 'system' === ( $node['source'] ?? '' ) ) {
			$key = (string) ( $node['key'] ?? '' );
			return array(
				'value' => match ( $key ) {
					'title' => $row->post_title,
					'created_at' => $this->format_gmt_date( $row->post_date_gmt ),
					'modified_at' => $this->format_gmt_date( $row->post_modified_gmt ),
					default => null,
				},
				'type'  => $type,
			);
		}

		$field_id = (int) ( $node['field_id'] ?? 0 );
		if ( $field_id < 1 ) {
			return array(
				'value' => null,
				'type'  => $type,
			);
		}
		return array(
			'value' => $this->typed_field_value( $row->ID, $field_id, $type ),
			'type'  => $type,
		);
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_unary( array $node, WP_Post $row ): array {
		$value = $this->evaluate_node( (array) $node['argument'], $row );
		if ( 'number' !== $value['type'] ) {
			throw new FormulaEvalError(
				'cortext_formula_type_mismatch',
				__( 'The minus sign can only be used with a number.', 'cortext' )
			);
		}
		return array(
			'value' => -1 * (float) ( $value['value'] ?? 0 ),
			'type'  => 'number',
		);
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_binary( array $node, WP_Post $row ): array {
		$left     = $this->evaluate_node( (array) $node['left'], $row );
		$right    = $this->evaluate_node( (array) $node['right'], $row );
		$operator = (string) $node['operator'];

		if ( in_array( $operator, array( '=', '==', '!=', '>', '<', '>=', '<=' ), true ) ) {
			return array(
				'value' => $this->compare_values( $left, $right, $operator ),
				'type'  => 'checkbox',
			);
		}

		if ( '+' === $operator && ( 'text' === $left['type'] || 'text' === $right['type'] ) ) {
			return array(
				'value' => (string) ( $left['value'] ?? '' ) . (string) ( $right['value'] ?? '' ),
				'type'  => 'text',
			);
		}

		if ( 'number' !== $left['type'] || 'number' !== $right['type'] ) {
			throw new FormulaEvalError(
				'cortext_formula_type_mismatch',
				__( 'Math operators only work with numbers.', 'cortext' )
			);
		}

		$a = (float) ( $left['value'] ?? 0 );
		$b = (float) ( $right['value'] ?? 0 );
		if ( '/' === $operator && 0.0 === $b ) {
			throw new FormulaEvalError(
				'cortext_formula_divide_by_zero',
				__( 'You cannot divide by zero.', 'cortext' )
			);
		}

		return array(
			'value' => match ( $operator ) {
				'+' => $a + $b,
				'-' => $a - $b,
				'*' => $a * $b,
				'/' => $a / $b,
				default => null,
			},
			'type'  => 'number',
		);
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_call( array $node, WP_Post $row ): array {
		if ( 'if' === (string) ( $node['name'] ?? '' ) ) {
			return $this->evaluate_if_call( $node, $row );
		}

		$args = array_map(
			fn( array $arg ): array => $this->evaluate_node( $arg, $row ),
			(array) $node['args']
		);
		return Functions::evaluate( (string) $node['name'], $args );
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{value:mixed,type:string}
	 */
	private function evaluate_if_call( array $node, WP_Post $row ): array {
		$args = array_values( (array) ( $node['args'] ?? array() ) );
		if ( 3 !== count( $args ) ) {
			throw new FormulaEvalError(
				'cortext_formula_invalid_arity',
				__( 'if() needs condition, then, and else values.', 'cortext' )
			);
		}

		$condition = $this->evaluate_node( (array) $args[0], $row );
		$branch    = ! empty( $condition['value'] ) ? $args[1] : $args[2];
		$result    = $this->evaluate_node( (array) $branch, $row );
		$type      = (string) ( $node['type'] ?? $result['type'] );

		return array(
			'value' => $result['value'] ?? null,
			'type'  => '' !== $type ? $type : (string) $result['type'],
		);
	}

	/**
	 * @param array{value:mixed,type:string} $left
	 * @param array{value:mixed,type:string} $right
	 */
	private function compare_values( array $left, array $right, string $operator ): bool {
		$a = $left['value'] ?? null;
		$b = $right['value'] ?? null;

		if ( in_array( $left['type'], array( 'date', 'datetime' ), true ) && in_array( $right['type'], array( 'date', 'datetime' ), true ) ) {
			$a = strtotime( (string) $a );
			$b = strtotime( (string) $b );
		}

		if ( 'number' === $left['type'] && 'number' === $right['type'] ) {
			$a = (float) $a;
			$b = (float) $b;
		}

		return match ( $operator ) {
			'=', '==' => $a == $b, // phpcs:ignore Universal.Operators.StrictComparisons.LooseEqual
			'!=' => $a != $b, // phpcs:ignore Universal.Operators.StrictComparisons.LooseNotEqual
			'>' => $a > $b,
			'<' => $a < $b,
			'>=' => $a >= $b,
			'<=' => $a <= $b,
			default => false,
		};
	}

	private function typed_field_value( int $row_id, int $field_id, string $type ): mixed {
		$key   = Relations::meta_key( $field_id );
		$value = get_post_meta( $row_id, $key, true );
		if ( '' === $value || null === $value ) {
			return 'checkbox' === $type ? false : null;
		}
		return match ( $type ) {
			'number' => is_numeric( $value ) ? (float) $value : null,
			'checkbox' => Relations::is_truthy( $value ),
			'date' => false === strtotime( (string) $value ) ? null : gmdate( 'Y-m-d', (int) strtotime( (string) $value ) ),
			'datetime' => false === strtotime( (string) $value ) ? null : gmdate( DATE_RFC3339, (int) strtotime( (string) $value ) ),
			default => (string) $value,
		};
	}

	private function format_gmt_date( ?string $mysql_gmt ): string {
		if ( ! $mysql_gmt || '0000-00-00 00:00:00' === $mysql_gmt ) {
			return '';
		}
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		return false === $timestamp ? '' : gmdate( DATE_RFC3339, $timestamp );
	}
}
