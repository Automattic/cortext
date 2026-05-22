import { __ } from '@wordpress/i18n';
import * as icons from '@wordpress/icons';
import { Button, SearchControl } from '@wordpress/components';
import { useMemo, useState } from '@wordpress/element';

import './IconLibraryPicker.scss';

import { ICON_COLORS as NAMED_ICON_COLORS } from './iconColors';

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

// Picker palette: the shared named colors plus a `default` entry that maps
// to `currentColor` so the icon picks up the surrounding text color (works
// in light and dark without extra tokens). PHP sanitize accepts the named
// values; `default` is represented as the absence of a stored color.
const ICON_COLORS = [
	{ name: 'default', label: __( 'Default', 'cortext' ), css: 'currentColor' },
	...NAMED_ICON_COLORS,
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
