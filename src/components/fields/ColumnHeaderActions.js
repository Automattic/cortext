/* global MutationObserver */
import { __ } from '@wordpress/i18n';
import { Button, Dropdown, Icon } from '@wordpress/components';
import {
	createPortal,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import {
	arrowLeft,
	arrowRight,
	chevronRight,
	plus,
	unseen,
} from '@wordpress/icons';

import './ColumnHeaderActions.scss';

import AddFieldPopover from './AddFieldPopover';
import FieldActionsMenu from './FieldActionsMenu';
import { FieldTypeIcon } from './fieldTypes';
import { RowMutationContext } from '../EditableCell';
import { useMappedField } from '../CollectionFieldsContext';
import { TableCalculationPopover } from '../TableCalculationMenu';
import { GHOST_FIELD_ID, TITLE_FIELD_ID } from '../dataViewColumns';
import { withColumnCalculation } from '../tableCalculations';

// Projects Cortext controls into DataViews' table header:
//
// - `[data-cortext-field-marker="<recordId>"]` marks custom fields. We hide
//   DataViews' trigger (see `tech-debt.md#16`) and portal in one menu with
//   Sort / Move / Hide plus Rename / Duplicate / Delete. The marker is only
//   the anchor; the real button is a sibling so the column drag handle can
//   still forward clicks to it.
// - `th.dataviews-view-table__actions-column` — `+` button in the
//   row-actions column header that opens the same `AddFieldPopover`
//   as the toolbar Add field trigger. See `tech-debt.md#17`.
//
// The invisible anchor lets this component find its wrapper. A
// MutationObserver re-syncs portals after DataViews rewrites the header.
export default function ColumnHeaderActions( {
	collectionId,
	view,
	onChangeView,
	onFieldOptionsSaved,
	onFieldFormatSaved,
	onFieldCreated,
	onRowsChanged,
} ) {
	const anchorRef = useRef( null );
	const [ targets, setTargets ] = useState( [] );

	useEffect( () => {
		const anchor = anchorRef.current;
		if ( ! anchor ) {
			return undefined;
		}
		const wrapper = anchor.closest( '.cortext-data-view' );
		if ( ! wrapper ) {
			return undefined;
		}

		const sync = () => {
			const next = [];
			wrapper
				.querySelectorAll( '[data-cortext-field-marker]' )
				.forEach( ( marker ) => {
					const th = marker.closest( 'th' );
					if ( ! th ) {
						return;
					}
					const recordId = Number(
						marker.getAttribute( 'data-cortext-field-marker' )
					);
					if ( ! Number.isFinite( recordId ) || recordId <= 0 ) {
						return;
					}
					next.push( {
						key: `field-${ recordId }`,
						kind: 'field',
						recordId,
						th,
					} );
				} );
			// The add-field button lives in DataViews' actions column header.
			// Row actions keep that column rendered, so we no longer need a
			// synthetic table column for it. See `tech-debt.md#17`.
			const actionsTh = wrapper.querySelector(
				'th.dataviews-view-table__actions-column'
			);
			if ( actionsTh ) {
				next.push( {
					key: 'add-field',
					kind: 'add',
					th: actionsTh,
				} );
			}

			setTargets( ( prev ) => {
				if ( prev.length !== next.length ) {
					return next;
				}
				const same = prev.every(
					( t, i ) => t.key === next[ i ].key && t.th === next[ i ].th
				);
				return same ? prev : next;
			} );
		};

		sync();
		const observer = new MutationObserver( sync );
		observer.observe( wrapper, { childList: true, subtree: true } );
		return () => observer.disconnect();
	}, [] );

	return (
		<>
			<span
				ref={ anchorRef }
				className="cortext-column-header-actions-anchor"
				aria-hidden="true"
			/>
			{ targets.map( ( target ) => {
				if ( target.kind === 'field' ) {
					return createPortal(
						<FieldActions
							recordId={ target.recordId }
							collectionId={ collectionId }
							view={ view }
							onChangeView={ onChangeView }
							onFieldOptionsSaved={ onFieldOptionsSaved }
							onFieldFormatSaved={ onFieldFormatSaved }
							onRowsChanged={ onRowsChanged }
						/>,
						target.th,
						target.key
					);
				}
				return createPortal(
					<AddFieldTrigger
						collectionId={ collectionId }
						onFieldCreated={ onFieldCreated }
						onRowsChanged={ onRowsChanged }
					/>,
					target.th,
					`${ target.key }-${ collectionId }`
				);
			} ) }
		</>
	);
}

function FieldActions( {
	recordId,
	collectionId,
	view,
	onChangeView,
	onFieldOptionsSaved,
	onFieldFormatSaved,
	onRowsChanged,
} ) {
	const [ isCalculating, setIsCalculating ] = useState( false );
	const [ shouldFocusCalculation, setShouldFocusCalculation ] =
		useState( false );
	const calculationItemRef = useRef( null );
	const closeFieldMenuRef = useRef( null );
	const closeTimerRef = useRef( null );
	// `useCollectionFields` already fetched these records with `context: 'edit'`
	// and ran them through `mapField`. Read label/type/options from the cached
	// field so the header skips `useEntityRecord`'s `default`-context resolver
	// trip, which would otherwise flash `#${ recordId }` before the title
	// arrives. See the tech-debt note in `useCollectionFields`.
	const mappedField = useMappedField( recordId );
	const { formatOverrides } = useContext( RowMutationContext );
	const dataViewId = `field-${ recordId }`;
	const formatOverride = formatOverrides?.[ dataViewId ];
	const effectiveField = useMemo( () => {
		if ( ! mappedField || formatOverride === undefined ) {
			return mappedField;
		}
		return { ...mappedField, cortextFormat: formatOverride };
	}, [ formatOverride, mappedField ] );
	const fieldType = effectiveField?.cortextType;

	// Match the field-format submenu: leave a small grace window while the
	// pointer crosses the gap between the row and the flyout.
	const cancelClose = useCallback( () => {
		if ( closeTimerRef.current ) {
			clearTimeout( closeTimerRef.current );
			closeTimerRef.current = null;
		}
	}, [] );
	const scheduleClose = useCallback( () => {
		cancelClose();
		closeTimerRef.current = setTimeout( () => {
			setIsCalculating( false );
			setShouldFocusCalculation( false );
			closeTimerRef.current = null;
		}, 180 );
	}, [ cancelClose ] );
	const closeCalculation = useCallback( () => {
		setIsCalculating( false );
		setShouldFocusCalculation( false );
		cancelClose();
	}, [ cancelClose ] );
	const openCalculation = useCallback(
		( focus = false ) => {
			cancelClose();
			setShouldFocusCalculation( focus );
			setIsCalculating( true );
		},
		[ cancelClose ]
	);
	useEffect( () => () => cancelClose(), [ cancelClose ] );

	const openCalculationFromKeyboard = useCallback(
		( event, beforeOpen ) => {
			if (
				! [ 'ArrowRight', 'Enter', ' ', 'Spacebar' ].includes(
					event.key
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			beforeOpen?.();
			openCalculation( true );
		},
		[ openCalculation ]
	);

	const closeCalculationAndFocusTrigger = useCallback( () => {
		closeCalculation();
		window.requestAnimationFrame( () => {
			calculationItemRef.current?.focus();
		} );
	}, [ closeCalculation ] );
	const closeFieldMenu = useCallback( () => {
		if ( closeFieldMenuRef.current ) {
			closeFieldMenuRef.current();
			return;
		}
		closeCalculation();
	}, [ closeCalculation ] );

	const label = effectiveField?.label || `#${ recordId }`;
	const calculationField = useMemo(
		() => ( {
			id: dataViewId,
			label,
			cortextType: fieldType ?? 'text',
		} ),
		[ dataViewId, fieldType, label ]
	);
	const visibleFields = useMemo(
		() => ( Array.isArray( view?.fields ) ? view.fields : [] ),
		[ view ]
	);
	const sortField = view?.sort?.field ?? null;
	const sortDirection = view?.sort?.direction ?? null;
	const isSorted = sortField === dataViewId;
	const sortMenuKey = isSorted ? sortDirection : 'none';
	const sortRadioGroupName = `cortext-column-sort-${ recordId }-${ sortMenuKey }`;

	// Move only touches data fields. Title stays pinned, and the legacy
	// ghost id is ignored if an older saved view still has it.
	const movableFields = useMemo(
		() =>
			visibleFields.filter(
				( id ) => id !== TITLE_FIELD_ID && id !== GHOST_FIELD_ID
			),
		[ visibleFields ]
	);
	const movableIndex = movableFields.indexOf( dataViewId );
	const canMoveLeft = movableIndex > 0;
	const canMoveRight =
		movableIndex >= 0 && movableIndex < movableFields.length - 1;

	const dispatchSort = useCallback(
		( direction ) => {
			onChangeView( {
				...view,
				sort: { field: dataViewId, direction },
			} );
		},
		[ onChangeView, view, dataViewId ]
	);

	const dispatchMove = useCallback(
		( delta ) => {
			const order = movableFields.slice();
			const from = order.indexOf( dataViewId );
			if ( from < 0 ) {
				return;
			}
			const to = from + delta;
			if ( to < 0 || to >= order.length ) {
				return;
			}
			order.splice( from, 1 );
			order.splice( to, 0, dataViewId );
			// Put title back first. Preserve the legacy ghost id for now;
			// CollectionDataViews strips it on the next normalization pass.
			const ordered = [];
			if ( visibleFields.includes( TITLE_FIELD_ID ) ) {
				ordered.push( TITLE_FIELD_ID );
			}
			ordered.push( ...order );
			if ( visibleFields.includes( GHOST_FIELD_ID ) ) {
				ordered.push( GHOST_FIELD_ID );
			}
			onChangeView( { ...view, fields: ordered } );
		},
		[ onChangeView, view, dataViewId, movableFields, visibleFields ]
	);

	const dispatchHide = useCallback( () => {
		const next = visibleFields.filter( ( id ) => id !== dataViewId );
		onChangeView( { ...view, fields: next } );
	}, [ onChangeView, view, dataViewId, visibleFields ] );

	const renderViewGroup = useCallback(
		( { Menu, closeMenu, closeFormat } ) => (
			<Menu.Group key={ `sort-${ dataViewId }-${ sortMenuKey }` }>
				<Menu.Item
					ref={ calculationItemRef }
					className="cortext-column-header-actions__submenu-item"
					hideOnClick={ false }
					suffix={ <Icon icon={ chevronRight } size={ 18 } /> }
					onClick={ () => {
						closeFormat?.();
						openCalculation();
					} }
					onKeyDown={ ( event ) =>
						openCalculationFromKeyboard( event, closeFormat )
					}
					onMouseEnter={ () => {
						closeFormat?.();
						openCalculation();
					} }
					onMouseLeave={ scheduleClose }
				>
					<Menu.ItemLabel>
						{ __( 'Calculate', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.Item>
				<Menu.RadioItem
					name={ sortRadioGroupName }
					value="asc"
					checked={ isSorted && sortDirection === 'asc' }
					hideOnClick
					onChange={ () => dispatchSort( 'asc' ) }
				>
					<Menu.ItemLabel>
						{ __( 'Sort ascending', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.RadioItem>
				<Menu.RadioItem
					name={ sortRadioGroupName }
					value="desc"
					checked={ isSorted && sortDirection === 'desc' }
					hideOnClick
					onChange={ () => dispatchSort( 'desc' ) }
				>
					<Menu.ItemLabel>
						{ __( 'Sort descending', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.RadioItem>
				<Menu.Item
					prefix={ <Icon icon={ unseen } /> }
					onClick={ () => {
						dispatchHide();
						closeMenu();
					} }
				>
					<Menu.ItemLabel>
						{ __( 'Hide column', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.Item>
			</Menu.Group>
		),
		[
			dataViewId,
			dispatchHide,
			dispatchSort,
			isSorted,
			openCalculation,
			openCalculationFromKeyboard,
			scheduleClose,
			sortDirection,
			sortMenuKey,
			sortRadioGroupName,
		]
	);

	const renderLifecyclePrefix = useCallback(
		( { Menu } ) => (
			<>
				<Menu.Item
					prefix={ <Icon icon={ arrowLeft } /> }
					disabled={ ! canMoveLeft }
					onClick={ () => dispatchMove( -1 ) }
				>
					<Menu.ItemLabel>
						{ __( 'Move left', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.Item>
				<Menu.Item
					prefix={ <Icon icon={ arrowRight } /> }
					disabled={ ! canMoveRight }
					onClick={ () => dispatchMove( 1 ) }
				>
					<Menu.ItemLabel>
						{ __( 'Move right', 'cortext' ) }
					</Menu.ItemLabel>
				</Menu.Item>
			</>
		),
		[ canMoveLeft, canMoveRight, dispatchMove ]
	);

	return (
		<>
			<FieldActionsMenu
				recordId={ recordId }
				collectionId={ collectionId }
				field={ effectiveField }
				className="cortext-column-header-actions"
				menuKey={ `menu-${ dataViewId }-${ sortMenuKey }` }
				triggerButton={
					<Button
						className="dataviews-view-table-header-button cortext-column-header-trigger"
						variant="tertiary"
					/>
				}
				triggerContent={
					<span className="cortext-column-header-content">
						<FieldTypeIcon
							type={ fieldType }
							className="cortext-column-header-type-icon"
						/>
						<span className="cortext-column-header-label">
							{ label }
						</span>
						{ isSorted ? (
							<span
								className="cortext-column-header-sort-indicator"
								aria-hidden="true"
							>
								{ sortDirection === 'asc' ? '↑' : '↓' }
							</span>
						) : null }
					</span>
				}
				closeMenuRef={ closeFieldMenuRef }
				onFieldOptionsSaved={ onFieldOptionsSaved }
				onFieldFormatSaved={ onFieldFormatSaved }
				onOpenFormat={ closeCalculation }
				onRowsChanged={ onRowsChanged }
				onCloseMenu={ closeCalculation }
				renderBetweenConfigAndLifecycle={ renderViewGroup }
				renderLifecyclePrefix={ renderLifecyclePrefix }
			/>
			{ isCalculating ? (
				<TableCalculationPopover
					anchor={ calculationItemRef.current }
					field={ calculationField }
					selected={ view?.calculations?.[ dataViewId ] }
					focusOnMount={
						shouldFocusCalculation ? 'firstElement' : false
					}
					onPick={ ( calculation ) => {
						onChangeView(
							withColumnCalculation(
								view,
								dataViewId,
								calculation
							)
						);
						closeFieldMenu();
					} }
					onClose={ closeCalculationAndFocusTrigger }
					onMouseEnter={ () => openCalculation() }
					onMouseLeave={ scheduleClose }
				/>
			) : null }
		</>
	);
}

function AddFieldTrigger( { collectionId, onFieldCreated, onRowsChanged } ) {
	return (
		<span className="cortext-column-header-actions cortext-column-header-actions--add">
			<Dropdown
				contentClassName="cortext-data-view-toolbar-popover"
				popoverProps={ { placement: 'bottom-end' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						icon={ plus }
						label={ __( 'Add field', 'cortext' ) }
						size="compact"
						onClick={ onToggle }
						isPressed={ isOpen }
					/>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cortext-data-view-toolbar-popover__content">
						<AddFieldPopover
							collectionId={ collectionId }
							onCreate={ ( created ) => {
								onFieldCreated?.( created );
								if ( created?.type === 'rollup' ) {
									onRowsChanged?.();
								}
								onClose();
							} }
						/>
					</div>
				) }
			/>
		</span>
	);
}
