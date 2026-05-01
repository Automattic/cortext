/* global MutationObserver */
import { __ } from '@wordpress/i18n';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import {
	createPortal,
	useCallback,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { moreVertical, plus } from '@wordpress/icons';

import AddFieldPopover from './AddFieldPopover';
import RenameFieldInline from './RenameFieldInline';
import {
	useDeleteField,
	useDuplicateField,
} from '../../hooks/useFieldMutations';

// Projects two kinds of triggers into the DataViews table header:
//
// - `[data-cortext-field-marker="<recordId>"]` — kebab menu (Rename /
//   Duplicate / Delete) for custom fields, sibling to DataViews'
//   built-in column-header trigger and `DataViewColumnInteractions`'
//   resize/reorder handles.
// - `[data-cortext-add-field-marker]` — `+` button on the ghost column
//   that opens the same `AddFieldPopover` as the toolbar Add field
//   trigger.
//
// Renders an invisible anchor element so the component finds its own
// position in DOM and walks up to the wrapping `.cortext-data-view`.
// A MutationObserver re-syncs portals whenever DataViews mutates its
// header markup (column toggles, sorting, resizing).
export default function ColumnHeaderActions( { collectionId } ) {
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

function stopBubble( event ) {
	event.stopPropagation();
}

function FieldActions( { recordId, collectionId } ) {
	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ confirmDelete, setConfirmDelete ] = useState( false );
	const duplicate = useDuplicateField( collectionId );
	const remove = useDeleteField( collectionId );

	const onConfirmDelete = useCallback( async () => {
		try {
			await remove.run( recordId );
		} finally {
			setConfirmDelete( false );
		}
	}, [ remove, recordId ] );

	if ( isRenaming ) {
		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
			<span
				className="cortext-column-header-actions"
				onClick={ stopBubble }
				onPointerDown={ stopBubble }
			>
				<RenameFieldInline
					recordId={ recordId }
					onDone={ () => setIsRenaming( false ) }
				/>
			</span>
		);
	}

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
		<span
			className="cortext-column-header-actions"
			onClick={ stopBubble }
			onPointerDown={ stopBubble }
		>
			<Dropdown
				contentClassName="cortext-field-actions-popover"
				popoverProps={ { placement: 'bottom-end' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						icon={ moreVertical }
						size="small"
						label={ __( 'Field actions', 'cortext' ) }
						onClick={ onToggle }
						aria-expanded={ isOpen }
					/>
				) }
				renderContent={ ( { onClose } ) => (
					<MenuGroup>
						<MenuItem
							onClick={ () => {
								onClose();
								setIsRenaming( true );
							} }
						>
							{ __( 'Rename', 'cortext' ) }
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
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
		<span
			className="cortext-column-header-actions cortext-column-header-actions--add"
			onClick={ stopBubble }
			onPointerDown={ stopBubble }
		>
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
