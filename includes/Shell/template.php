<?php
/**
 * Full-page template for the Cortext shell.
 *
 * @package Cortext
 */

defined( 'ABSPATH' ) || exit;

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title><?php esc_html_e( 'Cortext', 'cortext' ); ?></title>
	<?php wp_head(); ?>
</head>
<body class="cortext-shell-body">
	<div id="cortext-root" class="cortext-root"></div>
	<?php wp_footer(); ?>
</body>
</html>
