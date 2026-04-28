import { __ } from '@wordpress/i18n';
import { Button, FormTokenField, Flex, FlexItem } from '@wordpress/components';
import { useCallback, useMemo, useState } from '@wordpress/element';

// FormTokenField speaks in labels but our row meta stores raw values.
// Keep two parallel maps and translate at the boundaries.
export default function MultiselectEdit( {
	value,
	elements,
	onCommit,
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

	const commit = useCallback( () => {
		const nextValues = tokens
			.map( ( token ) => labelToValue.get( token ) ?? token )
			.filter( ( v ) => v !== '' && v !== null && v !== undefined );
		onCommit( nextValues );
	}, [ tokens, labelToValue, onCommit ] );

	return (
		<div className="cortext-multiselect-edit">
			<FormTokenField
				value={ tokens }
				suggestions={ suggestions }
				onChange={ setTokens }
				label={ label }
				__experimentalExpandOnFocus
				__experimentalShowHowTo={ false }
				__nextHasNoMarginBottom
				hideLabelFromVision
			/>
			<Flex justify="flex-end" gap={ 2 }>
				<FlexItem>
					<Button variant="tertiary" onClick={ onCancel }>
						{ __( 'Cancel', 'cortext' ) }
					</Button>
				</FlexItem>
				<FlexItem>
					<Button variant="primary" onClick={ commit }>
						{ __( 'Save', 'cortext' ) }
					</Button>
				</FlexItem>
			</Flex>
		</div>
	);
}
