import { __ } from '@wordpress/i18n';
import { BlockControls, useBlockProps } from '@wordpress/block-editor';
import {
	Button,
	Dropdown,
	Notice,
	Placeholder,
	Spinner,
	TextControl,
	ToolbarButton,
} from '@wordpress/components';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useCallback, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { plus, replace } from '@wordpress/icons';

import CollectionDataViews from '../../components/CollectionDataViews';
import AddFieldPopover from '../../components/fields/AddFieldPopover';
import { COLLECTION_QUERY } from '../../collections';

function createDefaultView() {
	return {
		type: 'table',
		fields: [],
		sort: null,
		filters: [],
		perPage: 25,
		page: 1,
		search: '',
		layout: { density: 'compact' },
		rowDetailMode: 'side',
	};
}

function CollectionPicker( { selectedId = '', onSelect } ) {
	const { records, isResolving, hasResolved } = useEntityRecords(
		'postType',
		'crtxt_collection',
		COLLECTION_QUERY
	);

	const hasCollections = Boolean( records?.length );

	if ( isResolving && ! hasCollections ) {
		return <Spinner />;
	}

	if ( hasResolved && ! hasCollections ) {
		return (
			<p className="cortext-data-view-picker__empty">
				{ __( 'No collections yet.', 'cortext' ) }
			</p>
		);
	}

	return (
		<div className="cortext-collection-chooser">
			{ /* TODO: Add search once collection lists are long enough to make scanning noisy. */ }
			{ ( records ?? [] ).map( ( collection ) => {
				const title =
					collection.title?.rendered ||
					collection.title?.raw ||
					`#${ collection.id }`;
				const isSelected =
					selectedId && Number( selectedId ) === collection.id;

				return (
					<Button
						key={ collection.id }
						className="cortext-collection-chooser__item"
						variant={ isSelected ? 'secondary' : 'tertiary' }
						isPressed={ isSelected }
						onClick={ () => onSelect( collection.id ) }
					>
						{ title }
					</Button>
				);
			} ) }
		</div>
	);
}

function CollectionCreator( { onCreate } ) {
	const [ title, setTitle ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( '' );
	const { invalidateResolution } = useDispatch( 'core' );
	const canCreate = title.trim() && ! isSaving;

	const createCollection = async () => {
		if ( ! canCreate ) {
			return;
		}

		setIsSaving( true );
		setError( '' );

		try {
			const collection = await apiFetch( {
				path: '/cortext/v1/collections',
				method: 'POST',
				data: {
					title: title.trim(),
				},
			} );
			invalidateResolution( 'getEntityRecords', [
				'postType',
				'crtxt_collection',
				COLLECTION_QUERY,
			] );
			onCreate( collection );
		} catch ( apiError ) {
			setError(
				apiError?.message ||
					__( 'Collection could not be created.', 'cortext' )
			);
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<div className="cortext-data-view-create">
			{ error ? (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) : null }
			<TextControl
				label={ __( 'Name', 'cortext' ) }
				value={ title }
				onChange={ setTitle }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<Button
				variant="primary"
				onClick={ createCollection }
				isBusy={ isSaving }
				disabled={ ! canCreate }
			>
				{ __( 'Create collection', 'cortext' ) }
			</Button>
		</div>
	);
}

function CollectionToolbarControl( { collectionId, onSelect } ) {
	const { record: collection, isResolving } = useEntityRecord(
		'postType',
		'crtxt_collection',
		collectionId ?? 0
	);

	const isCollectionValid = ! isResolving && collectionId && collection;

	return (
		<BlockControls group="other">
			<Dropdown
				contentClassName="cortext-data-view-toolbar-popover"
				popoverProps={ { placement: 'bottom-start' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<ToolbarButton
						icon={ replace }
						label={ __( 'Change collection', 'cortext' ) }
						onClick={ onToggle }
						isPressed={ isOpen }
					/>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cortext-data-view-toolbar-popover__content">
						<CollectionPicker
							selectedId={ collectionId }
							onSelect={ ( id ) => {
								onSelect( id );
								onClose();
							} }
						/>
					</div>
				) }
			/>
			{ isCollectionValid && (
				<Dropdown
					contentClassName="cortext-data-view-toolbar-popover"
					popoverProps={ { placement: 'bottom-start' } }
					renderToggle={ ( { isOpen, onToggle } ) => (
						<ToolbarButton
							icon={ plus }
							label={ __( 'Add field', 'cortext' ) }
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
			) }
		</BlockControls>
	);
}

export default function Edit( { attributes, setAttributes } ) {
	const { collectionId, view } = attributes;
	const blockProps = useBlockProps();

	const setView = useCallback(
		( next ) => setAttributes( { view: next } ),
		[ setAttributes ]
	);

	const selectCollection = useCallback(
		( id ) =>
			setAttributes( { collectionId: id, view: createDefaultView() } ),
		[ setAttributes ]
	);

	if ( ! collectionId ) {
		return (
			<div { ...blockProps }>
				<Placeholder
					label={ __( 'Collection view', 'cortext' ) }
					instructions={ __(
						'Pick a collection to display.',
						'cortext'
					) }
				>
					<CollectionPicker onSelect={ selectCollection } />
					<div className="cortext-data-view-placeholder__create">
						<CollectionCreator
							onCreate={ ( collection ) =>
								selectCollection( collection.id )
							}
						/>
					</div>
				</Placeholder>
			</div>
		);
	}

	return (
		<div { ...blockProps }>
			<CollectionToolbarControl
				collectionId={ collectionId }
				onSelect={ ( id ) => {
					if ( id !== collectionId ) {
						selectCollection( id );
					}
				} }
			/>
			<CollectionDataViews
				collectionId={ collectionId }
				view={ view }
				onChangeView={ setView }
				loading={ <Spinner /> }
				invalid={
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'This collection is no longer available. Choose another collection.',
							'cortext'
						) }
					</Notice>
				}
				error={
					<Notice status="error" isDismissible={ false }>
						{ __(
							'Collection rows could not be loaded.',
							'cortext'
						) }
					</Notice>
				}
			/>
		</div>
	);
}
