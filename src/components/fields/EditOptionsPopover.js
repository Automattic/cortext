import { __ } from '@wordpress/i18n';
import {
	Button,
	Icon,
	MenuGroup,
	MenuItem,
	Notice,
	Popover,
} from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { dragHandle, moreHorizontal } from '@wordpress/icons';
import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import Chip from './Chip';
import OptionMenu from './OptionMenu';
import { isOptionColorName, pickNextOptionColor } from './optionPalette';
import DeleteOptionDialog from './DeleteOptionDialog';
import {
	useFlushFieldRecord,
	useUpdateFieldOptions,
} from '../../hooks/useFieldMutations';

// Inlined to avoid pulling `@dnd-kit/utilities` into our explicit deps; it
// only ships `CSS.Transform.toString({x, y, scaleX, scaleY})`.
function transformToString( transform ) {
	if ( ! transform ) {
		return undefined;
	}
	const { x = 0, y = 0, scaleX = 1, scaleY = 1 } = transform;
	return `translate3d(${ x }px, ${ y }px, 0) scaleX(${ scaleX }) scaleY(${ scaleY })`;
}

function slugify( label ) {
	return (
		String( label )
			.toLowerCase()
			.trim()
			.replace( /[^\p{L}\p{N}]+/gu, '-' )
			.replace( /^-+|-+$/g, '' ) || 'option'
	);
}

function uniqueValue( base, taken ) {
	if ( ! taken.includes( base ) ) {
		return base;
	}
	let n = 2;
	while ( taken.includes( `${ base }-${ n }` ) ) {
		n++;
	}
	return `${ base }-${ n }`;
}

function SortableOptionRow( {
	option,
	isMenuOpen,
	isSelected,
	onPick,
	onToggleMenu,
	onCloseMenu,
	onLabelChange,
	onColorChange,
	onDelete,
} ) {
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable( { id: option.value } );
	const moreRef = useRef( null );
	const style = {
		transform: transformToString( transform ),
		transition,
	};
	const displayColor = isOptionColorName( option.color )
		? option.color
		: undefined;
	const isPickable = typeof onPick === 'function';

	return (
		<div
			ref={ setNodeRef }
			style={ style }
			className={
				'cortext-edit-options-popover__row' +
				( isSelected ? ' is-selected' : '' )
			}
		>
			<button
				type="button"
				className="cortext-edit-options-popover__handle"
				aria-label={ __( 'Reorder option', 'cortext' ) }
				{ ...attributes }
				{ ...listeners }
			>
				<Icon icon={ dragHandle } size={ 18 } />
			</button>
			{ isPickable ? (
				<button
					type="button"
					className="cortext-edit-options-popover__pick"
					onClick={ onPick }
					aria-pressed={ isSelected }
				>
					<Chip label={ option.label } color={ displayColor } />
				</button>
			) : (
				<span className="cortext-edit-options-popover__row-chip">
					<Chip label={ option.label } color={ displayColor } />
				</span>
			) }
			<Button
				ref={ moreRef }
				icon={ moreHorizontal }
				size="small"
				className="cortext-edit-options-popover__more"
				label={ __( 'Edit option', 'cortext' ) }
				onClick={ onToggleMenu }
				aria-haspopup="menu"
				aria-expanded={ isMenuOpen }
			/>
			{ isMenuOpen ? (
				<Popover
					anchor={ moreRef.current }
					placement="right-start"
					offset={ 8 }
					onClose={ onCloseMenu }
					className="cortext-edit-options-popover__submenu"
				>
					<OptionMenu
						option={ option }
						onLabelChange={ onLabelChange }
						onColorChange={ onColorChange }
						onDelete={ onDelete }
						onClose={ onCloseMenu }
					/>
				</Popover>
			) : null }
		</div>
	);
}

// Unified options popover used by both the column-header "Edit options"
// surface and the cell editor. When `onPick` is provided, the chip area
// of each row becomes a click target that commits the option as the
// cell's value; without `onPick` it is just a label and rows are pure
// management. The single search-or-create input at the top filters the
// list and offers a "Create [label]" suggestion when typing a value
// that doesn't exist yet, matching Notion's pattern.
//
// Local state mirrors the saved option list so user edits feel instant;
// each mutation calls `useUpdateFieldOptions` which refetches the field
// record into the entity store, so the next render syncs up via
// `initialOptions`. Deleting an option that has rows referencing it
// pops `DeleteOptionDialog` so the user can clear or replace.
export default function EditOptionsPopover( {
	recordId,
	fieldType,
	initialOptions,
	value,
	onPick,
	onOptionsSaved,
	onRowsChanged,
	onRequestClose,
} ) {
	const update = useUpdateFieldOptions();
	const flush = useFlushFieldRecord();
	const [ options, setOptions ] = useState( () => initialOptions || [] );
	const [ deleting, setDeleting ] = useState( null );
	const [ search, setSearch ] = useState( '' );
	const [ openMenuValue, setOpenMenuValue ] = useState( null );
	const searchInputRef = useRef( null );
	const popoverRef = useRef( null );
	const lastInitialRef = useRef( initialOptions );
	const dirtyRef = useRef( false );

	useEffect( () => {
		if ( lastInitialRef.current !== initialOptions ) {
			lastInitialRef.current = initialOptions;
			setOptions( initialOptions || [] );
		}
	}, [ initialOptions ] );

	// On unmount, push the latest field record back into the entity
	// store so the row cells (which subscribe through useEntityRecords)
	// reflect any options the user added/recolored/deleted while the
	// popover was open. Saves go through a write-only path that skips
	// the store update so the table doesn't tear down the open editor
	// on every keystroke; this is the catch-up.
	useEffect( () => {
		return () => {
			if ( dirtyRef.current && recordId ) {
				flush( recordId );
			}
		};
	}, [ flush, recordId ] );

	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 4 } } )
	);

	const isPickMode = typeof onPick === 'function';
	const isMultiselect = fieldType === 'multiselect';

	useEffect( () => {
		if ( ! openMenuValue || typeof onRequestClose !== 'function' ) {
			return undefined;
		}
		const onPointerDown = ( event ) => {
			const target = event.target;
			if ( ! target || typeof target.closest !== 'function' ) {
				return;
			}
			if (
				popoverRef.current?.contains( target ) ||
				target.closest( '.cortext-edit-options-popover__submenu' )
			) {
				return;
			}
			onRequestClose();
		};
		document.addEventListener( 'pointerdown', onPointerDown, true );
		return () =>
			document.removeEventListener( 'pointerdown', onPointerDown, true );
	}, [ onRequestClose, openMenuValue ] );

	const selectedValues = useMemo( () => {
		if ( ! isPickMode ) {
			return new Set();
		}
		if ( Array.isArray( value ) ) {
			return new Set( value );
		}
		if ( value === null || value === undefined || value === '' ) {
			return new Set();
		}
		return new Set( [ value ] );
	}, [ isPickMode, value ] );

	const commit = useCallback(
		async ( nextOptions, migration ) => {
			setOptions( nextOptions );
			const migrations = migration ? [ migration ] : undefined;
			try {
				const result = await update.run(
					recordId,
					nextOptions,
					migrations
				);
				dirtyRef.current = true;
				const savedOptions = Array.isArray( result?.options )
					? result.options
					: nextOptions;
				onOptionsSaved?.( savedOptions );
				if ( migration ) {
					onRowsChanged?.();
				}
				return true;
			} catch {
				// surfaced via update.error.
				return false;
			}
		},
		[ onOptionsSaved, onRowsChanged, recordId, update ]
	);

	const handleLabelChange = ( optionValue, label ) => {
		const next = options.map( ( o ) =>
			o.value === optionValue ? { ...o, label } : o
		);
		commit( next );
	};

	const handleColorChange = async ( optionValue, color ) => {
		const next = options.map( ( o ) => {
			if ( o.value !== optionValue ) {
				return o;
			}
			if ( ! color || ! isOptionColorName( color ) ) {
				const cleared = { ...o };
				delete cleared.color;
				return cleared;
			}
			return { ...o, color };
		} );
		await commit( next );
	};

	const handleAdd = async ( rawLabel ) => {
		const label = ( rawLabel ?? search ).trim();
		if ( ! label ) {
			return null;
		}
		const taken = options.map( ( o ) => o.value );
		const newValue = uniqueValue( slugify( label ), taken );
		const color = pickNextOptionColor( options );
		const created = { value: newValue, label, color };
		const didSave = await commit( [ ...options, created ] );
		if ( ! didSave ) {
			setOptions( options );
			return null;
		}
		setSearch( '' );
		return created;
	};

	const handleDragEnd = ( event ) => {
		const { active, over } = event;
		if ( ! over || active.id === over.id ) {
			return;
		}
		const from = options.findIndex( ( o ) => o.value === active.id );
		const to = options.findIndex( ( o ) => o.value === over.id );
		if ( from < 0 || to < 0 ) {
			return;
		}
		commit( arrayMove( options, from, to ) );
	};

	const handleDeleteRequest = ( option ) => {
		setOpenMenuValue( null );
		setDeleting( option );
	};

	const remainingForReplacement = useMemo(
		() =>
			deleting
				? options.filter( ( o ) => o.value !== deleting.value )
				: [],
		[ deleting, options ]
	);

	const handleDeleteConfirm = async ( migration ) => {
		const target = deleting;
		const next = options.filter( ( o ) => o.value !== target.value );
		const didSave = await commit( next, migration );
		if ( didSave ) {
			setDeleting( null );
		}
	};

	const sortableIds = useMemo(
		() => options.map( ( o ) => o.value ),
		[ options ]
	);

	const trimmedSearch = search.trim();
	const lowerSearch = trimmedSearch.toLowerCase();
	const filteredOptions = useMemo( () => {
		if ( ! trimmedSearch ) {
			return options;
		}
		return options.filter( ( o ) =>
			String( o.label ).toLowerCase().includes( lowerSearch )
		);
	}, [ options, trimmedSearch, lowerSearch ] );
	const exactMatch = useMemo(
		() =>
			options.find(
				( o ) => String( o.label ).toLowerCase() === lowerSearch
			),
		[ options, lowerSearch ]
	);
	const canCreate = trimmedSearch && ! exactMatch;
	const previewColor = useMemo(
		() => ( canCreate ? pickNextOptionColor( options ) : null ),
		[ canCreate, options ]
	);
	const selectedOptions = useMemo( () => {
		if ( ! isPickMode || selectedValues.size === 0 ) {
			return [];
		}
		// Preserve the cell's value order rather than the option list's
		// order so newly toggled chips appear at the end where the user
		// last interacted.
		const ordered =
			Array.isArray( value ) && value.length
				? value
				: [ ...selectedValues ];
		return ordered.map( ( v ) => {
			const found = options.find( ( o ) => o.value === v );
			return found ?? { value: v, label: String( v ), color: 'default' };
		} );
	}, [ isPickMode, selectedValues, value, options ] );

	const handleRemoveSelected = ( optionValue ) => {
		if ( isMultiselect ) {
			onPick( optionValue );
		} else {
			onPick( null );
		}
	};

	const inputPrompt = isPickMode
		? __( 'Search or create option', 'cortext' )
		: __( 'Add option', 'cortext' );

	const handleCreateAndPick = async () => {
		const created = await handleAdd();
		if ( isPickMode && created?.value ) {
			await onPick( created.value );
		}
	};

	const handlePickExisting = async ( optionValue ) => {
		await onPick( optionValue );
	};

	return (
		<div className="cortext-edit-options-popover" ref={ popoverRef }>
			{ update.error ? (
				<Notice status="error" isDismissible={ false }>
					{ update.error?.message ||
						__( 'Could not save options.', 'cortext' ) }
				</Notice>
			) : null }
			<div
				className={
					'cortext-edit-options-popover__token-input' +
					( selectedOptions.length === 0 ? ' is-empty' : '' )
				}
				onPointerDown={ ( event ) => {
					if ( event.target === event.currentTarget ) {
						searchInputRef.current?.focus();
					}
				} }
			>
				{ selectedOptions.map( ( opt ) => (
					<Chip
						key={ opt.value }
						label={ opt.label }
						color={ opt.color }
						onRemove={ () => handleRemoveSelected( opt.value ) }
					/>
				) ) }
				<input
					ref={ searchInputRef }
					type="text"
					className="cortext-edit-options-popover__token-input-field"
					value={ search }
					placeholder={
						selectedOptions.length > 0 ? '' : inputPrompt
					}
					aria-label={ inputPrompt }
					onChange={ ( event ) => setSearch( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && canCreate ) {
							event.preventDefault();
							if ( isPickMode ) {
								handleCreateAndPick();
							} else {
								handleAdd();
							}
							return;
						}
						if (
							event.key === 'Backspace' &&
							search === '' &&
							selectedOptions.length > 0
						) {
							event.preventDefault();
							handleRemoveSelected(
								selectedOptions[ selectedOptions.length - 1 ]
									.value
							);
						}
					} }
				/>
			</div>
			{ filteredOptions.length === 0 && ! canCreate ? (
				<p className="cortext-edit-options-popover__empty">
					{ trimmedSearch
						? __( 'No matching options.', 'cortext' )
						: __( 'No options yet.', 'cortext' ) }
				</p>
			) : (
				<DndContext
					sensors={ sensors }
					collisionDetection={ closestCenter }
					onDragEnd={ handleDragEnd }
				>
					<SortableContext
						items={ sortableIds }
						strategy={ verticalListSortingStrategy }
					>
						<div className="cortext-edit-options-popover__list">
							{ filteredOptions.map( ( option ) => (
								<SortableOptionRow
									key={ option.value }
									option={ option }
									isSelected={ selectedValues.has(
										option.value
									) }
									isMenuOpen={
										openMenuValue === option.value
									}
									onPick={
										isPickMode
											? () =>
													handlePickExisting(
														option.value
													)
											: undefined
									}
									onToggleMenu={ () =>
										setOpenMenuValue( ( prev ) =>
											prev === option.value
												? null
												: option.value
										)
									}
									onCloseMenu={ () =>
										setOpenMenuValue( ( prev ) =>
											prev === option.value ? null : prev
										)
									}
									onLabelChange={ ( label ) =>
										handleLabelChange( option.value, label )
									}
									onColorChange={ ( color ) =>
										handleColorChange( option.value, color )
									}
									onDelete={ () =>
										handleDeleteRequest( option )
									}
								/>
							) ) }
						</div>
					</SortableContext>
				</DndContext>
			) }
			{ canCreate ? (
				<MenuGroup>
					<MenuItem
						className="cortext-edit-options-popover__create"
						onClick={
							isPickMode ? handleCreateAndPick : () => handleAdd()
						}
					>
						<span className="cortext-edit-options-popover__create-label">
							{ __( 'Create', 'cortext' ) }
						</span>
						<Chip label={ trimmedSearch } color={ previewColor } />
					</MenuItem>
				</MenuGroup>
			) : null }
			{ deleting ? (
				<DeleteOptionDialog
					recordId={ recordId }
					option={ deleting }
					remainingOptions={ remainingForReplacement }
					onConfirm={ handleDeleteConfirm }
					onCancel={ () => setDeleting( null ) }
				/>
			) : null }
		</div>
	);
}
