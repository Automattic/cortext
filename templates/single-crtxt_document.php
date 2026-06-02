<?php
/**
 * Minimal template for public-facing Cortext pages.
 *
 * Plugin-owned so it works regardless of the active theme.
 * `the_content()` triggers `do_blocks()`, rendering any Cortext
 * blocks (and core blocks) embedded in the page.
 *
 * @package Cortext
 */

defined( 'ABSPATH' ) || exit;

?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'cortext-public-page' ); ?>>
<?php wp_body_open(); ?>

<main class="cortext-public-page__content">
	<?php
	while ( have_posts() ) :
		the_post();
		?>
		<article id="post-<?php the_ID(); ?>">
			<?php
			// The title comes from the locked `core/post-title` block that
			// `DocumentIdentity::prepend_header_blocks` keeps at the top of
			// `post_content`, so `the_content()` renders it. The template
			// adds no separate `the_title()`; that would print it twice.
			?>
			<div class="cortext-public-page__body is-layout-constrained">
				<?php the_content(); ?>
			</div>
		</article>
		<?php
	endwhile;
	?>
</main>

<?php wp_footer(); ?>
</body>
</html>
