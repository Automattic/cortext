<?php
/**
 * Title: Cortext Footer
 * Slug: cortext/footer
 * Categories: cortext, footer
 * Description: Minimal site footer matching the Cortext shell. Colors come from the Cortext token contract so the footer tracks the workspace look on the admin canvas and the public frontend.
 *
 * @package Cortext
 */

?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="background: var(--cortext-color-surface); color: var(--cortext-color-text-muted); border-top: var(--cortext-border-width) solid var(--cortext-color-border); padding: var(--cortext-space-lg);">

	<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"var(--cortext-font-size-ui)"}}} -->
	<p class="has-text-align-center" style="font-size: var(--cortext-font-size-ui);"><?php esc_html_e( 'Built with Cortext.', 'cortext' ); ?></p>
	<!-- /wp:paragraph -->

</div>
<!-- /wp:group -->
