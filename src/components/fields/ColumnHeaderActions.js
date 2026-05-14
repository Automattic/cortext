/* global MutationObserver */
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Dropdown,
	Icon,
	Popover,
	privateApis as componentsPrivateApis,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { unlock } from '../../lock-unlock';
import { useEntityRecord } from '@wordpress/core-data';
import {
	createPortal,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import {
	arrowLeft,
	arrowRight,
	chevronRight,
	copy,
	pencil,
	plus,
	trash,
	unseen,
} from '@wordpress/icons';

import AddFieldPopover from './AddFieldPopover';
import ChangeFieldTypePopover from './ChangeFieldTypePopover';
import EditOptionsPopover from './EditOptionsPopover';
import FieldFormatPopover from './FieldFormatPopover';
import RenameFieldInline from './RenameFieldInline';
import { useCollectionFieldsContext } from '../CollectionFieldsContext';
import { elementsFromOptions } from '../../hooks/fieldMapping';
import { TableCalculationPopover } from '../TableCalculationMenu';
import {
	useDeleteField,
	useDuplicateField,
} from '../../hooks/useFieldMutations';
import { GHOST_FIELD_ID, TITLE_FIELD_ID } from '../dataViewColumns';
import { withColumnCalculation } from '../tableCalculations';

const TYPES_WITH_OPTIONS = new Set( [ 'select', 'multiselect' ] );
const { Menu } = unlock( componentsPrivateApis );

const FORMATTABLE_TYPES = new Set( [ 'number', 'date', 'datetime' ] );

// Conversion is not offered for these source types (the converter rejects
// any pair that touches them server-side; hide the menu item so we don't
// invite a click that always errors).
const UNCONVERTIBLE_SOURCE_TYPES = new Set( [
	'relation',
	'rollup',
	'formula',
] );

// Projects two kinds of triggers into the DataViews table header:
//
// - `[data-cortext-field-marker="<recordId>"]` — combined column-header
//   dropdown for custom fields. Replaces DataViews' built-in trigger
//   (hidden via CSS, see `tech-debt.md#16`) with a single menu owning
//   Sort / Move / Hide *plus* Rename / Duplicate / Delete. The marker
//   sits inside DataViews' (hidden) trigger and serves only as a portal
//   anchor; the actual button is rendered as a sibling of the trigger,
//   inheriting the same class so main's drag handle click-forward
//   resolves to it.
// - `[data-cortext-add-field-marker]` — `+` button on the ghost column
//   that opens the same `AddFieldPopover` as the toolbar Add field
//   trigger.
//
// Renders an invisible anchor element so the component finds its own
// position in DOM and walks up to the wrapping `.cortext-data-view`.
// A MutationObserver re-syncs portals whenever DataViews mutates its
// header markup (column toggles, sorting, resizing).
export default function ColumnHeaderActions( {
	collectionId,
	view,
	onChangeView,
	onFieldOptionsSaved,
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
			wrapper
				.querySelectorAll( '[data-cortext-add-field-marker]' )
				.forEach( ( marker ) => {
					const th = marker.closest( 'th' );
					if ( ! th ) {
						return;
					}
					next.push( {
						key: 'add-field',
						kind: 'add',
						th,
					} );
				} );

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
							onRowsChanged={ onRowsChanged }
						/>,
						target.th,
						target.key
					);
				}
				return createPortal(
					<AddFieldTrigger collectionId={ collectionId } />,
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
	onRowsChanged,
} ) {
	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ isMenuOpen, setIsMenuOpen ] = useState( false );
	const [ isFormatting, setIsFormatting ] = useState( false );
	const [ isEditingOptions, setIsEditingOptions ] = useState( false );
	const [ isChangingType, setIsChangingType ] = useState( false );
	const [ isCalculating, setIsCalculating ] = useState( false );
	const [ shouldFocusFormat, setShouldFocusFormat ] = useState( false );
	const [ shouldFocusCalculation, setShouldFocusCalculation ] =
		useState( false );
	const [ confirmDelete, setConfirmDelete ] = useState( false );
	const formatItemRef = useRef( null );
	const calculationItemRef = useRef( null );
	const closeTimerRef = useRef( null );
	const optionsAnchorRef = useRef( null );
	const duplicate = useDuplicateField( collectionId );
	const remove = useDeleteField( collectionId );
	const { fields } = useCollectionFieldsContext();
	const { record } = useEntityRecord( 'postType', 'crtxt_field', recordId );
	const fieldType = record?.meta?.type;
	const canFormat = FORMATTABLE_TYPES.has( fieldType );
	const supportsOptions = TYPES_WITH_OPTIONS.has( fieldType );
	const canChangeType =
		Boolean( fieldType ) && ! UNCONVERTIBLE_SOURCE_TYPES.has( fieldType );
	const initialOptions = useMemo(
		() =>
			supportsOptions
				? elementsFromOptions( record?.meta?.options ) || []
				: [],
		[ supportsOptions, record?.meta?.options ]
	);

	// Format submenu uses a hover-with-grace pattern: the panel stays
	// visible while the cursor is over either the trigger row or the
	// panel itself. The grace timer absorbs the dead pixels between them
	// so the user doesn't lose the panel by overshooting on the way over.
	const cancelClose = useCallback( () => {
		if ( closeTimerRef.current ) {
			clearTimeout( closeTimerRef.current );
			closeTimerRef.current = null;
		}
	}, [] );
	const scheduleClose = useCallback( () => {
		cancelClose();
		closeTimerRef.current = setTimeout( () => {
			setIsFormatting( false );
			setIsCalculating( false );
			setShouldFocusFormat( false );
			setShouldFocusCalculation( false );
			closeTimerRef.current = null;
		}, 180 );
	}, [ cancelClose ] );
	const openFormat = useCallback(
		( focus = false ) => {
			cancelClose();
			setIsCalculating( false );
			setShouldFocusFormat( focus );
			setShouldFocusCalculation( false );
			setIsFormatting( true );
		},
		[ cancelClose ]
	);
	useEffect( () => () => cancelClose(), [ cancelClose ] );

	const closeMenu = useCallback( () => {
		cancelClose();
		setIsFormatting( false );
		setIsCalculating( false );
		setShouldFocusFormat( false );
		setShouldFocusCalculation( false );
		setIsMenuOpen( false );
	}, [ cancelClose ] );

	const closeFormat = useCallback( () => {
		cancelClose();
		setIsFormatting( false );
		setShouldFocusFormat( false );
	}, [ cancelClose ] );

	const closeCalculation = useCallback( () => {
		cancelClose();
		setIsCalculating( false );
		setShouldFocusCalculation( false );
	}, [ cancelClose ] );

	const openCalculation = useCallback(
		( focus = false ) => {
			cancelClose();
			setIsFormatting( false );
			setShouldFocusFormat( false );
			setShouldFocusCalculation( focus );
			setIsCalculating( true );
		},
		[ cancelClose ]
	);

	const openCalculationFromKeyboard = useCallback(
		( event ) => {
			if (
				! [ 'ArrowRight', 'Enter', ' ', 'Spacebar' ].includes(
					event.key
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			openCalculation( true );
		},
		[ openCalculation ]
	);

	const closeFormatAndFocusTrigger = useCallback( () => {
		closeFormat();
		window.requestAnimationFrame( () => {
			formatItemRef.current?.focus();
		} );
	}, [ closeFormat ] );

	const closeCalculationAndFocusTrigger = useCallback( () => {
		closeCalculation();
		window.requestAnimationFrame( () => {
			calculationItemRef.current?.focus();
		} );
	}, [ closeCalculation ] );

	const openFormatFromKeyboard = useCallback(
		( event ) => {
			if (
				! [ 'ArrowRight', 'Enter', ' ', 'Spacebar' ].includes(
					event.key
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			openFormat( true );
		},
		[ openFormat ]
	);

	const onMenuOpenChange = useCallback(
		( nextOpen ) => {
			if ( nextOpen ) {
				setIsMenuOpen( true );
			} else {
				closeMenu();
			}
		},
		[ closeMenu ]
	);

	// Keep Ariakit from auto-hiding the menu when the user interacts
	// with the format popover or one of its third-level flyouts.
	const hideMenuOnInteractOutside = useCallback( ( event ) => {
		const target = event.target;
		if ( target && typeof target.closest === 'function' ) {
			if (
				target.closest( '.cortext-format-submenu' ) ||
				target.closest( '.cortext-format-submenu__flyout' ) ||
				target.closest( '.cortext-table-calculation-submenu' )
			) {
				return false;
			}
		}
		return true;
	}, [] );

	// When this component renders inside an iframe (e.g. the Gutenberg
	// canvas), Ariakit's outside-click listener only fires for events in
	// the iframe document. Clicks on the editor chrome (sidebar, header)
	// happen on the parent document, so without an extra listener there
	// the menu stays open until the user clicks back into the canvas.
	useEffect( () => {
		if ( ! isMenuOpen ) {
			return undefined;
		}
		let parentDoc;
		try {
			if ( window.parent && window.parent !== window ) {
				parentDoc = window.parent.document;
			}
		} catch {
			parentDoc = undefined;
		}
		if ( ! parentDoc || parentDoc === document ) {
			return undefined;
		}
		const onParentMouseDown = ( event ) => {
			if ( hideMenuOnInteractOutside( event ) ) {
				closeMenu();
			}
		};
		parentDoc.addEventListener( 'mousedown', onParentMouseDown );
		return () =>
			parentDoc.removeEventListener( 'mousedown', onParentMouseDown );
	}, [ isMenuOpen, closeMenu, hideMenuOnInteractOutside ] );

	const dataViewId = `field-${ recordId }`;
	const label =
		record?.title?.raw || record?.title?.rendered || `#${ recordId }`;
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
	const dependentRollups = useMemo(
		() =>
			fields.filter(
				( field ) =>
					field.cortextType === 'rollup' &&
					( field.rollupRelationFieldId === recordId ||
						field.rollupTargetFieldId === recordId )
			),
		[ fields, recordId ]
	);

	// Title is pinned at index 0 (PR A's normalizeView) and the ghost
	// column at the end. Move only operates on the data-field region in
	// between, so a sideways swap can't displace either.
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
			// Re-stitch with title first and ghost last so neither can
			// be displaced by a sideways swap.
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

	const onConfirmDelete = useCallback( async () => {
		try {
			await remove.run( recordId );
		} finally {
			setConfirmDelete( false );
		}
	}, [ remove, recordId ] );

	if ( isRenaming ) {
		return (
			<span className="cortext-column-header-actions">
				<RenameFieldInline
					recordId={ recordId }
					onDone={ () => setIsRenaming( false ) }
				/>
			</span>
		);
	}

	return (
		<span
			className="cortext-column-header-actions"
			ref={ optionsAnchorRef }
		>
			<Menu open={ isMenuOpen } onOpenChange={ onMenuOpenChange }>
				<Menu.TriggerButton
					render={
						<Button
							className="dataviews-view-table-header-button cortext-column-header-trigger"
							variant="tertiary"
						/>
					}
				>
					<span className="cortext-column-header-label">
						{ label }
					</span>
					{ isSorted ? (
						<span aria-hidden="true">
							{ sortDirection === 'asc' ? ' ↑' : ' ↓' }
						</span>
					) : null }
				</Menu.TriggerButton>
				<Menu.Popover
					className="cortext-field-actions-popover"
					modal={ false }
					portal
					hideOnInteractOutside={ hideMenuOnInteractOutside }
					style={ { minWidth: '240px' } }
				>
					{ /* Property-config group: edit how the column
					     itself is defined. Keeps field actions grouped by
					     section (Edit property / Change type). */ }
					<Menu.Group>
						<Menu.Item
							prefix={ <Icon icon={ pencil } /> }
							onClick={ () => setIsRenaming( true ) }
						>
							<Menu.ItemLabel>
								{ __( 'Rename', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
						{ canFormat ? (
							<Menu.Item
								ref={ formatItemRef }
								className="cortext-column-header-actions__submenu-item"
								hideOnClick={ false }
								suffix={
									<Icon icon={ chevronRight } size={ 18 } />
								}
								onClick={ () => openFormat() }
								onKeyDown={ openFormatFromKeyboard }
								onMouseEnter={ () => openFormat() }
								onMouseLeave={ scheduleClose }
							>
								<Menu.ItemLabel>
									{ __( 'Edit field', 'cortext' ) }
								</Menu.ItemLabel>
							</Menu.Item>
						) : null }
						{ supportsOptions ? (
							<Menu.Item
								onClick={ () => setIsEditingOptions( true ) }
							>
								<Menu.ItemLabel>
									{ __( 'Edit options', 'cortext' ) }
								</Menu.ItemLabel>
							</Menu.Item>
						) : null }
						{ canChangeType ? (
							<Menu.Item
								onClick={ () => setIsChangingType( true ) }
							>
								<Menu.ItemLabel>
									{ __( 'Change type…', 'cortext' ) }
								</Menu.ItemLabel>
							</Menu.Item>
						) : null }
					</Menu.Group>
					<Menu.Separator />
					{ /* View group: keep sort/hide actions together. */ }
					<Menu.Group>
						<Menu.Item
							ref={ calculationItemRef }
							className="cortext-column-header-actions__submenu-item"
							hideOnClick={ false }
							suffix={
								<Icon icon={ chevronRight } size={ 18 } />
							}
							onClick={ () => openCalculation() }
							onKeyDown={ openCalculationFromKeyboard }
							onMouseEnter={ () => openCalculation() }
							onMouseLeave={ scheduleClose }
						>
							<Menu.ItemLabel>
								{ __( 'Calculate', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
						<Menu.RadioItem
							name="cortext-column-sort"
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
							name="cortext-column-sort"
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
							onClick={ dispatchHide }
						>
							<Menu.ItemLabel>
								{ __( 'Hide column', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
					</Menu.Group>
					<Menu.Separator />
					{ /* Column-lifecycle group: move, duplicate, delete. */ }
					<Menu.Group>
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
						<Menu.Item
							prefix={ <Icon icon={ copy } /> }
							onClick={ async () => {
								try {
									await duplicate.run( recordId );
								} catch {
									// surfaced via duplicate.error.
								}
							} }
						>
							<Menu.ItemLabel>
								{ __( 'Duplicate', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
						<Menu.Item
							className="cortext-column-header-actions__destructive-item"
							prefix={ <Icon icon={ trash } /> }
							onClick={ () => setConfirmDelete( true ) }
						>
							<Menu.ItemLabel>
								{ __( 'Delete', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
					</Menu.Group>
				</Menu.Popover>
			</Menu>
			{ isFormatting && canFormat ? (
				<FieldFormatPopover
					recordId={ recordId }
					anchor={ formatItemRef.current }
					focusOnMount={ shouldFocusFormat ? 'firstElement' : false }
					onClose={ closeFormat }
					onCloseWithFocus={ closeFormatAndFocusTrigger }
					onMouseEnter={ () => openFormat() }
					onMouseLeave={ scheduleClose }
				/>
			) : null }
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
						closeMenu();
					} }
					onClose={ closeCalculationAndFocusTrigger }
					onMouseEnter={ () => openCalculation() }
					onMouseLeave={ scheduleClose }
				/>
			) : null }
			{ confirmDelete ? (
				<ConfirmDialog
					onConfirm={ onConfirmDelete }
					onCancel={ () => setConfirmDelete( false ) }
					confirmButtonText={ __( 'Delete', 'cortext' ) }
				>
					<p>
						{ __(
							'Delete this field? Existing values for this field will be removed from every entry.',
							'cortext'
						) }
					</p>
					{ dependentRollups.length > 0 ? (
						<p>
							{ dependentRollups.length === 1
								? __(
										'This will also delete 1 rollup that depends on it:',
										'cortext'
								  )
								: sprintf(
										/* translators: %d: number of dependent rollup fields */
										__(
											'This will also delete %d rollups that depend on it:',
											'cortext'
										),
										dependentRollups.length
								  ) }{ ' ' }
							{ dependentRollups
								.map( ( field ) => field.label )
								.join( ', ' ) }
						</p>
					) : null }
				</ConfirmDialog>
			) : null }
			{ isEditingOptions && supportsOptions ? (
				<Popover
					anchor={ optionsAnchorRef.current }
					placement="bottom-start"
					onClose={ () => setIsEditingOptions( false ) }
					focusOnMount="firstElement"
					className="cortext-edit-options-popover-host"
				>
					<EditOptionsPopover
						recordId={ recordId }
						fieldType={ fieldType }
						initialOptions={ initialOptions }
						onOptionsSaved={ ( nextOptions ) =>
							onFieldOptionsSaved?.( recordId, nextOptions )
						}
						onRowsChanged={ onRowsChanged }
						onRequestClose={ () => setIsEditingOptions( false ) }
					/>
				</Popover>
			) : null }
			{ isChangingType && canChangeType ? (
				<ChangeFieldTypePopover
					anchor={ optionsAnchorRef.current }
					collectionId={ collectionId }
					recordId={ recordId }
					currentType={ fieldType }
					onClose={ () => {
						setIsChangingType( false );
						onRowsChanged?.();
					} }
				/>
			) : null }
		</span>
	);
}

function AddFieldTrigger( { collectionId } ) {
	return (
		<span className="cortext-column-header-actions cortext-column-header-actions--add">
			<Dropdown
				contentClassName="cortext-data-view-toolbar-popover"
				popoverProps={ { placement: 'bottom-end' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						icon={ plus }
						label={ __( 'Add field', 'cortext' ) }
						size="small"
						onClick={ onToggle }
						isPressed={ isOpen }
					/>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cortext-data-view-toolbar-popover__content">
						<AddFieldPopover
							collectionId={ collectionId }
							onCreate={ onClose }
						/>
					</div>
				) }
			/>
		</span>
	);
}
