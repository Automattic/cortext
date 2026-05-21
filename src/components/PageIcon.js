import { useEntityRecord } from '@wordpress/core-data';
import { Icon, page as pageGlyph } from '@wordpress/icons';
import { useEffect, useMemo, useState } from '@wordpress/element';

import PageIconWp from './PageIconWp';
import useDelayedFlag from '../hooks/useDelayedFlag';

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
				<PageIconWp name={ parsed.name } size={ size } />
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
