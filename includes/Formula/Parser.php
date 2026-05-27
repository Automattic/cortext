<?php
/**
 * Parses Cortext formula expressions into a small AST.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class Parser {

	/** @var array<int,array{type:string,value:mixed,pos:int}> */
	private array $tokens;

	private int $index = 0;

	/**
	 * @param array<int,array{type:string,value:mixed,pos:int}> $tokens Formula tokens.
	 */
	public function __construct( array $tokens ) {
		$this->tokens = $tokens;
	}

	/**
	 * @return array<string,mixed>
	 * @throws FormulaParseError When the expression is invalid.
	 */
	public function parse(): array {
		$node = $this->parse_expression();
		if ( 'eof' !== $this->peek()['type'] ) {
			throw new FormulaParseError(
				'cortext_formula_unexpected_token',
				__( 'Remove the extra text after the formula.', 'cortext' )
			);
		}
		return $node;
	}

	/**
	 * @return array<string,mixed>
	 */
	private function parse_expression( int $min_precedence = 0 ): array {
		$left = $this->parse_prefix();

		while ( true ) {
			$token = $this->peek();
			if ( 'operator' !== $token['type'] ) {
				break;
			}

			$operator   = (string) $token['value'];
			$precedence = $this->precedence( $operator );
			if ( $precedence < $min_precedence ) {
				break;
			}

			$this->advance();
			$right = $this->parse_expression( $precedence + 1 );
			$left  = array(
				'node'     => 'binary',
				'operator' => $operator,
				'left'     => $left,
				'right'    => $right,
			);
		}

		return $left;
	}

	/**
	 * @return array<string,mixed>
	 */
	private function parse_prefix(): array {
		$token = $this->advance();

		if ( 'number' === $token['type'] ) {
			return array(
				'node'  => 'literal',
				'type'  => 'number',
				'value' => $token['value'],
			);
		}

		if ( 'string' === $token['type'] ) {
			return array(
				'node'  => 'literal',
				'type'  => 'text',
				'value' => $token['value'],
			);
		}

		if ( 'identifier' === $token['type'] ) {
			$name  = (string) $token['value'];
			$lower = strtolower( $name );
			if ( 'true' === $lower || 'false' === $lower ) {
				return array(
					'node'  => 'literal',
					'type'  => 'checkbox',
					'value' => 'true' === $lower,
				);
			}

			if ( $this->match_punct( '(' ) ) {
				$args = array();
				if ( ! $this->check_punct( ')' ) ) {
					do {
						$args[] = $this->parse_expression();
					} while ( $this->match_punct( ',' ) );
				}
				$this->consume_punct(
					')',
					__( 'Add the closing parenthesis for this function.', 'cortext' )
				);
				return array(
					'node' => 'call',
					'name' => $lower,
					'args' => $args,
				);
			}

			throw new FormulaParseError(
				'cortext_formula_unknown_identifier',
				sprintf(
					/* translators: %s: unknown formula identifier. */
					__( 'Unknown formula name: %s', 'cortext' ),
					$name
				)
			);
		}

		if ( 'operator' === $token['type'] && '-' === $token['value'] ) {
			return array(
				'node'     => 'unary',
				'operator' => '-',
				'argument' => $this->parse_expression( 40 ),
			);
		}

		if ( 'punct' === $token['type'] && '(' === $token['value'] ) {
			$node = $this->parse_expression();
			$this->consume_punct(
				')',
				__( 'Add the closing parenthesis for this group.', 'cortext' )
			);
			return $node;
		}

		throw new FormulaParseError(
			'cortext_formula_unexpected_token',
			__( 'This formula has unexpected syntax.', 'cortext' )
		);
	}

	private function precedence( string $operator ): int {
		return match ( $operator ) {
			'=', '==', '!=', '>', '<', '>=', '<=' => 10,
			'+', '-' => 20,
			'*', '/' => 30,
			default => -1,
		};
	}

	/**
	 * @return array{type:string,value:mixed,pos:int}
	 */
	private function peek(): array {
		return $this->tokens[ $this->index ];
	}

	/**
	 * @return array{type:string,value:mixed,pos:int}
	 */
	private function advance(): array {
		return $this->tokens[ $this->index++ ];
	}

	private function match_punct( string $value ): bool {
		if ( $this->check_punct( $value ) ) {
			++$this->index;
			return true;
		}
		return false;
	}

	private function check_punct( string $value ): bool {
		$token = $this->peek();
		return 'punct' === $token['type'] && $token['value'] === $value;
	}

	private function consume_punct( string $value, string $message ): void {
		if ( ! $this->match_punct( $value ) ) {
			throw new FormulaParseError( 'cortext_formula_expected_token', $message );
		}
	}
}
