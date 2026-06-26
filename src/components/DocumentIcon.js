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

// DocumentIconWp imports the full @wordpress/icons namespace so it can resolve
// a glyph by saved name. Keep that out of the main bundle: most document icons
// are emoji or images, and WP glyphs can pay the lazy-load cost when needed.
const DocumentIconWp = lazy( () =>
	import(
		/* webpackChunkName: "document-icon-wp-admin" */ './DocumentIconWp'
	)
);
const DEFAULT_DOCUMENT_ICON_SIZE = 16;
const EMOJI_VISUAL_SCALE = 0.875;
const GLYPH_VISUAL_SCALE = 1.4;

// cortext_document_icon stores one of three shapes:
//   { type: 'emoji', value: '📘' }
//   { type: 'image', id: 123 }
//   { type: 'wp', name: 'home', color?: 'red' }
// Empty or invalid meta falls back to the page glyph.

export function parseDocumentIcon( raw ) {
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
		// Bad meta should not break the row; render the fallback instead.
	}

	return null;
}

function ImageIcon( { id, size, alt, className } ) {
	const { record } = useEntityRecord( 'root', 'media', id );
	const src =
		record?.media_details?.sizes?.thumbnail?.source_url ??
		record?.source_url ??
		null;
	// Keep the swatch until the browser has painted the image. REST can return
	// a URL before the bytes are ready, which otherwise leaves an empty slot.
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
					// Failed images should not leave the loading swatch running
					// forever. Let the browser show its normal broken-image UI.
					onError={ () => setHasImagePainted( true ) }
					style={ { opacity: hasImagePainted ? 1 : 0 } }
				/>
			) }
		</span>
	);
}

export default function DocumentIcon( {
	icon,
	size = DEFAULT_DOCUMENT_ICON_SIZE,
	alt,
	className,
} ) {
	const parsed = useMemo( () => parseDocumentIcon( icon ), [ icon ] );
	const classes = [ 'cortext-document-icon' ];
	const numericSize = typeof size === 'number' ? size : parseFloat( size );
	const hasNumericSize = Number.isFinite( numericSize );
	const emojiSize = hasNumericSize
		? Math.max( Math.round( numericSize * EMOJI_VISUAL_SCALE ), 1 )
		: size;
	const glyphSize = hasNumericSize
		? Math.round( numericSize * GLYPH_VISUAL_SCALE )
		: size;
	// Spans are inline by default, so width/height would be ignored and emoji
	// would end up taller than SVG icons. inline-flex makes the slot size real
	// and keeps emoji, WP glyphs, images, and the fallback aligned.
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
		'--cortext-document-icon-glyph-size':
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
