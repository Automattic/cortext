// Picks a readable foreground for a hex background by computing relative
// luminance. Returns null for non-hex CSS colors (named, rgb(), hsl(), …),
// where we let the inherited cell text color stand.
function foregroundFor( background ) {
	const rgb = parseHex( background );
	if ( ! rgb ) {
		return null;
	}
	const [ r, g, b ] = rgb;
	const luminance = ( 0.299 * r + 0.587 * g + 0.114 * b ) / 255;
	return luminance > 0.6 ? '#1e1e1e' : '#ffffff';
}

function parseHex( value ) {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec( value );
	if ( ! match ) {
		return null;
	}
	const raw = match[ 1 ];
	const expanded =
		raw.length === 3
			? raw
					.split( '' )
					.map( ( c ) => c + c )
					.join( '' )
			: raw;
	return [
		parseInt( expanded.slice( 0, 2 ), 16 ),
		parseInt( expanded.slice( 2, 4 ), 16 ),
		parseInt( expanded.slice( 4, 6 ), 16 ),
	];
}

export default function Chip( { label, color } ) {
	if ( ! color || typeof color !== 'string' ) {
		return (
			<span className="cortext-chip cortext-chip--neutral">
				{ label }
			</span>
		);
	}
	const background = color.trim();
	const foreground = foregroundFor( background );
	const style = { backgroundColor: background };
	if ( foreground ) {
		style.color = foreground;
	}
	return (
		<span className="cortext-chip" style={ style }>
			{ label }
		</span>
	);
}
