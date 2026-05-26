import { Button, Icon } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { dragHandle, seen, unseen } from '@wordpress/icons';
import { useMemo } from '@wordpress/element';
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';

function transformToString( transform ) {
	if ( ! transform ) {
		return undefined;
	}
	const { x = 0, y = 0, scaleX = 1, scaleY = 1 } = transform;
	return `translate3d(${ x }px, ${ y }px, 0) scaleX(${ scaleX }) scaleY(${ scaleY })`;
}

function SortableDetailField( { field, visible, onToggle } ) {
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable( { id: field.id } );
	const style = {
		transform: transformToString( transform ),
		transition,
	};

	return (
		<div
			ref={ setNodeRef }
			style={ style }
			className={
				'cortext-detail-layout-editor__row' +
				( visible ? '' : ' is-hidden' )
			}
		>
			<div className="cortext-detail-layout-editor__label">
				<span className="cortext-detail-layout-editor__handle-slot">
					<button
						type="button"
						className="cortext-detail-layout-editor__handle"
						aria-label={ __( 'Reorder property', 'cortext' ) }
						{ ...attributes }
						{ ...listeners }
					>
						<Icon icon={ dragHandle } size={ 16 } />
					</button>
				</span>
				<span className="cortext-detail-layout-editor__label-text">
					{ field.label }
				</span>
			</div>
			<div className="cortext-detail-layout-editor__value">
				<Button
					className="cortext-detail-layout-editor__visibility"
					icon={ visible ? seen : unseen }
					label={
						visible
							? __( 'Hide property', 'cortext' )
							: __( 'Show property', 'cortext' )
					}
					isPressed={ visible }
					size="small"
					variant="tertiary"
					onClick={ onToggle }
				/>
			</div>
		</div>
	);
}

export default function DetailLayoutEditor( { entries, fields, onChange } ) {
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 4 } } ),
		useSensor( KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		} )
	);
	const safeEntries = useMemo(
		() => ( Array.isArray( entries ) ? entries : [] ),
		[ entries ]
	);
	const fieldsById = useMemo(
		() =>
			new Map( ( fields ?? [] ).map( ( field ) => [ field.id, field ] ) ),
		[ fields ]
	);
	const rows = useMemo(
		() =>
			safeEntries
				.map( ( entry ) => ( {
					entry,
					field: fieldsById.get( entry.field ),
				} ) )
				.filter( ( row ) => row.field ),
		[ safeEntries, fieldsById ]
	);
	const sortableIds = rows.map( ( row ) => row.entry.field );

	const handleDragEnd = ( event ) => {
		const { active, over } = event;
		if ( ! over || active.id === over.id ) {
			return;
		}
		const from = safeEntries.findIndex(
			( entry ) => entry.field === active.id
		);
		const to = safeEntries.findIndex(
			( entry ) => entry.field === over.id
		);
		if ( from < 0 || to < 0 ) {
			return;
		}
		onChange( arrayMove( safeEntries, from, to ) );
	};

	const toggleVisibility = ( fieldId ) => {
		onChange(
			safeEntries.map( ( entry ) =>
				entry.field === fieldId
					? { ...entry, visible: ! entry.visible }
					: entry
			)
		);
	};

	if ( rows.length === 0 ) {
		return (
			<p className="cortext-detail-layout-editor__empty">
				{ __( 'No properties to show.', 'cortext' ) }
			</p>
		);
	}

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ closestCenter }
			onDragEnd={ handleDragEnd }
		>
			<SortableContext
				items={ sortableIds }
				strategy={ verticalListSortingStrategy }
			>
				<div className="cortext-detail-layout-editor">
					{ rows.map( ( row ) => (
						<SortableDetailField
							key={ row.entry.field }
							field={ row.field }
							visible={ row.entry.visible }
							onToggle={ () =>
								toggleVisibility( row.entry.field )
							}
						/>
					) ) }
				</div>
			</SortableContext>
		</DndContext>
	);
}
