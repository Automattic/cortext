<?php
/**
 * Title: Cortext Header
 * Slug: cortext/header
 * Categories: cortext, header
 * Description: Minimal site header matching the Cortext shell. Colors come from the Cortext token contract so the header tracks the workspace look on the admin canvas and the public frontend.
 *
 * @package Cortext
 */

?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="background: var(--cortext-color-surface); color: var(--cortext-color-text); border-bottom: var(--cortext-border-width) solid var(--cortext-color-border); padding: var(--cortext-space-md) var(--cortext-space-lg);">

	<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"}} -->
	<div class="wp-block-group">

		<!-- wp:site-title {"level":0,"style":{"typography":{"fontSize":"var(--cortext-font-size-ui)","fontWeight":"600"}}} /-->

		<!-- wp:navigation {"overlayMenu":"never","style":{"typography":{"fontSize":"var(--cortext-font-size-ui)"}}} /-->

	</div>
	<!-- /wp:group -->

</div>
<!-- /wp:group -->
