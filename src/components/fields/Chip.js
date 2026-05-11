import { __ } from '@wordpress/i18n';

import {
	optionColorVars,
	isOptionColorName,
	resolveDisplayColor,
} from './optionPalette';

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

function RemoveButton( { onRemove, foreground } ) {
	return (
		<button
			type="button"
			className="cortext-chip__remove"
			aria-label={ __( 'Remove', 'cortext' ) }
			style={ foreground ? { color: foreground } : undefined }
			onClick={ ( event ) => {
				event.preventDefault();
				event.stopPropagation();
				onRemove();
			} }
		>
			×
		</button>
	);
}

// Two color shapes are accepted: a palette name (`'blue'`) resolved
// through the Cortext shell tokens so chips re-skin under light/dark, or
// a raw CSS color (legacy seeds or imported data). The `'default'` palette
// name renders as the neutral chip so saved options can opt out of color
// without dropping the field. When `onRemove` is provided, a `×` button
// is rendered inside the pill so dismiss controls live with the chip
// background instead of as an external sibling, so chip labels and controls
// stay together in the multiselect picker.
export default function Chip( { label, color, onRemove } ) {
	const effective = resolveDisplayColor( color, label );

	if ( effective === 'default' ) {
		return (
			<span className="cortext-chip cortext-chip--neutral">
				{ label }
				{ onRemove ? <RemoveButton onRemove={ onRemove } /> : null }
			</span>
		);
	}

	if ( isOptionColorName( effective ) ) {
		const vars = optionColorVars( effective );
		return (
			<span
				className={ `cortext-chip cortext-chip--${ effective }` }
				style={ {
					backgroundColor: vars.background,
					color: vars.foreground,
				} }
			>
				{ label }
				{ onRemove ? (
					<RemoveButton
						onRemove={ onRemove }
						foreground={ vars.foreground }
					/>
				) : null }
			</span>
		);
	}

	const background = effective.trim();
	const foreground = foregroundFor( background );
	const style = { backgroundColor: background };
	if ( foreground ) {
		style.color = foreground;
	}
	return (
		<span className="cortext-chip" style={ style }>
			{ label }
			{ onRemove ? (
				<RemoveButton onRemove={ onRemove } foreground={ foreground } />
			) : null }
		</span>
	);
}
