<?php
/**
 * Tokenizes Cortext formula expressions.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class Lexer {

	private const MAX_EXPRESSION_LENGTH = 4096;
	private const MAX_STRING_LENGTH     = 1024;
	private const MAX_TOKENS            = 512;

	/**
	 * @return array<int,array{type:string,value:mixed,pos:int}>
	 * @throws FormulaParseError When the expression contains invalid syntax.
	 */
	public function tokenize( string $expression ): array {
		$tokens = array();
		$length = strlen( $expression );
		$i      = 0;

		if ( $length > self::MAX_EXPRESSION_LENGTH ) {
			throw new FormulaParseError(
				'cortext_formula_too_long',
				__( 'This formula is too long.', 'cortext' )
			);
		}

		while ( $i < $length ) {
			$char = $expression[ $i ];
			if ( ctype_space( $char ) ) {
				++$i;
				continue;
			}

			if ( ctype_digit( $char ) || ( '.' === $char && $i + 1 < $length && ctype_digit( $expression[ $i + 1 ] ) ) ) {
				$start    = $i;
				$seen_dot = false;
				while ( $i < $length ) {
					$current = $expression[ $i ];
					if ( '.' === $current ) {
						if ( $seen_dot ) {
							break;
						}
						$seen_dot = true;
						++$i;
						continue;
					}
					if ( ! ctype_digit( $current ) ) {
						break;
					}
					++$i;
				}
				$this->append_token(
					$tokens,
					array(
						'type'  => 'number',
						'value' => (float) substr( $expression, $start, $i - $start ),
						'pos'   => $start,
					)
				);
				continue;
			}

			if ( '"' === $char ) {
				$start = $i;
				++$i;
				$value = '';
				while ( $i < $length ) {
					$current = $expression[ $i ];
					if ( '"' === $current ) {
						++$i;
						$this->append_token(
							$tokens,
							array(
								'type'  => 'string',
								'value' => $value,
								'pos'   => $start,
							)
						);
						continue 2;
					}
					if ( '\\' === $current ) {
						++$i;
						if ( $i >= $length ) {
							break;
						}
						$escaped = $expression[ $i ];
						$value  .= match ( $escaped ) {
							'n' => "\n",
							't' => "\t",
							'"' => '"',
							'\\' => '\\',
							default => $escaped,
						};
						$this->assert_string_length( $value );
						++$i;
						continue;
					}
					$value .= $current;
					$this->assert_string_length( $value );
					++$i;
				}
				throw new FormulaParseError(
					'cortext_formula_unclosed_string',
					__( 'Text is missing a closing quote.', 'cortext' )
				);
			}

			if ( ctype_alpha( $char ) || '_' === $char ) {
				$start = $i;
				while ( $i < $length && ( ctype_alnum( $expression[ $i ] ) || '_' === $expression[ $i ] ) ) {
					++$i;
				}
				$this->append_token(
					$tokens,
					array(
						'type'  => 'identifier',
						'value' => substr( $expression, $start, $i - $start ),
						'pos'   => $start,
					)
				);
				continue;
			}

			$two = $i + 1 < $length ? substr( $expression, $i, 2 ) : '';
			if ( in_array( $two, array( '==', '!=', '>=', '<=' ), true ) ) {
				$this->append_token(
					$tokens,
					array(
						'type'  => 'operator',
						'value' => $two,
						'pos'   => $i,
					)
				);
				$i += 2;
				continue;
			}

			if ( in_array( $char, array( '+', '-', '*', '/', '=', '>', '<' ), true ) ) {
				$this->append_token(
					$tokens,
					array(
						'type'  => 'operator',
						'value' => $char,
						'pos'   => $i,
					)
				);
				++$i;
				continue;
			}

			if ( in_array( $char, array( '(', ')', ',' ), true ) ) {
				$this->append_token(
					$tokens,
					array(
						'type'  => 'punct',
						'value' => $char,
						'pos'   => $i,
					)
				);
				++$i;
				continue;
			}

			throw new FormulaParseError(
				'cortext_formula_invalid_character',
				sprintf(
					/* translators: %s: invalid formula character. */
					__( 'Formulas cannot use this character: %s', 'cortext' ),
					$char
				)
			);
		}

		$this->append_token(
			$tokens,
			array(
				'type'  => 'eof',
				'value' => null,
				'pos'   => $length,
			)
		);
		return $tokens;
	}

	/**
	 * @param array<int,array{type:string,value:mixed,pos:int}> $tokens Formula tokens.
	 * @param array{type:string,value:mixed,pos:int}            $token Token to append.
	 */
	private function append_token( array &$tokens, array $token ): void {
		$tokens[] = $token;
		if ( count( $tokens ) > self::MAX_TOKENS ) {
			throw new FormulaParseError(
				'cortext_formula_too_complex',
				__( 'This formula is too complex.', 'cortext' )
			);
		}
	}

	private function assert_string_length( string $value ): void {
		if ( strlen( $value ) > self::MAX_STRING_LENGTH ) {
			throw new FormulaParseError(
				'cortext_formula_string_too_long',
				__( 'This text value is too long.', 'cortext' )
			);
		}
	}
}
