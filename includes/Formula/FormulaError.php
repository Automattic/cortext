<?php
/**
 * Base class for formula parser and evaluator errors.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

use RuntimeException;

abstract class FormulaError extends RuntimeException {

	private string $formula_code;

	public function __construct( string $formula_code, string $message ) {
		parent::__construct( $message );
		$this->formula_code = $formula_code;
	}

	public function formula_code(): string {
		return $this->formula_code;
	}
}
