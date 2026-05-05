// Mirrors `Cortext\OptionPalette::names()`. Stored as the option's
// `color` value; resolved at render time via the SCSS tokens defined in
// `src/styles/_tokens.scss` so chips re-skin under the editor's
// light/dark theme.
export const OPTION_COLOR_NAMES = [
	'default',
	'gray',
	'brown',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'red',
];

export function isOptionColorName( value ) {
	return typeof value === 'string' && OPTION_COLOR_NAMES.includes( value );
}

export function optionColorVars( name ) {
	if ( ! isOptionColorName( name ) ) {
		return null;
	}
	return {
		background: `var(--cortext-option-${ name }-bg)`,
		foreground: `var(--cortext-option-${ name }-fg)`,
	};
}

// Stable display fallback for chips that have no `color` stored, or
// whose stored color isn't one of our palette names (e.g. legacy hex
// values from seeds or Notion imports). Always returns either
// `'default'` (the explicit neutral opt-out) or one of the named
// palette colors, so chips always resolve through the SCSS tokens and
// re-skin under light/dark theme. Raw hex values would otherwise paint
// the same color in both themes, leaving them stuck in the wrong
// palette when the user toggles dark mode.
export function resolveDisplayColor( color, label ) {
	if ( color === 'default' ) {
		return 'default';
	}
	if ( isOptionColorName( color ) ) {
		return color;
	}
	const palette = OPTION_COLOR_NAMES.filter( ( c ) => c !== 'default' );
	const text = String( label ?? '' );
	if ( ! text ) {
		return palette[ 0 ];
	}
	let hash = 0;
	for ( let i = 0; i < text.length; i++ ) {
		// Plain modulo arithmetic; bit ops are blocked by lint and the
		// modest overflow risk doesn't matter for a stable color pick.
		hash = ( hash * 31 + text.charCodeAt( i ) ) % 2147483647;
	}
	return palette[ hash % palette.length ];
}

// Picks the next palette color for a freshly created option, mirroring
// Notion's behavior of giving each new chip a distinct hue. Ranks colors
// by how often they already appear in the option list and returns the
// least-used one, preferring earlier palette entries when tied. Skips
// `'default'` so new chips are visually distinct out of the box.
export function pickNextOptionColor( existingOptions ) {
	const palette = OPTION_COLOR_NAMES.filter( ( c ) => c !== 'default' );
	const used = new Map();
	( existingOptions ?? [] ).forEach( ( o ) => {
		if ( o?.color && o.color !== 'default' ) {
			used.set( o.color, ( used.get( o.color ) ?? 0 ) + 1 );
		}
	} );
	let best = palette[ 0 ];
	let bestCount = used.get( best ) ?? Infinity;
	for ( const name of palette ) {
		const count = used.get( name ) ?? 0;
		if ( count < bestCount ) {
			best = name;
			bestCount = count;
		}
	}
	return best;
}
