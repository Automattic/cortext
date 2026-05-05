import { __ } from '@wordpress/i18n';
import { Button, Popover } from '@wordpress/components';
import { useMemo, useRef, useState } from '@wordpress/element';

import Chip from './fields/Chip';
import EditOptionsPopover from './fields/EditOptionsPopover';

// Multiselect cell editor: a button trigger that shows the selected
// chips, plus a controlled `Popover` hosting the unified
// `EditOptionsPopover` in pick mode. `onPick` toggles the clicked value
// in/out of the cell's array, so the popover stays open while the user
// adjusts multiple values; `onSave` fires after each toggle so the row
// meta updates incrementally (Notion-style, no Save button). Closing
// happens via the Popover's outside-click which fires `onCancel`.
//
// Replaces the previous `FormTokenField` implementation
// (tech-debt.md#6) so the cell picker matches the column-header "Edit
// options" surface: same chips, same per-option submenu, same
// search-or-create input. Uses a controlled Popover (instead of
// `Dropdown`) so the editor isn't torn down by Dropdown's outside-click
// heuristics during option mutations (create / recolor / delete) that
// cascade into a re-render of the row cell.
export default function MultiselectEdit( {
	recordId,
	value,
	elements,
	onSave,
	onOptionsSaved,
	onRowsChanged,
	onCancel,
	label,
} ) {
	const [ anchor, setAnchor ] = useState( null );
	const items = useMemo( () => elements ?? [], [ elements ] );
	const [ current, setCurrent ] = useState( () =>
		Array.isArray( value ) ? value : []
	);
	const currentRef = useRef( current );

	const handleToggle = ( optionValue ) => {
		const selected = currentRef.current;
		const next = selected.includes( optionValue )
			? selected.filter( ( v ) => v !== optionValue )
			: [ ...selected, optionValue ];
		currentRef.current = next;
		setCurrent( next );
		onSave( next );
	};

	const triggerContent = current.length ? (
		<span className="cortext-chips">
			{ current.map( ( v ) => {
				const element = items.find( ( e ) => e.value === v );
				return (
					<Chip
						key={ v }
						label={ element?.label ?? String( v ) }
						color={ element?.color }
					/>
				);
			} ) }
		</span>
	) : (
		<span className="cortext-select-edit__placeholder">
			{ __( 'Select…', 'cortext' ) }
		</span>
	);

	return (
		<>
			<Button
				ref={ setAnchor }
				className="cortext-multiselect-edit__toggle"
				variant="tertiary"
				aria-expanded
				aria-label={ label }
			>
				{ triggerContent }
			</Button>
			{ anchor ? (
				<Popover
					anchor={ anchor }
					placement="bottom-start"
					onClose={ onCancel }
					focusOnMount="firstElement"
				>
					<EditOptionsPopover
						recordId={ recordId }
						fieldType="multiselect"
						initialOptions={ items }
						value={ current }
						onOptionsSaved={ onOptionsSaved }
						onRowsChanged={ onRowsChanged }
						onPick={ handleToggle }
					/>
				</Popover>
			) : null }
		</>
	);
}
