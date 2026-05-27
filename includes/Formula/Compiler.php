<?php
/**
 * Compiles formula expressions into ID-resolved ASTs.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Relations;
use WP_Post;

final class Compiler {

	private const MAX_AST_DEPTH = 64;
	private const MAX_AST_NODES = 512;

	private const SYSTEM_PROPS = array(
		'Title'       => array(
			'key'  => 'title',
			'type' => 'text',
		),
		'Created'     => array(
			'key'  => 'created_at',
			'type' => 'datetime',
		),
		'Last edited' => array(
			'key'  => 'modified_at',
			'type' => 'datetime',
		),
	);

	/**
	 * @return array{ast:array<string,mixed>,deps:int[],result_type:string,volatile:bool,refs:array<string,array<string,mixed>>}
	 * @throws FormulaParseError When the expression is invalid.
	 */
	public function compile( string $expression, int $collection_id, int $self_field_id = 0, array $previous_refs = array(), array $formula_overrides = array() ): array {
		$tokens  = ( new Lexer() )->tokenize( $expression );
		$raw_ast = ( new Parser( $tokens ) )->parse();
		$this->assert_ast_limits( $raw_ast );
		$field_map = $this->collection_field_map( $collection_id, $formula_overrides );
		$resolved  = $this->resolve_node( $raw_ast, $field_map, $self_field_id, $previous_refs );

		$deps = array_values( array_unique( array_map( 'intval', $resolved['deps'] ) ) );
		$this->assert_no_cycle( $collection_id, $self_field_id, $deps );

		return array(
			'ast'         => $resolved['node'],
			'deps'        => $deps,
			'result_type' => (string) $resolved['type'],
			'volatile'    => ! empty( $resolved['volatile'] ),
			'refs'        => $resolved['refs'],
		);
	}

	/**
	 * @param array<int,array{result_type:string,volatile:bool}> $formula_overrides Compiled formula metadata not yet persisted.
	 * @return array<int,array{id:int,title:string,type:string,result_type:string,multiple:bool,volatile:bool}>
	 */
	private function collection_field_map( int $collection_id, array $formula_overrides = array() ): array {
		$map = array();
		foreach ( Document::collection_field_ids( $collection_id ) as $raw_field_id ) {
			$field_id = (int) $raw_field_id;
			$field    = get_post( $field_id );
			if ( ! $field instanceof WP_Post || Field::POST_TYPE !== $field->post_type ) {
				continue;
			}
			$type        = (string) get_post_meta( $field_id, 'type', true );
			$result_type = FieldTypeRegistry::effective_type_for_field( $field_id, $type );
			$volatile    = 'formula' === $type && $this->field_is_volatile( $field_id );
			if ( 'formula' === $type && isset( $formula_overrides[ $field_id ] ) ) {
				$result_type = (string) ( $formula_overrides[ $field_id ]['result_type'] ?? $result_type );
				$volatile    = ! empty( $formula_overrides[ $field_id ]['volatile'] );
			}
			$map[ $field_id ] = array(
				'id'          => $field_id,
				'title'       => $field->post_title,
				'type'        => $type,
				'result_type' => $this->formula_result_type_for_reference( $result_type ),
				'multiple'    => 'multiselect' === $type || ( 'relation' === $type && Relations::relation_is_multiple( $field_id ) ),
				'volatile'    => $volatile,
			);
		}
		return $map;
	}

	private function formula_result_type_for_reference( string $type ): string {
		return match ( $type ) {
			'email', 'url', 'select' => 'text',
			default => $type,
		};
	}

	/**
	 * @param array<string,mixed> $node Raw formula AST.
	 */
	private function assert_ast_limits( array $node ): void {
		$count = 0;
		$this->walk_ast_limits( $node, 0, $count );
	}

	/**
	 * @param array<string,mixed> $node Raw formula AST.
	 */
	private function walk_ast_limits( array $node, int $depth, int &$count ): void {
		if ( $depth > self::MAX_AST_DEPTH ) {
			throw new FormulaParseError(
				'cortext_formula_too_deep',
				__( 'This formula is nested too deeply.', 'cortext' )
			);
		}

		++$count;
		if ( $count > self::MAX_AST_NODES ) {
			throw new FormulaParseError(
				'cortext_formula_too_complex',
				__( 'This formula is too complex.', 'cortext' )
			);
		}

		foreach ( array( 'argument', 'left', 'right' ) as $child_key ) {
			if ( isset( $node[ $child_key ] ) && is_array( $node[ $child_key ] ) ) {
				$this->walk_ast_limits( (array) $node[ $child_key ], $depth + 1, $count );
			}
		}

		if ( ! isset( $node['args'] ) || ! is_array( $node['args'] ) ) {
			return;
		}

		foreach ( $node['args'] as $arg ) {
			if ( is_array( $arg ) ) {
				$this->walk_ast_limits( $arg, $depth + 1, $count );
			}
		}
	}

	/**
	 * @param array<string,mixed>                                                                $node
	 * @param array<int,array{id:int,title:string,type:string,result_type:string,multiple:bool,volatile:bool}> $field_map
	 * @return array{node:array<string,mixed>,type:string,deps:int[],volatile:bool,refs:array<string,array<string,mixed>>}
	 */
	private function resolve_node( array $node, array $field_map, int $self_field_id, array $previous_refs ): array {
		return match ( $node['node'] ?? '' ) {
			'literal' => array(
				'node'     => $node,
				'type'     => (string) $node['type'],
				'deps'     => array(),
				'volatile' => false,
				'refs'     => array(),
			),
			'unary' => $this->resolve_unary( $node, $field_map, $self_field_id, $previous_refs ),
			'binary' => $this->resolve_binary( $node, $field_map, $self_field_id, $previous_refs ),
			'call' => $this->resolve_call( $node, $field_map, $self_field_id, $previous_refs ),
			default => throw new FormulaParseError(
				'cortext_formula_invalid_ast',
				__( 'We couldn\'t read this formula.', 'cortext' )
			),
		};
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{node:array<string,mixed>,type:string,deps:int[],volatile:bool,refs:array<string,array<string,mixed>>}
	 */
	private function resolve_unary( array $node, array $field_map, int $self_field_id, array $previous_refs ): array {
		$arg = $this->resolve_node( (array) $node['argument'], $field_map, $self_field_id, $previous_refs );
		if ( 'number' !== $arg['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'Use unary minus with a number.', 'cortext' )
			);
		}
		return array(
			'node'     => array(
				'node'     => 'unary',
				'operator' => '-',
				'argument' => $arg['node'],
				'type'     => 'number',
			),
			'type'     => 'number',
			'deps'     => $arg['deps'],
			'volatile' => $arg['volatile'],
			'refs'     => $arg['refs'],
		);
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{node:array<string,mixed>,type:string,deps:int[],volatile:bool,refs:array<string,array<string,mixed>>}
	 */
	private function resolve_binary( array $node, array $field_map, int $self_field_id, array $previous_refs ): array {
		$left     = $this->resolve_node( (array) $node['left'], $field_map, $self_field_id, $previous_refs );
		$right    = $this->resolve_node( (array) $node['right'], $field_map, $self_field_id, $previous_refs );
		$operator = (string) $node['operator'];
		$type     = 'number';

		if ( in_array( $operator, array( '=', '==', '!=', '>', '<', '>=', '<=' ), true ) ) {
			if ( ! $this->comparable_types( $left['type'], $right['type'] ) ) {
				throw new FormulaParseError(
					'cortext_formula_type_mismatch',
					__( 'Compare values of the same kind.', 'cortext' )
				);
			}
			$type = 'checkbox';
		} elseif ( '+' === $operator && ( 'text' === $left['type'] || 'text' === $right['type'] ) ) {
			$type = 'text';
		} elseif ( 'number' !== $left['type'] || 'number' !== $right['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'Math operators only work with numbers.', 'cortext' )
			);
		}

		return array(
			'node'     => array(
				'node'     => 'binary',
				'operator' => $operator,
				'left'     => $left['node'],
				'right'    => $right['node'],
				'type'     => $type,
			),
			'type'     => $type,
			'deps'     => array_merge( $left['deps'], $right['deps'] ),
			'volatile' => $left['volatile'] || $right['volatile'],
			'refs'     => array_merge( $left['refs'], $right['refs'] ),
		);
	}

	/**
	 * @param array<string,mixed> $node
	 * @return array{node:array<string,mixed>,type:string,deps:int[],volatile:bool,refs:array<string,array<string,mixed>>}
	 */
	private function resolve_call( array $node, array $field_map, int $self_field_id, array $previous_refs ): array {
		$name = (string) $node['name'];
		if ( in_array( $name, array( 'field', 'prop' ), true ) ) {
			return $this->resolve_prop( (array) $node['args'], $field_map, $self_field_id, $previous_refs );
		}

		$args     = array_map(
			fn( array $arg ): array => $this->resolve_node( $arg, $field_map, $self_field_id, $previous_refs ),
			(array) $node['args']
		);
		$inferred = Functions::infer( $name, array_column( $args, 'node' ) );

		return array(
			'node'     => array(
				'node'     => 'call',
				'name'     => $name,
				'args'     => array_column( $args, 'node' ),
				'type'     => $inferred['type'],
				'volatile' => $inferred['volatile'],
			),
			'type'     => $inferred['type'],
			'deps'     => $this->merge_child_values( $args, 'deps' ),
			'volatile' => $inferred['volatile'] || in_array( true, array_column( $args, 'volatile' ), true ),
			'refs'     => $this->merge_child_values( $args, 'refs' ),
		);
	}

	/**
	 * @param array<int,array<string,mixed>> $args Resolved child expressions.
	 * @return array<int|string,mixed>
	 */
	private function merge_child_values( array $args, string $key ): array {
		$values = array();
		foreach ( $args as $arg ) {
			if ( isset( $arg[ $key ] ) && is_array( $arg[ $key ] ) ) {
				$values = array_merge( $values, $arg[ $key ] );
			}
		}
		return $values;
	}

	/**
	 * @param array<int,array<string,mixed>> $args
	 * @return array{node:array<string,mixed>,type:string,deps:int[],volatile:bool,refs:array<string,array<string,mixed>>}
	 */
	private function resolve_prop( array $args, array $field_map, int $self_field_id, array $previous_refs ): array {
		if ( 1 !== count( $args ) || 'literal' !== ( $args[0]['node'] ?? '' ) || 'text' !== ( $args[0]['type'] ?? '' ) ) {
			throw new FormulaParseError(
				'cortext_formula_invalid_prop',
				__( 'Use one quoted field name, like field("Price"). prop() works too.', 'cortext' )
			);
		}

		$name = (string) $args[0]['value'];
		if ( isset( self::SYSTEM_PROPS[ $name ] ) ) {
			$system = self::SYSTEM_PROPS[ $name ];
			return array(
				'node'     => array(
					'node'   => 'prop',
					'source' => 'system',
					'key'    => $system['key'],
					'name'   => $name,
					'type'   => $system['type'],
				),
				'type'     => $system['type'],
				'deps'     => array(),
				'volatile' => false,
				'refs'     => array(
					$name => array(
						'source' => 'system',
						'key'    => $system['key'],
					),
				),
			);
		}

		$matches = array();
		if ( isset( $previous_refs[ $name ] ) ) {
			$previous    = $previous_refs[ $name ];
			$previous_id = isset( $previous['id'] ) ? (int) $previous['id'] : 0;
			if ( isset( $field_map[ $previous_id ] ) ) {
				$matches = array( $field_map[ $previous_id ] );
			}
		}
		if ( count( $matches ) === 0 ) {
			$matches = array_values(
				array_filter(
					$field_map,
					static fn( array $field ): bool => $field['title'] === $name
				)
			);
		}

		if ( count( $matches ) === 0 ) {
			throw new FormulaParseError(
				'cortext_formula_unknown_prop',
				sprintf(
					/* translators: %s: referenced field name. */
					__( 'Formula field not found: %s', 'cortext' ),
					$name
				)
			);
		}

		if ( count( $matches ) > 1 ) {
			throw new FormulaParseError(
				'cortext_formula_ambiguous_prop',
				sprintf(
					/* translators: %s: referenced field name. */
					__( 'More than one field is named %s. Rename one or use a unique field.', 'cortext' ),
					$name
				)
			);
		}

		$field    = $matches[0];
		$field_id = (int) $field['id'];
		if ( $field_id === $self_field_id ) {
			throw new FormulaParseError(
				'cortext_formula_self_reference',
				__( 'A formula cannot use itself.', 'cortext' )
			);
		}
		if ( $field['multiple'] || in_array( $field['type'], array( 'relation', 'rollup' ), true ) ) {
			throw new FormulaParseError(
				'cortext_formula_unsupported_target_type',
				__( 'Formulas can only use single-value fields in v0. Multi-select, relation, and rollup fields are not available yet.', 'cortext' )
			);
		}

		$volatile = 'formula' === $field['type'] && ! empty( $field['volatile'] );
		return array(
			'node'     => array(
				'node'     => 'prop',
				'source'   => 'field',
				'field_id' => $field_id,
				'name'     => $name,
				'type'     => $field['result_type'],
			),
			'type'     => $field['result_type'],
			'deps'     => array( $field_id ),
			'volatile' => $volatile,
			'refs'     => array(
				$name => array(
					'source' => 'field',
					'id'     => $field_id,
				),
			),
		);
	}

	private function comparable_types( string $left, string $right ): bool {
		if ( $left === $right ) {
			return true;
		}
		return in_array( $left, array( 'date', 'datetime' ), true ) && in_array( $right, array( 'date', 'datetime' ), true );
	}

	/**
	 * @param int[] $deps
	 */
	private function assert_no_cycle( int $collection_id, int $self_field_id, array $deps ): void {
		if ( $self_field_id < 1 ) {
			return;
		}

		$graph = array( $self_field_id => $deps );
		foreach ( Document::collection_field_ids( $collection_id ) as $raw_field_id ) {
			$field_id = (int) $raw_field_id;
			if ( $field_id < 1 || $field_id === $self_field_id || 'formula' !== (string) get_post_meta( $field_id, 'type', true ) ) {
				continue;
			}
			$graph[ $field_id ] = $this->stored_deps( $field_id );
		}

		$visiting = array();
		$visited  = array();
		$walk     = function ( int $field_id ) use ( &$walk, &$graph, &$visiting, &$visited, $self_field_id ): void {
			if ( isset( $visited[ $field_id ] ) ) {
				return;
			}
			if ( isset( $visiting[ $field_id ] ) ) {
				throw new FormulaParseError(
					'cortext_formula_cycle',
					__( 'These formula references create a loop.', 'cortext' )
				);
			}
			$visiting[ $field_id ] = true;
			foreach ( $graph[ $field_id ] ?? array() as $dep_id ) {
				if ( (int) $dep_id === $self_field_id && $field_id !== $self_field_id ) {
					throw new FormulaParseError(
						'cortext_formula_cycle',
						__( 'These formula references create a loop.', 'cortext' )
					);
				}
				if ( isset( $graph[ (int) $dep_id ] ) ) {
					$walk( (int) $dep_id );
				}
			}
			unset( $visiting[ $field_id ] );
			$visited[ $field_id ] = true;
		};

		$walk( $self_field_id );
	}

	/**
	 * @return int[]
	 */
	private function stored_deps( int $field_id ): array {
		$raw = (string) get_post_meta( $field_id, 'formula_dep_field_ids', true );
		if ( '' === $raw ) {
			return array();
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return array();
		}
		return array_values( array_filter( array_map( 'intval', $decoded ) ) );
	}

	private function field_is_volatile( int $field_id ): bool {
		$value = get_post_meta( $field_id, 'formula_is_volatile', true );
		return true === $value || '1' === (string) $value;
	}
}
