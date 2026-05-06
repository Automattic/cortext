// Parses stored option records into the DataViews `elements` shape.
// Accepts a string shorthand (`'red'` becomes `{ value: 'red', label: 'red' }`)
// or `{ value, label, color? }`. `color` is an optional palette name (or
// legacy CSS color) the chip renderer reads -- tech-debt.md#11: DataViews's
// `Option` type doesn't declare `color`, but it tolerates extra keys on
// element entries.
//
// Lives in a leaf module (no JS imports beyond plain helpers) so it can
// be pulled into both UI code and Jest-only code paths without dragging
// `@wordpress/components` along.
export function elementsFromOptions( raw ) {
	if ( ! raw ) {
		return undefined;
	}
	let options;
	try {
		options = typeof raw === 'string' ? JSON.parse( raw ) : raw;
	} catch {
		return undefined;
	}
	if ( ! Array.isArray( options ) ) {
		return undefined;
	}
	return options.map( ( option ) => {
		if ( typeof option === 'string' ) {
			return { value: option, label: option };
		}
		const value = option.value ?? '';
		const label = option.label ?? option.value ?? '';
		const element = { value, label };
		if ( option.color ) {
			element.color = option.color;
		}
		return element;
	} );
}
