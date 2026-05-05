/* global MutationObserver */
import { __ } from '@wordpress/i18n';
import {
	Button,
	Dropdown,
	Icon,
	MenuGroup,
	MenuItem,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import {
	createPortal,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { chevronRight, plus } from '@wordpress/icons';

import AddFieldPopover from './AddFieldPopover';
import FieldFormatPopover from './FieldFormatPopover';
import RenameFieldInline from './RenameFieldInline';
import {
	useDeleteField,
	useDuplicateField,
} from '../../hooks/useFieldMutations';
import { GHOST_FIELD_ID, TITLE_FIELD_ID } from '../dataViewColumns';

const FORMATTABLE_TYPES = new Set( [ 'number', 'date', 'datetime' ] );

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
						/>,
						target.th,
						target.key
					);
				}
				return createPortal(
					<AddFieldTrigger collectionId={ collectionId } />,
					target.th,
					target.key
				);
			} ) }
		</>
	);
}

function FieldActions( { recordId, collectionId, view, onChangeView } ) {
	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ isFormatting, setIsFormatting ] = useState( false );
	const [ confirmDelete, setConfirmDelete ] = useState( false );
	const formatItemRef = useRef( null );
	const closeTimerRef = useRef( null );
	const duplicate = useDuplicateField( collectionId );
	const remove = useDeleteField( collectionId );
	const { record } = useEntityRecord( 'postType', 'crtxt_field', recordId );
	const fieldType = record?.meta?.type;
	const canFormat = FORMATTABLE_TYPES.has( fieldType );

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
			closeTimerRef.current = null;
		}, 180 );
	}, [ cancelClose ] );
	const openFormat = useCallback( () => {
		cancelClose();
		setIsFormatting( true );
	}, [ cancelClose ] );
	useEffect( () => () => cancelClose(), [ cancelClose ] );

	const dataViewId = `field-${ recordId }`;
	const label =
		record?.title?.raw || record?.title?.rendered || `#${ recordId }`;
	const visibleFields = useMemo(
		() => ( Array.isArray( view?.fields ) ? view.fields : [] ),
		[ view ]
	);
	const sortField = view?.sort?.field ?? null;
	const sortDirection = view?.sort?.direction ?? null;
	const isSorted = sortField === dataViewId;

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
		<span className="cortext-column-header-actions">
			<Dropdown
				contentClassName="cortext-field-actions-popover"
				popoverProps={ { placement: 'bottom-start' } }
				onClose={ () => {
					cancelClose();
					setIsFormatting( false );
				} }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						className="dataviews-view-table-header-button cortext-column-header-trigger"
						variant="tertiary"
						onClick={ onToggle }
						aria-expanded={ isOpen }
					>
						<span className="cortext-column-header-label">
							{ label }
						</span>
						{ isSorted ? (
							<span aria-hidden="true">
								{ sortDirection === 'asc' ? ' ↑' : ' ↓' }
							</span>
						) : null }
					</Button>
				) }
				renderContent={ ( { onClose } ) => (
					<>
						{ /* Property-config group: edit how the column
						     itself is defined. Mirrors Notion's first
						     section (Edit property / Change type). */ }
						<MenuGroup>
							<MenuItem
								onClick={ () => {
									onClose();
									setIsRenaming( true );
								} }
							>
								{ __( 'Rename', 'cortext' ) }
							</MenuItem>
							{ canFormat ? (
								<MenuItem
									ref={ formatItemRef }
									className="cortext-column-header-actions__submenu-item"
									onClick={ openFormat }
									onMouseEnter={ openFormat }
									onMouseLeave={ scheduleClose }
									suffix={
										<Icon
											icon={ chevronRight }
											size={ 18 }
										/>
									}
								>
									{ __( 'Edit field', 'cortext' ) }
								</MenuItem>
							) : null }
						</MenuGroup>
						{ /* View group: sort, hide. Notion bundles
						     filter/sort/group/hide together. */ }
						<MenuGroup>
							<MenuItem
								isSelected={
									isSorted && sortDirection === 'asc'
								}
								onClick={ () => {
									onClose();
									dispatchSort( 'asc' );
								} }
							>
								{ __( 'Sort ascending', 'cortext' ) }
							</MenuItem>
							<MenuItem
								isSelected={
									isSorted && sortDirection === 'desc'
								}
								onClick={ () => {
									onClose();
									dispatchSort( 'desc' );
								} }
							>
								{ __( 'Sort descending', 'cortext' ) }
							</MenuItem>
							<MenuItem
								onClick={ () => {
									onClose();
									dispatchHide();
								} }
							>
								{ __( 'Hide column', 'cortext' ) }
							</MenuItem>
						</MenuGroup>
						{ /* Column-lifecycle group: move, duplicate,
						     delete. Notion's "Insert left/right /
						     Duplicate / Delete property" cluster. */ }
						<MenuGroup>
							<MenuItem
								disabled={ ! canMoveLeft }
								onClick={ () => {
									onClose();
									dispatchMove( -1 );
								} }
							>
								{ __( 'Move left', 'cortext' ) }
							</MenuItem>
							<MenuItem
								disabled={ ! canMoveRight }
								onClick={ () => {
									onClose();
									dispatchMove( 1 );
								} }
							>
								{ __( 'Move right', 'cortext' ) }
							</MenuItem>
							<MenuItem
								onClick={ async () => {
									onClose();
									try {
										await duplicate.run( recordId );
									} catch {
										// surfaced via duplicate.error.
									}
								} }
							>
								{ __( 'Duplicate', 'cortext' ) }
							</MenuItem>
							<MenuItem
								isDestructive
								onClick={ () => {
									onClose();
									setConfirmDelete( true );
								} }
							>
								{ __( 'Delete', 'cortext' ) }
							</MenuItem>
						</MenuGroup>
						{ isFormatting && canFormat ? (
							<FieldFormatPopover
								recordId={ recordId }
								anchor={ formatItemRef.current }
								onClose={ () => setIsFormatting( false ) }
								onMouseEnter={ openFormat }
								onMouseLeave={ scheduleClose }
							/>
						) : null }
					</>
				) }
			/>
			{ confirmDelete ? (
				<ConfirmDialog
					onConfirm={ onConfirmDelete }
					onCancel={ () => setConfirmDelete( false ) }
					confirmButtonText={ __( 'Delete', 'cortext' ) }
				>
					{ __(
						'Delete this field? Existing values for this field will be removed from every entry.',
						'cortext'
					) }
				</ConfirmDialog>
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
