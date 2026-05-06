import { __ } from '@wordpress/i18n';
import { Icon, MenuGroup, MenuItem, TextControl } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { check, trash } from '@wordpress/icons';

import {
	OPTION_COLOR_NAMES,
	optionColorVars,
	resolveDisplayColor,
} from './optionPalette';

const DEFAULT_COLOR = 'default';

function colorLabel( name ) {
	switch ( name ) {
		case 'default':
			return __( 'Default', 'cortext' );
		case 'gray':
			return __( 'Gray', 'cortext' );
		case 'brown':
			return __( 'Brown', 'cortext' );
		case 'orange':
			return __( 'Orange', 'cortext' );
		case 'yellow':
			return __( 'Yellow', 'cortext' );
		case 'green':
			return __( 'Green', 'cortext' );
		case 'blue':
			return __( 'Blue', 'cortext' );
		case 'purple':
			return __( 'Purple', 'cortext' );
		case 'pink':
			return __( 'Pink', 'cortext' );
		case 'red':
			return __( 'Red', 'cortext' );
		default:
			return name;
	}
}

// Small filled square shown next to each color in the menu and as the
// option's color preview. The "default" name renders as the no-color
// indicator (slash) so users can opt out of color without dropping the
// option.
export function SwatchSquare( { color } ) {
	if ( ! color || color === DEFAULT_COLOR ) {
		return (
			<span className="cortext-edit-options-popover__swatch-square cortext-edit-options-popover__swatch-square--default" />
		);
	}
	const vars = optionColorVars( color );
	return (
		<span
			className="cortext-edit-options-popover__swatch-square"
			style={ { backgroundColor: vars?.background } }
		/>
	);
}

// Per-option config menu, modeled on Notion's "..." popover: rename
// input at the top, Delete, then a vertical list of named colors with a
// check on the active one. Owns its own draft label state so typing
// doesn't fire saves on every keystroke; commits on Enter or blur. Used
// by both `EditOptionsPopover` (column-header surface) and the
// cell-picker editors so editing chips works the same in either place.
export default function OptionMenu( {
	option,
	onLabelChange,
	onColorChange,
	onDelete,
	onClose,
} ) {
	// Use the same resolver the chip renderer uses so the check appears
	// next to the color the user actually sees on the chip — including
	// the hash fallback for legacy options that were saved without a
	// stored color.
	const current = resolveDisplayColor( option.color, option.label );
	const [ draftLabel, setDraftLabel ] = useState( option.label );
	const renameRef = useRef( null );

	useEffect( () => {
		setDraftLabel( option.label );
	}, [ option.label ] );

	// Focus the rename input when the menu opens so the user can start
	// typing immediately. Imperative focus avoids the `autoFocus` lint
	// warning while preserving the same affordance.
	useEffect( () => {
		const input = renameRef.current?.querySelector( 'input' );
		input?.focus();
		input?.select();
	}, [] );

	const commitLabel = () => {
		const next = draftLabel.trim();
		if ( ! next || next === option.label ) {
			setDraftLabel( option.label );
			return;
		}
		onLabelChange( next );
	};

	return (
		<div className="cortext-edit-options-popover__menu">
			<div
				className="cortext-edit-options-popover__menu-rename"
				ref={ renameRef }
			>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					hideLabelFromVision
					label={ __( 'Option label', 'cortext' ) }
					value={ draftLabel }
					onChange={ setDraftLabel }
					onBlur={ commitLabel }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' ) {
							event.preventDefault();
							commitLabel();
							onClose();
						}
						if ( event.key === 'Escape' ) {
							setDraftLabel( option.label );
							onClose();
						}
					} }
				/>
			</div>
			<MenuGroup>
				<MenuItem
					icon={ trash }
					isDestructive
					onClick={ () => {
						onClose();
						onDelete();
					} }
				>
					{ __( 'Delete', 'cortext' ) }
				</MenuItem>
			</MenuGroup>
			<div className="cortext-option-menu__colors">
				<div
					className="cortext-option-menu__colors-label"
					role="presentation"
				>
					{ __( 'Colors', 'cortext' ) }
				</div>
				<ul className="cortext-option-menu__color-list" role="menu">
					{ OPTION_COLOR_NAMES.map( ( name ) => {
						const selected = name === current;
						return (
							<li key={ name } role="none">
								<button
									type="button"
									role="menuitemradio"
									aria-checked={ selected }
									className={
										'cortext-option-menu__color-item' +
										( selected ? ' is-selected' : '' )
									}
									onClick={ () => onColorChange( name ) }
								>
									<span className="cortext-option-menu__color-check">
										{ selected ? (
											<Icon icon={ check } size={ 18 } />
										) : null }
									</span>
									<SwatchSquare color={ name } />
									<span className="cortext-option-menu__color-label">
										{ colorLabel( name ) }
									</span>
								</button>
							</li>
						);
					} ) }
				</ul>
			</div>
		</div>
	);
}
