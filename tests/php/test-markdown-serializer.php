<?php
/**
 * Tests for Cortext\Abilities\MarkdownSerializer.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Abilities\MarkdownSerializer;
use WorDBless\BaseTestCase;

final class Test_Markdown_Serializer extends BaseTestCase {

	private function markdown( string $content ): string {
		return ( new MarkdownSerializer() )->serialize( $content );
	}

	public function test_headings_keep_their_level(): void {
		$content = '<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">Plan</h1><!-- /wp:heading -->'
			. '<!-- wp:heading --><h2 class="wp-block-heading">Goals</h2><!-- /wp:heading -->'
			. '<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Q3 &amp; Q4</h3><!-- /wp:heading -->';

		$this->assertSame( "# Plan\n\n## Goals\n\n### Q3 & Q4", $this->markdown( $content ) );
	}

	public function test_paragraph_inline_formatting(): void {
		$content = '<!-- wp:paragraph --><p>Read <a href="https://example.com/a b">the <strong>full</strong> guide</a>, '
			. '<em>then</em> run <code>npm *test*</code>, <s>not</s> 2*3.<br>Next line &lt;ok&gt;</p><!-- /wp:paragraph -->';

		$this->assertSame(
			"Read [the **full** guide](https://example.com/a%20b), *then* run `npm *test*`, ~~not~~ 2\\*3.\\\nNext line <ok>",
			$this->markdown( $content )
		);
	}

	public function test_emphasis_keeps_spaces_outside_the_markers(): void {
		$content = '<!-- wp:paragraph --><p>a<strong> bold </strong>word</p><!-- /wp:paragraph -->';

		$this->assertSame( 'a **bold** word', $this->markdown( $content ) );
	}

	public function test_nested_lists_from_list_item_blocks(): void {
		$content = '<!-- wp:list --><ul class="wp-block-list">'
			. '<!-- wp:list-item --><li>One<!-- wp:list {"ordered":true} --><ol class="wp-block-list">'
			. '<!-- wp:list-item --><li>First</li><!-- /wp:list-item -->'
			. '<!-- wp:list-item --><li>Second</li><!-- /wp:list-item -->'
			. '</ol><!-- /wp:list --></li><!-- /wp:list-item -->'
			. '<!-- wp:list-item --><li><a href="https://example.com">Two</a></li><!-- /wp:list-item -->'
			. '</ul><!-- /wp:list -->';

		$this->assertSame( "- One\n  1. First\n  2. Second\n- [Two](https://example.com)", $this->markdown( $content ) );
	}

	public function test_list_saved_as_plain_html_with_start(): void {
		$content = '<!-- wp:list {"ordered":true,"start":3} --><ol start="3" class="wp-block-list"><li>Three</li><li>Four</li></ol><!-- /wp:list -->';

		$this->assertSame( "3. Three\n4. Four", $this->markdown( $content ) );
	}

	public function test_quotes_with_inner_blocks_and_plain_html(): void {
		$content = '<!-- wp:quote --><blockquote class="wp-block-quote">'
			. '<!-- wp:paragraph --><p>Ship it.</p><!-- /wp:paragraph -->'
			. '<!-- wp:paragraph --><p>Then rest.</p><!-- /wp:paragraph -->'
			. '<cite>Ana</cite></blockquote><!-- /wp:quote -->'
			. '<!-- wp:quote --><blockquote class="wp-block-quote"><p>Old quote</p></blockquote><!-- /wp:quote -->';

		$this->assertSame( "> Ship it.\n>\n> Then rest.\n>\n> Ana\n\n> Old quote", $this->markdown( $content ) );
	}

	public function test_code_preformatted_and_separator(): void {
		$content = '<!-- wp:code --><pre class="wp-block-code"><code>if ( $a &lt; 1 ) {' . "\n" . '	return ```;' . "\n" . '}</code></pre><!-- /wp:code -->'
			. '<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->'
			. '<!-- wp:preformatted --><pre class="wp-block-preformatted">line one<br>line two</pre><!-- /wp:preformatted -->';

		$this->assertSame(
			"````\nif ( \$a < 1 ) {\n\treturn ```;\n}\n````\n\n---\n\n```\nline one\nline two\n```",
			$this->markdown( $content )
		);
	}

	public function test_image_with_caption(): void {
		$content = '<!-- wp:image {"id":5} --><figure class="wp-block-image"><img src="https://example.com/cat.png" alt="A cat" class="wp-image-5"/>'
			. '<figcaption class="wp-element-caption">Our cat</figcaption></figure><!-- /wp:image -->';

		$this->assertSame( "![A cat](https://example.com/cat.png)\n\nOur cat", $this->markdown( $content ) );
	}

	public function test_table(): void {
		$content = '<!-- wp:table --><figure class="wp-block-table"><table><thead><tr><th>Name</th><th>Notes</th></tr></thead>'
			. '<tbody><tr><td><strong>Ana</strong></td><td>a | b<br>c</td></tr><tr><td>Luis</td></tr></tbody></table></figure><!-- /wp:table -->';

		$this->assertSame(
			"| Name | Notes |\n| --- | --- |\n| **Ana** | a \\| b<br>c |\n| Luis |  |",
			$this->markdown( $content )
		);
	}

	public function test_containers_keep_their_text_and_inner_blocks(): void {
		$content = '<!-- wp:details --><details class="wp-block-details"><summary>More</summary>'
			. '<!-- wp:paragraph --><p>Hidden</p><!-- /wp:paragraph --></details><!-- /wp:details -->'
			. '<!-- wp:group --><div class="wp-block-group"><!-- wp:heading --><h2 class="wp-block-heading">Inside</h2><!-- /wp:heading --></div><!-- /wp:group -->';

		$this->assertSame( "More\n\nHidden\n\n## Inside", $this->markdown( $content ) );
	}

	public function test_unknown_blocks_keep_their_text(): void {
		$content = '<!-- wp:acme/callout --><div class="callout"><span>Heads up</span></div><!-- /wp:acme/callout -->'
			. "\n\nLoose <b>classic</b> text\n\n"
			. '<!-- wp:latest-posts /-->';

		$this->assertSame( "Heads up\n\nLoose **classic** text", $this->markdown( $content ) );
	}

	public function test_document_frame_blocks_are_left_out(): void {
		$content = '<!-- wp:cortext/document-icon /--><!-- wp:cortext/document-cover /--><!-- wp:cortext/document-properties /-->'
			. '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$this->assertSame( 'Body', $this->markdown( $content ) );
	}

	public function test_front_matter_writes_values_as_json(): void {
		$front_matter = ( new MarkdownSerializer() )->front_matter(
			array(
				array(
					'label' => 'Status',
					'value' => 'Doing',
				),
				array(
					'label' => 'Due date',
					'value' => '2026-11-21',
				),
				array(
					'label' => 'Tags',
					'value' => array( 'Design', 'Q3' ),
				),
				array(
					'label' => 'Score',
					'value' => 4,
				),
				array(
					'label' => 'Done',
					'value' => false,
				),
				array(
					'label' => 'Owner: lead',
					'value' => 'Ana',
				),
			)
		);

		$this->assertSame(
			"---\nStatus: \"Doing\"\nDue date: \"2026-11-21\"\nTags: [\"Design\",\"Q3\"]\nScore: 4\nDone: false\n\"Owner: lead\": \"Ana\"\n---",
			$front_matter
		);
	}
}
