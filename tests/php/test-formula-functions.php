<?php
/**
 * Tests for Cortext formula evaluation helpers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Formula\Evaluator;
use Cortext\Formula\Functions;
use WorDBless\BaseTestCase;

final class Test_Formula_Functions extends BaseTestCase {

	public function test_length_counts_utf8_characters(): void {
		$result = Functions::evaluate(
			'length',
			array(
				array(
					'value' => 'café',
					'type'  => 'text',
				),
			)
		);

		$this->assertSame( 4, $result['value'] );
	}

	public function test_format_date_h_uses_twelve_hour_time(): void {
		$result = Functions::evaluate(
			'formatdate',
			array(
				array(
					'value' => '2026-05-23 14:30:00',
					'type'  => 'datetime',
				),
				array(
					'value' => 'h:mm A',
					'type'  => 'text',
				),
			)
		);

		$this->assertSame( '2:30 PM', $result['value'] );
	}

	public function test_if_only_evaluates_selected_branch(): void {
		$row = get_post(
			wp_insert_post(
				array(
					'post_type'   => 'post',
					'post_status' => 'private',
					'post_title'  => 'Formula row',
				)
			)
		);

		$evaluator = new Evaluator();
		$result    = $evaluator->evaluate(
			array(
				'node' => 'call',
				'name' => 'if',
				'type' => 'number',
				'args' => array(
					array(
						'node'  => 'literal',
						'type'  => 'checkbox',
						'value' => false,
					),
					$this->divide_by_zero_ast(),
					array(
						'node'  => 'literal',
						'type'  => 'number',
						'value' => 0,
					),
				),
			),
			$row
		);

		$this->assertSame( 0, $result['value'] );
		$this->assertSame( 'number', $result['type'] );

		$result = $evaluator->evaluate(
			array(
				'node' => 'call',
				'name' => 'if',
				'type' => 'number',
				'args' => array(
					array(
						'node'  => 'literal',
						'type'  => 'checkbox',
						'value' => true,
					),
					array(
						'node'  => 'literal',
						'type'  => 'number',
						'value' => 10,
					),
					$this->divide_by_zero_ast(),
				),
			),
			$row
		);

		$this->assertSame( 10, $result['value'] );
		$this->assertSame( 'number', $result['type'] );
	}

	/**
	 * @return array<string,mixed>
	 */
	private function divide_by_zero_ast(): array {
		return array(
			'node'     => 'binary',
			'operator' => '/',
			'type'     => 'number',
			'left'     => array(
				'node'  => 'literal',
				'type'  => 'number',
				'value' => 1,
			),
			'right'    => array(
				'node'  => 'literal',
				'type'  => 'number',
				'value' => 0,
			),
		);
	}
}
