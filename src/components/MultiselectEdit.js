import { __ } from '@wordpress/i18n';
import { Button, Dropdown, FormTokenField } from '@wordpress/components';
import { useMemo, useState } from '@wordpress/element';

// tech-debt.md#6: DataViews v6 ships no `multiselect` dataform-control,
// so this component fills the gap with FormTokenField. Once upstream
// adds one, this file collapses to a thin wrapper or disappears.
//
// FormTokenField speaks in labels but our row meta stores raw values.
// Keep two parallel maps and translate at the boundaries.
//
// `label` is intentionally not forwarded to FormTokenField: the prop
// always renders a visible <label> regardless of hideLabelFromVision
// (same upstream quirk as tech-debt.md#8 for CheckboxControl), and the
// DataViews column header already announces the field.
export default function MultiselectEdit( {
	value,
	elements,
	onSave,
	onCancel,
	label,
} ) {
	const valueToLabel = useMemo( () => {
		const map = new Map();
		( elements ?? [] ).forEach( ( e ) => map.set( e.value, e.label ) );
		return map;
	}, [ elements ] );

	const labelToValue = useMemo( () => {
		const map = new Map();
		( elements ?? [] ).forEach( ( e ) => map.set( e.label, e.value ) );
		return map;
	}, [ elements ] );

	const [ tokens, setTokens ] = useState( () =>
		( value ?? [] ).map( ( v ) => valueToLabel.get( v ) ?? String( v ) )
	);

	const suggestions = useMemo(
		() => ( elements ?? [] ).map( ( e ) => e.label ),
		[ elements ]
	);

	// Persist on every change so adding or removing a token saves
	// immediately. The popover stays open while the user keeps editing;
	// closing the popover (click outside or trigger) just dismisses it.
	const handleChange = ( nextTokens ) => {
		setTokens( nextTokens );
		const nextValues = nextTokens
			.map( ( token ) => labelToValue.get( token ) ?? token )
			.filter( ( v ) => v !== '' && v !== null && v !== undefined );
		onSave( nextValues );
	};

	const triggerLabel = tokens.length
		? tokens.join( ', ' )
		: __( 'Select…', 'cortext' );

	return (
		<Dropdown
			defaultOpen
			onClose={ onCancel }
			popoverProps={ { placement: 'bottom-start' } }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					className="cortext-multiselect-edit__toggle"
					variant="tertiary"
					onClick={ onToggle }
					aria-expanded={ isOpen }
					aria-label={ label }
				>
					{ triggerLabel }
				</Button>
			) }
			renderContent={ () => (
				<div className="cortext-multiselect-edit__popover">
					<FormTokenField
						value={ tokens }
						suggestions={ suggestions }
						onChange={ handleChange }
						label=""
						__experimentalExpandOnFocus
						__experimentalShowHowTo={ false }
						__nextHasNoMarginBottom
					/>
				</div>
			) }
		/>
	);
}
