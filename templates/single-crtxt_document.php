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
			// `the_title()` is the authoritative render; the same string also
			// resolves a second time inside `the_content()` for any page
			// whose `post_content` carries the locked `core/post-title`
			// block prepended by `DocumentIdentity::prepend_header_blocks`.
			// See tech-debt.md#td-public-title-double-render.
			?>
			<h1 class="cortext-public-page__title"><?php the_title(); ?></h1>
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
