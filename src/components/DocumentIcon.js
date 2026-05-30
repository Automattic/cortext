import { useEntityRecord } from '@wordpress/core-data';
import { Icon, page as pageGlyph } from '@wordpress/icons';
import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useState,
} from '@wordpress/element';

import './DocumentIcon.scss';

import useDelayedFlag from '../hooks/useDelayedFlag';
import { ICON_COLOR_BY_NAME } from './iconColors';

// DocumentIconWp does `import * as icons from '@wordpress/icons'` so it can look
// glyphs up by name at runtime. That defeats tree-shaking and would pull the
// entire icon set (~238 KiB) into the initial bundle. Lazy-load it: most
// document icons are emoji/image, and documents that do use a wp glyph only trigger
// the chunk download on first render.
const DocumentIconWp = lazy( () =>
	import( /* webpackChunkName: "document-icon-wp" */ './DocumentIconWp' )
);
const DEFAULT_PAGE_ICON_SIZE = 16;
const EMOJI_VISUAL_SCALE = 0.875;
const GLYPH_VISUAL_SCALE = 1.4;

// Three shapes are persisted in the cortext_document_icon meta:
//   { type: 'emoji', value: '📘' }
//   { type: 'image', id: 123 }
//   { type: 'wp', name: 'home', color?: 'red' }
// Anything else (empty meta, parse error) falls through to the page glyph.

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
				ICON_COLOR_BY_NAME[ decoded.color ]
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
	// Keep the swatch until REST has a URL and the browser has loaded it.
	// Otherwise the swatch disappears first and the icon slot looks empty
	// while the image bytes arrive.
	const [ hasImagePainted, setHasImagePainted ] = useState( false );
	useEffect( () => {
		setHasImagePainted( false );
	}, [ src ] );

	const isLoading = ! src || ! hasImagePainted;
	const showLoadingSwatch = useDelayedFlag( isLoading );
	const classes = [ 'cortext-document-icon' ];
	if ( className ) {
		classes.push( className );
	}

	const wrapperClasses = classes
		.concat( 'cortext-document-icon--image-wrap' )
		.join( ' ' );
	const swatchClasses = [
		'cortext-document-icon--image-loading',
		showLoadingSwatch && 'cortext-document-icon--image-loading-visible',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<span
			className={ wrapperClasses }
			style={ { width: size, height: size } }
		>
			{ isLoading && (
				<span className={ swatchClasses } aria-hidden="true" />
			) }
			{ src && (
				<img
					className="cortext-document-icon--image"
					src={ src }
					alt={ alt ?? '' }
					width={ size }
					height={ size }
					loading="lazy"
					decoding="async"
					onLoad={ () => setHasImagePainted( true ) }
					// Drop the swatch on a failed fetch too. Without this the
					// swatch pulses forever for 404s or deleted media; we'd
					// rather show the browser's broken-image fallback.
					onError={ () => setHasImagePainted( true ) }
					style={ { opacity: hasImagePainted ? 1 : 0 } }
				/>
			) }
		</span>
	);
}

export default function DocumentIcon( {
	icon,
	size = DEFAULT_PAGE_ICON_SIZE,
	alt,
	className,
} ) {
	const parsed = useMemo( () => parsePageIcon( icon ), [ icon ] );
	const classes = [ 'cortext-document-icon' ];
	const numericSize = typeof size === 'number' ? size : parseFloat( size );
	const hasNumericSize = Number.isFinite( numericSize );
	const emojiSize = hasNumericSize
		? Math.max( Math.round( numericSize * EMOJI_VISUAL_SCALE ), 1 )
		: size;
	const glyphSize = hasNumericSize
		? Math.round( numericSize * GLYPH_VISUAL_SCALE )
		: size;
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
	const glyphBoxStyle = {
		...boxStyle,
		'--cortext-page-icon-glyph-size':
			typeof glyphSize === 'number' ? `${ glyphSize }px` : glyphSize,
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
				style={ glyphBoxStyle }
				aria-hidden="true"
			>
				<Icon icon={ pageGlyph } size={ glyphSize } />
			</span>
		);
	}

	if ( parsed.type === 'emoji' ) {
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--emoji' )
					.join( ' ' ) }
				style={ { ...boxStyle, fontSize: emojiSize } }
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
			? { color: ICON_COLOR_BY_NAME[ parsed.color ] }
			: undefined;
		return (
			<span
				className={ classes
					.concat( 'cortext-document-icon--wp' )
					.join( ' ' ) }
				style={ { ...glyphBoxStyle, ...colorStyle } }
				aria-hidden={ alt ? undefined : 'true' }
				role={ alt ? 'img' : undefined }
				aria-label={ alt }
			>
				<Suspense
					fallback={ <Icon icon={ pageGlyph } size={ glyphSize } /> }
				>
					<DocumentIconWp name={ parsed.name } size={ glyphSize } />
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
