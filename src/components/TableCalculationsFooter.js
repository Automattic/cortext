/* global MutationObserver */
import { Button, Dropdown } from '@wordpress/components';
import { createPortal, useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import TableCalculationMenu from './TableCalculationMenu';
import {
	CALCULATION_LABELS,
	calculateField,
	formatCalculationValue,
	isCalculationAvailable,
	withColumnCalculation,
} from './tableCalculations';

function useDataViewsTable( wrapperRef ) {
	const [ table, setTable ] = useState( null );

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper ) {
			return undefined;
		}

		const sync = () => {
			// tech-debt.md#td-dataviews-layout-slots: DataViews has no table footer slot, so the
			// calculation row has to attach to the table after it renders.
			setTable( wrapper.querySelector( '.dataviews-view-table' ) );
		};

		sync();
		const observer = new MutationObserver( sync );
		observer.observe( wrapper, { childList: true, subtree: true } );
		return () => observer.disconnect();
	}, [ wrapperRef ] );

	return table;
}

function CalculationCell( {
	field,
	rows,
	view,
	serverCalculations,
	isServerPaginated,
	onChangeView,
} ) {
	const emptyLabel = __( 'Calculate', 'cortext' );
	const selected = isCalculationAvailable(
		field,
		view?.calculations?.[ field.id ]
	)
		? view.calculations[ field.id ]
		: null;
	const serverCalculation = selected
		? serverCalculations?.[ field.id ]
		: null;
	const hasServerResult =
		Boolean( serverCalculation ) &&
		serverCalculation.calculation === selected;
	let result = '';
	if ( selected && hasServerResult ) {
		result = formatCalculationValue(
			serverCalculation.value,
			field,
			selected
		);
	} else if ( selected && ! isServerPaginated ) {
		// In client mode `rows` is the full filtered set, so a local
		// calculation is correct. In server mode `rows` is only the current
		// page, so wait for the server total instead of showing a page-only
		// number.
		result = calculateField( rows, field, selected );
	}
	const label = selected ? CALCULATION_LABELS[ selected ] : emptyLabel;

	const pick = ( calculation ) => {
		onChangeView( withColumnCalculation( view, field.id, calculation ) );
	};

	return (
		<Dropdown
			className="cortext-table-calculation"
			contentClassName="cortext-table-calculation-popover"
			popoverProps={ { placement: 'top-start' } }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					className={ `cortext-table-calculation__button ${
						selected ? 'has-calculation' : 'is-empty'
					}` }
					variant="tertiary"
					onClick={ onToggle }
					aria-expanded={ isOpen }
					aria-label={ selected ? undefined : emptyLabel }
					data-empty-label={ selected ? undefined : emptyLabel }
				>
					{ selected ? (
						<span className="cortext-table-calculation__label">
							{ label }
						</span>
					) : null }
					{ selected ? (
						<span className="cortext-table-calculation__result">
							{ result }
						</span>
					) : null }
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<TableCalculationMenu
					field={ field }
					selected={ selected }
					onPick={ pick }
					onClose={ onClose }
				/>
			) }
		/>
	);
}

export default function TableCalculationsFooter( {
	wrapperRef,
	view,
	fields,
	data,
	calculations,
	isServerPaginated = false,
	onChangeView,
	hasSelectionColumn = false,
	bulkActions = null,
} ) {
	const table = useDataViewsTable( wrapperRef );
	const fieldsById = useMemo(
		() => new Map( fields.map( ( field ) => [ field.id, field ] ) ),
		[ fields ]
	);
	const visibleFields = Array.isArray( view?.fields ) ? view.fields : [];
	const hasVisibleCalculation = visibleFields.some( ( fieldId ) => {
		const field = fieldsById.get( fieldId );
		return (
			field &&
			isCalculationAvailable( field, view?.calculations?.[ field.id ] )
		);
	} );
	const hasBulkActions = Boolean( bulkActions );

	if ( ! table || ( ! hasVisibleCalculation && ! hasBulkActions ) ) {
		return null;
	}

	return createPortal(
		<tfoot className="cortext-table-calculations">
			<tr>
				{ hasSelectionColumn ? (
					<td className="cortext-table-calculations__selection-spacer">
						{ bulkActions }
					</td>
				) : null }
				{ visibleFields.map( ( fieldId ) => {
					const field = fieldsById.get( fieldId );
					const style = view?.layout?.styles?.[ fieldId ] ?? {};
					return (
						<td
							key={ fieldId }
							style={ {
								width: style.width,
								maxWidth: style.maxWidth,
								minWidth: style.minWidth,
								textAlign: style.align,
							} }
						>
							{ field ? (
								<CalculationCell
									field={ field }
									rows={ data }
									view={ view }
									serverCalculations={ calculations }
									isServerPaginated={ isServerPaginated }
									onChangeView={ onChangeView }
								/>
							) : null }
						</td>
					);
				} ) }
			</tr>
		</tfoot>,
		table
	);
}
