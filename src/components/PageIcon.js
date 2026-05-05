import { useEntityRecord } from '@wordpress/core-data';
import { Icon, page as pageGlyph } from '@wordpress/icons';
import { useMemo } from '@wordpress/element';

// Two shapes are persisted in the cortext_page_icon meta:
//   { type: 'emoji', value: '📘' }
//   { type: 'image', id: 123 }
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
	} catch {
		// Malformed meta is treated as no icon; the surface picks its fallback.
	}

	return null;
}

function ImageIcon( { id, size, alt } ) {
	const { record } = useEntityRecord( 'root', 'media', id );
	const src =
		record?.media_details?.sizes?.thumbnail?.source_url ??
		record?.source_url ??
		null;

	if ( ! src ) {
		return (
			<span
				className="cortext-page-icon cortext-page-icon--image-loading"
				style={ { width: size, height: size } }
				aria-hidden="true"
			/>
		);
	}

	return (
		<img
			className="cortext-page-icon cortext-page-icon--image"
			src={ src }
			alt={ alt ?? '' }
			width={ size }
			height={ size }
		/>
	);
}

export default function PageIcon( { icon, size = 16, alt, className } ) {
	const parsed = useMemo( () => parsePageIcon( icon ), [ icon ] );
	const classes = [ 'cortext-page-icon' ];
	if ( className ) {
		classes.push( className );
	}

	if ( ! parsed ) {
		return (
			<span
				className={ classes
					.concat( 'cortext-page-icon--fallback' )
					.join( ' ' ) }
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
					.concat( 'cortext-page-icon--emoji' )
					.join( ' ' ) }
				style={ { fontSize: size } }
				aria-hidden={ alt ? undefined : 'true' }
				role={ alt ? 'img' : undefined }
				aria-label={ alt }
			>
				{ parsed.value }
			</span>
		);
	}

	return <ImageIcon id={ parsed.id } size={ size } alt={ alt } />;
}
