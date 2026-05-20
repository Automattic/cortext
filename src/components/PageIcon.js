import { useEntityRecord } from '@wordpress/core-data';
import { Icon, page as pageGlyph } from '@wordpress/icons';
import { lazy, Suspense, useMemo } from '@wordpress/element';

// PageIconWp does `import * as icons from '@wordpress/icons'` so it can look
// glyphs up by name at runtime. That defeats tree-shaking and would pull the
// entire icon set (~238 KiB) into the initial bundle. Lazy-load it: most
// page icons are emoji/image, and pages that do use a wp glyph only trigger
// the chunk download on first render.
const PageIconWp = lazy( () =>
	import( /* webpackChunkName: "page-icon-wp" */ './PageIconWp' )
);

// Three shapes are persisted in the cortext_document_icon meta:
//   { type: 'emoji', value: '📘' }
//   { type: 'image', id: 123 }
//   { type: 'wp', name: 'home', color?: 'red' }
// Anything else (empty meta, parse error) falls through to the page glyph.
const WP_ICON_COLORS = {
	gray: '#9ca3af',
	brown: '#92400e',
	orange: '#f97316',
	yellow: '#eab308',
	green: '#22c55e',
	blue: '#3b82f6',
	purple: '#a855f7',
	pink: '#ec4899',
	red: '#ef4444',
};

export function parsePageIcon( raw ) {
	if ( ! raw ) {
		return null;
	}

	try {
		const decoded = JSON.parse( raw );
		if (
			decoded?.type === 'emoji' &&
			typeof decoded.value === 'string' &&
			decoded.value !== ''
		) {
			return { type: 'emoji', value: decoded.value };
		}
		if (
			decoded?.type === 'image' &&
			Number.isInteger( decoded.id ) &&
			decoded.id > 0
		) {
			return { type: 'image', id: decoded.id };
		}
		if (
			decoded?.type === 'wp' &&
			typeof decoded.name === 'string' &&
			decoded.name !== ''
		) {
			const color =
				typeof decoded.color === 'string' &&
				WP_ICON_COLORS[ decoded.color ]
					? decoded.color
					: null;
			return { type: 'wp', name: decoded.name, color };
		}
	} catch {
		// Malformed meta is treated as no icon; the surface picks its fallback.
	}

	return null;
}

function ImageIcon( { id, size, alt, className } ) {
	const { record } = useEntityRecord( 'root', 'media', id );
	const src =
		record?.media_details?.sizes?.thumbnail?.source_url ??
		record?.source_url ??
		null;
	const classes = [ 'cortext-document-icon' ];
	if ( className ) {
		classes.push( className );
	}

	if ( ! src ) {
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--image-loading' )
					.join( ' ' ) }
				style={ { width: size, height: size } }
				aria-hidden="true"
			/>
		);
	}

	return (
		<img
			className={ classes
				.concat( 'cortext-document-icon--image' )
				.join( ' ' ) }
			src={ src }
			alt={ alt ?? '' }
			width={ size }
			height={ size }
			loading="lazy"
			decoding="async"
		/>
	);
}

export default function PageIcon( { icon, size = 16, alt, className } ) {
	const parsed = useMemo( () => parsePageIcon( icon ), [ icon ] );
	const classes = [ 'cortext-document-icon' ];
	// `display: inline-flex` is the load-bearing bit: spans are inline by
	// default, so width/height get ignored and the emoji variant ends up
	// sized by `font-size * line-height` — taller than the SVG-based
	// variants. inline-flex makes the dimensions effective and centers
	// whatever's inside, so swapping between emoji, wp icon, and image
	// keeps the icon block the exact same height.
	const boxStyle = {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: size,
		height: size,
		lineHeight: 1,
	};
	if ( className ) {
		classes.push( className );
	}

	if ( ! parsed ) {
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--fallback' )
					.join( ' ' ) }
				style={ boxStyle }
				aria-hidden="true"
			>
				<Icon icon={ pageGlyph } size={ size } />
			</span>
		);
	}

	if ( parsed.type === 'emoji' ) {
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--emoji' )
					.join( ' ' ) }
				style={ { ...boxStyle, fontSize: size } }
				aria-hidden={ alt ? undefined : 'true' }
				role={ alt ? 'img' : undefined }
				aria-label={ alt }
			>
				{ parsed.value }
			</span>
		);
	}

	if ( parsed.type === 'wp' ) {
		const colorStyle = parsed.color
			? { color: WP_ICON_COLORS[ parsed.color ] }
			: undefined;
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--wp' )
					.join( ' ' ) }
				style={ { ...boxStyle, ...colorStyle } }
				aria-hidden={ alt ? undefined : 'true' }
				role={ alt ? 'img' : undefined }
				aria-label={ alt }
			>
				<Suspense
					fallback={ <Icon icon={ pageGlyph } size={ size } /> }
				>
					<PageIconWp name={ parsed.name } size={ size } />
				</Suspense>
			</span>
		);
	}

	return (
		<ImageIcon
			id={ parsed.id }
			size={ size }
			alt={ alt }
			className={ className }
		/>
	);
}
