<?php
/**
 * Formula function typing and evaluation helpers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class Functions {

	/**
	 * @param array<int,array<string,mixed>> $args Resolved argument AST nodes.
	 * @return array{type:string,volatile:bool}
	 * @throws FormulaParseError When function usage is invalid.
	 */
	public static function infer( string $name, array $args ): array {
		$arity    = count( $args );
		$volatile = array_reduce(
			$args,
			static fn( bool $carry, array $arg ): bool => $carry || ! empty( $arg['volatile'] ),
			false
		);

		return match ( $name ) {
			'concat' => array(
				'type'     => self::require_min_arity( $name, $arity, 1, 'text' ),
				'volatile' => $volatile,
			),
			'length' => array(
				'type'     => self::require_types( $name, $args, array( 'text' ), 'number' ),
				'volatile' => $volatile,
			),
			'upper', 'lower' => array(
				'type'     => self::require_types( $name, $args, array( 'text' ), 'text' ),
				'volatile' => $volatile,
			),
			'contains' => array(
				'type'     => self::require_types( $name, $args, array( 'text', 'text' ), 'checkbox' ),
				'volatile' => $volatile,
			),
			'if' => self::infer_if( $args, $volatile ),
			'now' => array(
				'type'     => self::require_types( $name, $args, array(), 'datetime' ),
				'volatile' => true,
			),
			'datebetween' => array(
				'type'     => self::require_date_between( $args ),
				'volatile' => $volatile,
			),
			'formatdate' => array(
				'type'     => self::require_format_date( $args ),
				'volatile' => $volatile,
			),
			default => throw new FormulaParseError(
				'cortext_formula_unknown_function',
				sprintf(
					/* translators: %s: formula function name. */
					__( 'Unknown formula function: %s', 'cortext' ),
					$name
				)
			),
		};
	}

	/**
	 * @param array<int,array{value:mixed,type:string}> $args Runtime values.
	 * @return array{value:mixed,type:string}
	 * @throws FormulaEvalError When evaluation fails.
	 */
	public static function evaluate( string $name, array $args ): array {
		return match ( $name ) {
			'concat' => array(
				'value' => implode( '', array_map( static fn( array $arg ): string => self::to_text( $arg ), $args ) ),
				'type'  => 'text',
			),
			'length' => array(
				'value' => mb_strlen( self::to_text( $args[0] ?? array( 'value' => '' ) ), 'UTF-8' ),
				'type'  => 'number',
			),
			'upper' => array(
				'value' => strtoupper( self::to_text( $args[0] ?? array( 'value' => '' ) ) ),
				'type'  => 'text',
			),
			'lower' => array(
				'value' => strtolower( self::to_text( $args[0] ?? array( 'value' => '' ) ) ),
				'type'  => 'text',
			),
			'contains' => array(
				'value' => str_contains(
					self::to_text( $args[0] ?? array( 'value' => '' ) ),
					self::to_text( $args[1] ?? array( 'value' => '' ) )
				),
				'type'  => 'checkbox',
			),
			'if' => self::evaluate_if( $args ),
			'now' => array(
				'value' => gmdate( DATE_RFC3339 ),
				'type'  => 'datetime',
			),
			'datebetween' => array(
				'value' => self::date_between( $args ),
				'type'  => 'number',
			),
			'formatdate' => array(
				'value' => self::format_date( $args ),
				'type'  => 'text',
			),
			default => throw new FormulaEvalError(
				'cortext_formula_unknown_function',
				__( 'This formula uses an unknown function.', 'cortext' )
			),
		};
	}

	private static function require_min_arity( string $name, int $actual, int $minimum, string $return_type ): string {
		if ( $actual < $minimum ) {
			$message = 1 === $minimum
				? sprintf(
					/* translators: %s: function name. */
					__( '%s() needs at least one value.', 'cortext' ),
					$name
				)
				: sprintf(
					/* translators: 1: function name, 2: minimum value count. */
					__( '%1$s() needs at least %2$d values.', 'cortext' ),
					$name,
					$minimum
				);

			throw new FormulaParseError(
				'cortext_formula_invalid_arity',
				$message
			);
		}
		return $return_type;
	}

	/**
	 * @param array<int,array<string,mixed>> $args
	 * @param string[]                       $expected
	 */
	private static function require_types( string $name, array $args, array $expected, string $return_type ): string {
		if ( count( $args ) !== count( $expected ) ) {
			$expected_count = count( $expected );
			$message        = match ( $expected_count ) {
				0 => sprintf(
					/* translators: %s: function name. */
					__( '%s() does not take any values.', 'cortext' ),
					$name
				),
				1 => sprintf(
					/* translators: %s: function name. */
					__( '%s() needs one value.', 'cortext' ),
					$name
				),
				default => sprintf(
					/* translators: 1: function name, 2: value count. */
					__( '%1$s() needs %2$d values.', 'cortext' ),
					$name,
					$expected_count
				),
			};

			throw new FormulaParseError(
				'cortext_formula_invalid_arity',
				$message
			);
		}

		foreach ( $expected as $index => $type ) {
			if ( ! self::type_matches( (string) $args[ $index ]['type'], $type ) ) {
				throw new FormulaParseError(
					'cortext_formula_type_mismatch',
					sprintf(
						/* translators: 1: function name, 2: argument number, 3: expected type. */
						__( '%1$s() argument %2$d needs a %3$s value.', 'cortext' ),
						$name,
						$index + 1,
						$type
					)
				);
			}
		}

		return $return_type;
	}

	/**
	 * @param array<int,array<string,mixed>> $args
	 * @return array{type:string,volatile:bool}
	 */
	private static function infer_if( array $args, bool $volatile ): array {
		if ( 3 !== count( $args ) ) {
			throw new FormulaParseError(
				'cortext_formula_invalid_arity',
				__( 'if() needs condition, then, and else values.', 'cortext' )
			);
		}
		if ( ! self::type_matches( (string) $args[0]['type'], 'checkbox' ) ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'The if() condition must be true or false.', 'cortext' )
			);
		}
		if ( $args[1]['type'] !== $args[2]['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_mixed_if',
				__( 'Both if() results must use the same type in v0.', 'cortext' )
			);
		}
		return array(
			'type'     => (string) $args[1]['type'],
			'volatile' => $volatile,
		);
	}

	/**
	 * @param array<int,array<string,mixed>> $args
	 */
	private static function require_date_between( array $args ): string {
		if ( 3 !== count( $args ) ) {
			throw new FormulaParseError(
				'cortext_formula_invalid_arity',
				__( 'dateBetween() needs two dates and a unit.', 'cortext' )
			);
		}
		if ( ! self::type_matches( (string) $args[0]['type'], 'date' ) || ! self::type_matches( (string) $args[1]['type'], 'date' ) ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'dateBetween() needs two dates.', 'cortext' )
			);
		}
		if ( 'text' !== $args[2]['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'The dateBetween() unit must be text, like "days".', 'cortext' )
			);
		}
		return 'number';
	}

	/**
	 * @param array<int,array<string,mixed>> $args
	 */
	private static function require_format_date( array $args ): string {
		if ( 2 !== count( $args ) ) {
			throw new FormulaParseError(
				'cortext_formula_invalid_arity',
				__( 'formatDate() needs a date and a format.', 'cortext' )
			);
		}
		if ( ! self::type_matches( (string) $args[0]['type'], 'date' ) || 'text' !== $args[1]['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_type_mismatch',
				__( 'formatDate() needs a date and a text format.', 'cortext' )
			);
		}
		return 'text';
	}

	private static function type_matches( string $actual, string $expected ): bool {
		if ( $actual === $expected ) {
			return true;
		}
		return 'date' === $expected && in_array( $actual, array( 'date', 'datetime' ), true );
	}

	/**
	 * @param array{value:mixed,type?:string} $arg
	 */
	private static function to_text( array $arg ): string {
		$value = $arg['value'] ?? '';
		if ( null === $value ) {
			return '';
		}
		if ( is_bool( $value ) ) {
			return $value ? 'true' : 'false';
		}
		return (string) $value;
	}

	/**
	 * @param array<int,array{value:mixed,type:string}> $args
	 * @return array{value:mixed,type:string}
	 */
	private static function evaluate_if( array $args ): array {
		$condition = ! empty( $args[0]['value'] );
		return $condition ? $args[1] : $args[2];
	}

	/**
	 * @param array<int,array{value:mixed,type:string}> $args
	 */
	private static function date_between( array $args ): ?float {
		$a = strtotime( (string) ( $args[0]['value'] ?? '' ) );
		$b = strtotime( (string) ( $args[1]['value'] ?? '' ) );
		if ( false === $a || false === $b ) {
			return null;
		}
		$unit    = strtolower( trim( (string) ( $args[2]['value'] ?? 'days' ) ) );
		$seconds = $a - $b;
		if ( in_array( $unit, array( 'months', 'month', 'years', 'year' ), true ) ) {
			return self::calendar_date_difference( $a, $b, $unit );
		}
		return match ( $unit ) {
			'minutes', 'minute' => floor( $seconds / MINUTE_IN_SECONDS ),
			'hours', 'hour' => floor( $seconds / HOUR_IN_SECONDS ),
			'weeks', 'week' => floor( $seconds / WEEK_IN_SECONDS ),
			default => floor( $seconds / DAY_IN_SECONDS ),
		};
	}

	private static function calendar_date_difference( int $a, int $b, string $unit ): int {
		$sign  = $a >= $b ? 1 : -1;
		$start = ( new \DateTimeImmutable( '@' . min( $a, $b ) ) )->setTimezone( new \DateTimeZone( 'UTC' ) );
		$end   = ( new \DateTimeImmutable( '@' . max( $a, $b ) ) )->setTimezone( new \DateTimeZone( 'UTC' ) );
		$diff  = $start->diff( $end );

		$months = ( $diff->y * 12 ) + $diff->m;
		if ( in_array( $unit, array( 'years', 'year' ), true ) ) {
			return $sign * $diff->y;
		}
		return $sign * $months;
	}

	/**
	 * @param array<int,array{value:mixed,type:string}> $args
	 */
	private static function format_date( array $args ): string {
		$timestamp = strtotime( (string) ( $args[0]['value'] ?? '' ) );
		if ( false === $timestamp ) {
			return '';
		}
		$format     = (string) ( $args[1]['value'] ?? 'YYYY-MM-DD' );
		$php_format = strtr(
			$format,
			array(
				'YYYY' => 'Y',
				'MMMM' => 'F',
				'MMM'  => 'M',
				'MM'   => 'm',
				'DD'   => 'd',
				'mm'   => 'i',
				'h'    => 'g',
				'A'    => 'A',
				'D'    => 'j',
				'Y'    => 'Y',
			)
		);
		return wp_date( $php_format, $timestamp );
	}
}
