import { __ } from '@wordpress/i18n';
import * as icons from '@wordpress/icons';
import { Button, SearchControl } from '@wordpress/components';
import { useMemo, useState } from '@wordpress/element';

// Filter the package down to renderable icon components. `@wordpress/icons`
// exports the `Icon` wrapper alongside the actual glyphs; the wrapper is a
// function component while glyphs are JSX trees (object). We want only the
// glyphs.
const ICON_NAMES = Object.entries( icons )
	.filter(
		( [ name, value ] ) =>
			name !== 'Icon' &&
			name !== 'default' &&
			value &&
			typeof value === 'object'
	)
	.map( ( [ name ] ) => name )
	.sort();

// Notion-style palette: a fixed set of named colors so the storage stays
// validatable (PHP sanitize accepts only these names) and so the visual
// language is consistent across the editor and frontend. `default` falls
// back to currentColor, which means the icon picks up the surrounding
// text color (works in both light and dark mode without extra tokens).
const ICON_COLORS = [
	{ name: 'default', label: __( 'Default', 'cortext' ), css: 'currentColor' },
	{ name: 'gray', label: __( 'Gray', 'cortext' ), css: '#9ca3af' },
	{ name: 'brown', label: __( 'Brown', 'cortext' ), css: '#92400e' },
	{ name: 'orange', label: __( 'Orange', 'cortext' ), css: '#f97316' },
	{ name: 'yellow', label: __( 'Yellow', 'cortext' ), css: '#eab308' },
	{ name: 'green', label: __( 'Green', 'cortext' ), css: '#22c55e' },
	{ name: 'blue', label: __( 'Blue', 'cortext' ), css: '#3b82f6' },
	{ name: 'purple', label: __( 'Purple', 'cortext' ), css: '#a855f7' },
	{ name: 'pink', label: __( 'Pink', 'cortext' ), css: '#ec4899' },
	{ name: 'red', label: __( 'Red', 'cortext' ), css: '#ef4444' },
];

const HumanizeName = ( name ) =>
	name
		.replace( /([A-Z])/g, ' $1' )
		.replace( /^./, ( c ) => c.toUpperCase() )
		.trim();

export default function IconLibraryPicker( {
	onSelect,
	initialColor,
	onColorSelect,
} ) {
	const [ filter, setFilter ] = useState( '' );
	// Seed from the page's saved color so the swatches don't snap back to
	// `default` every time the popover reopens. Falls back to default
	// when the page has no wp icon yet (or the saved color is unknown).
	const seed = ICON_COLORS.some( ( c ) => c.name === initialColor )
		? initialColor
		: 'default';
	const [ activeColor, setActiveColor ] = useState( seed );

	const filtered = useMemo( () => {
		const term = filter.trim().toLowerCase();
		if ( ! term ) {
			return ICON_NAMES;
		}
		return ICON_NAMES.filter( ( name ) =>
			name.toLowerCase().includes( term )
		);
	}, [ filter ] );

	const activeCss =
		ICON_COLORS.find( ( c ) => c.name === activeColor )?.css ??
		'currentColor';

	return (
		<div className="cortext-icon-library">
			<SearchControl
				__nextHasNoMarginBottom
				value={ filter }
				onChange={ setFilter }
				placeholder={ __( 'Filter…', 'cortext' ) }
			/>
			<div
				className="cortext-icon-library__colors"
				role="radiogroup"
				aria-label={ __( 'Icon color', 'cortext' ) }
			>
				{ ICON_COLORS.map( ( color ) => (
					<button
						key={ color.name }
						type="button"
						className={
							'cortext-icon-library__swatch' +
							( activeColor === color.name ? ' is-active' : '' )
						}
						style={ { '--swatch': color.css } }
						onClick={ () => {
							setActiveColor( color.name );
							onColorSelect?.( color.name );
						} }
						aria-checked={ activeColor === color.name }
						aria-label={ color.label }
						title={ color.label }
						role="radio"
					/>
				) ) }
			</div>
			<div
				className="cortext-icon-library__grid"
				role="listbox"
				aria-label={ __( 'WordPress icons', 'cortext' ) }
				style={ { color: activeCss } }
			>
				{ filtered.map( ( name ) => {
					const Glyph = icons[ name ];
					return (
						<Button
							key={ name }
							className="cortext-icon-library__item"
							onClick={ () => onSelect( name, activeColor ) }
							aria-label={ HumanizeName( name ) }
							title={ HumanizeName( name ) }
						>
							<icons.Icon icon={ Glyph } size={ 20 } />
						</Button>
					);
				} ) }
				{ filtered.length === 0 && (
					<p className="cortext-icon-library__empty">
						{ __( 'No icons match.', 'cortext' ) }
					</p>
				) }
			</div>
		</div>
	);
}
