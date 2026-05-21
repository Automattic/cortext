import { __ } from '@wordpress/i18n';
import {
	BlockControls,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControl as ToggleGroupControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControlOptionIcon as ToggleGroupControlOptionIcon,
	Button,
	CheckboxControl,
	Dropdown,
	Notice,
	PanelBody,
	Placeholder,
	SelectControl,
	Spinner,
	TextControl,
	ToolbarButton,
} from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useState } from '@wordpress/element';
import { store as interfaceStore } from '@wordpress/interface';
import apiFetch from '@wordpress/api-fetch';
import { cog, plus, replace } from '@wordpress/icons';

import CollectionDataViews from '../../components/CollectionDataViews';
import AddFieldPopover from '../../components/fields/AddFieldPopover';
import { FULL_PAGE_COLLECTION_QUERY } from '../../collections';
import { toDataViewId } from '../../hooks/fieldIds';
import {
	CollectionFieldsProvider,
	useCollectionFieldsContext,
} from '../../components/CollectionFieldsContext';
import { GHOST_FIELD_ID } from '../../components/dataViewColumns';
import {
	DEFAULT_ROW_DETAIL_MODE,
	ROW_DETAIL_MODES,
} from '../../components/rowDetailUtils';
import {
	ROW_DETAIL_MODE_ICONS,
	ROW_DETAIL_MODE_LABELS,
} from '../../components/RowDetailView';

const DENSITY_OPTIONS = [
	{ value: 'compact', label: __( 'Compact', 'cortext' ) },
	{ value: 'balanced', label: __( 'Balanced', 'cortext' ) },
	{ value: 'comfortable', label: __( 'Comfortable', 'cortext' ) },
];

const PER_PAGE_OPTIONS = [
	{ value: '10', label: '10' },
	{ value: '25', label: '25' },
	{ value: '50', label: '50' },
	{ value: '100', label: '100' },
];

// The empty string is intentional. `undefined` would be dropped from the
// block comment, and the `wide` default would come back on the next parse.
const WIDTH_OPTIONS = [
	{ value: '', label: __( 'Default', 'cortext' ) },
	{ value: 'wide', label: __( 'Wide', 'cortext' ) },
	{ value: 'full', label: __( 'Full', 'cortext' ) },
];

const ROW_DETAIL_OPTIONS = ROW_DETAIL_MODES.map( ( mode ) => ( {
	value: mode,
	label: ROW_DETAIL_MODE_LABELS[ mode ],
} ) );

function createDefaultView() {
	return {
		type: 'table',
		fields: [],
		sort: null,
		filters: [],
		calculations: {},
		perPage: 25,
		page: 1,
		search: '',
		layout: { density: 'compact' },
		rowDetailMode: 'side',
	};
}

function CollectionPicker( { selectedId = '', onSelect } ) {
	// The picker only offers full-page collections. Inline collections belong
	// to the block that created them.
	const { records, isResolving, hasResolved } = useEntityRecords(
		'postType',
		'crtxt_collection',
		FULL_PAGE_COLLECTION_QUERY
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
	const [ isFullPage, setIsFullPage ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( '' );
	const { invalidateResolution } = useDispatch( 'core' );
	const canCreate = title.trim() && ! isSaving;

	// Inline collections need the current page as their owner. Full-page
	// collections can use the same id as a sidebar parent.
	const ownerPageId = useSelect(
		( select ) => select( editorStore ).getCurrentPostId(),
		[]
	);

	const createCollection = async () => {
		if ( ! canCreate ) {
			return;
		}

		setIsSaving( true );
		setError( '' );

		try {
			const data = {
				title: title.trim(),
				mode: isFullPage ? 'full_page' : 'inline',
			};
			// The server handles `parent` by mode: inline owner meta for
			// inline collections, post_parent for full-page collections.
			if ( ownerPageId ) {
				data.parent = ownerPageId;
			}
			const collection = await apiFetch( {
				path: '/cortext/v1/collections',
				method: 'POST',
				data,
			} );
			// The picker reads the full-page query, so refresh it only when
			// the new collection will show there.
			if ( isFullPage ) {
				invalidateResolution( 'getEntityRecords', [
					'postType',
					'crtxt_collection',
					FULL_PAGE_COLLECTION_QUERY,
				] );
			}
			// tech-debt.md#2: core-data may have cached `/wp/v2/types` before
			// this collection registered its row CPT. Refresh the entity config
			// so the next row detail lookup can find the new post type.
			invalidateResolution( 'getEntitiesConfig', [ 'postType' ] );
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
			<CheckboxControl
				label={ __( 'Create as a full-page collection', 'cortext' ) }
				help={ __(
					'Full-page collections show in the sidebar and get their own workspace URL. Inline collections stay in this block.',
					'cortext'
				) }
				checked={ isFullPage }
				onChange={ setIsFullPage }
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

function CollectionToolbarControl( {
	collectionId,
	onSelect,
	onFieldCreated,
} ) {
	const { collection, isResolving } = useCollectionFieldsContext();
	const { enableComplementaryArea } = useDispatch( interfaceStore );

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
								onCreate={ ( created ) => {
									onFieldCreated?.( created );
									onClose();
								} }
							/>
						</div>
					) }
				/>
			) }
			<ToolbarButton
				icon={ cog }
				label={ __( 'View settings', 'cortext' ) }
				onClick={ () =>
					enableComplementaryArea(
						'cortext',
						'cortext/block-inspector'
					)
				}
			/>
		</BlockControls>
	);
}

function CollectionInspectorControls( {
	collectionId,
	view,
	align,
	onSelect,
	onChangeView,
	onChangeAlign,
	onFieldCreated,
} ) {
	const {
		fields: availableFields,
		collection,
		isResolving,
	} = useCollectionFieldsContext();
	const isCollectionValid = ! isResolving && collectionId && collection;
	const visibleFieldIds = view?.fields ?? [];

	// Checked fields follow the table order. Unchecked fields keep schema order.
	const visibleFieldsInOrder = visibleFieldIds
		.map( ( id ) => availableFields.find( ( f ) => f.id === id ) )
		.filter( Boolean );
	const visibleIdSet = new Set( visibleFieldsInOrder.map( ( f ) => f.id ) );
	const hiddenFields = availableFields.filter(
		( f ) => ! visibleIdSet.has( f.id )
	);
	const orderedFields = [ ...visibleFieldsInOrder, ...hiddenFields ];

	const toggleFieldVisibility = ( fieldId, isVisible ) => {
		const hasGhost = visibleFieldIds.includes( GHOST_FIELD_ID );
		const stripped = visibleFieldIds.filter(
			( id ) => id !== GHOST_FIELD_ID && id !== fieldId
		);
		let nextFields;
		if ( isVisible ) {
			// Put the field back near its schema neighbors. Prefer the previous
			// visible field; for the first field, use the next visible one.
			const schemaIdx = availableFields.findIndex(
				( f ) => f.id === fieldId
			);
			let insertAt = -1;
			for ( let i = schemaIdx - 1; i >= 0; i-- ) {
				const idx = stripped.indexOf( availableFields[ i ].id );
				if ( idx >= 0 ) {
					insertAt = idx + 1;
					break;
				}
			}
			if ( insertAt === -1 ) {
				for ( let i = schemaIdx + 1; i < availableFields.length; i++ ) {
					const idx = stripped.indexOf( availableFields[ i ].id );
					if ( idx >= 0 ) {
						insertAt = idx;
						break;
					}
				}
			}
			if ( insertAt === -1 ) {
				insertAt = stripped.length;
			}
			nextFields = [
				...stripped.slice( 0, insertAt ),
				fieldId,
				...stripped.slice( insertAt ),
			];
		} else {
			nextFields = stripped;
		}
		if ( hasGhost ) {
			nextFields = [ ...nextFields, GHOST_FIELD_ID ];
		}
		onChangeView( { ...view, fields: nextFields } );
	};

	return (
		<InspectorControls>
			<PanelBody title={ __( 'Collection', 'cortext' ) }>
				<Dropdown
					contentClassName="cortext-data-view-toolbar-popover"
					popoverProps={ { placement: 'left-start' } }
					renderToggle={ ( { isOpen, onToggle } ) => (
						<Button
							variant="secondary"
							icon={ replace }
							onClick={ onToggle }
							aria-expanded={ isOpen }
							__next40pxDefaultSize
						>
							{ __( 'Change collection', 'cortext' ) }
						</Button>
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
			</PanelBody>
			<PanelBody
				title={ __( 'Fields', 'cortext' ) }
				initialOpen={ false }
			>
				{ isCollectionValid && (
					<>
						<Dropdown
							contentClassName="cortext-data-view-toolbar-popover"
							popoverProps={ { placement: 'left-start' } }
							renderToggle={ ( { isOpen, onToggle } ) => (
								<Button
									variant="secondary"
									icon={ plus }
									onClick={ onToggle }
									aria-expanded={ isOpen }
									__next40pxDefaultSize
								>
									{ __( 'Add field', 'cortext' ) }
								</Button>
							) }
							renderContent={ ( { onClose } ) => (
								<div className="cortext-data-view-toolbar-popover__content">
									<AddFieldPopover
										collectionId={ collectionId }
										onCreate={ ( created ) => {
											onFieldCreated?.( created );
											onClose();
										} }
									/>
								</div>
							) }
						/>
						{ orderedFields.length > 0 && (
							<ul className="cortext-data-view-field-visibility">
								{ orderedFields.map( ( field ) => (
									<li key={ field.id }>
										<CheckboxControl
											label={ field.label }
											checked={ visibleFieldIds.includes(
												field.id
											) }
											onChange={ ( isVisible ) =>
												toggleFieldVisibility(
													field.id,
													isVisible
												)
											}
											__nextHasNoMarginBottom
										/>
									</li>
								) ) }
							</ul>
						) }
					</>
				) }
			</PanelBody>
			<PanelBody title={ __( 'View', 'cortext' ) } initialOpen={ false }>
				{ isCollectionValid && (
					<>
						<ToggleGroupControl
							label={ __( 'Width', 'cortext' ) }
							value={ align ?? '' }
							onChange={ onChangeAlign }
							isBlock
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						>
							{ WIDTH_OPTIONS.map( ( option ) => (
								<ToggleGroupControlOption
									key={ option.value || 'default' }
									value={ option.value }
									label={ option.label }
								/>
							) ) }
						</ToggleGroupControl>
						<SelectControl
							label={ __( 'Density', 'cortext' ) }
							value={ view?.layout?.density ?? 'compact' }
							options={ DENSITY_OPTIONS }
							onChange={ ( density ) =>
								onChangeView( {
									...view,
									layout: {
										...( view?.layout ?? {} ),
										density,
									},
								} )
							}
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
						<SelectControl
							label={ __( 'Rows per page', 'cortext' ) }
							value={ String( view?.perPage ?? 25 ) }
							options={ PER_PAGE_OPTIONS }
							onChange={ ( perPage ) =>
								onChangeView( {
									...view,
									perPage: Number( perPage ),
									page: 1,
								} )
							}
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
						<ToggleGroupControl
							label={ __( 'Row detail', 'cortext' ) }
							value={
								view?.rowDetailMode ?? DEFAULT_ROW_DETAIL_MODE
							}
							onChange={ ( rowDetailMode ) =>
								onChangeView( { ...view, rowDetailMode } )
							}
							isBlock
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						>
							{ ROW_DETAIL_OPTIONS.map( ( option ) => (
								<ToggleGroupControlOptionIcon
									key={ option.value }
									value={ option.value }
									label={ option.label }
									icon={
										ROW_DETAIL_MODE_ICONS[ option.value ]
									}
								/>
							) ) }
						</ToggleGroupControl>
					</>
				) }
			</PanelBody>
		</InspectorControls>
	);
}

export default function Edit( { attributes, setAttributes } ) {
	const { collectionId, view, align } = attributes;
	const blockProps = useBlockProps();
	const [ revealFieldId, setRevealFieldId ] = useState( null );

	const setView = useCallback(
		( next ) => setAttributes( { view: next } ),
		[ setAttributes ]
	);

	const setAlign = useCallback(
		( next ) => setAttributes( { align: next } ),
		[ setAttributes ]
	);

	const selectCollection = useCallback(
		( id ) =>
			setAttributes( { collectionId: id, view: createDefaultView() } ),
		[ setAttributes ]
	);

	const onSelectCollection = ( id ) => {
		if ( id !== collectionId ) {
			setRevealFieldId( null );
			selectCollection( id );
		}
	};

	const onFieldCreated = useCallback( ( created ) => {
		const fieldId = toDataViewId( created?.id );
		if ( fieldId ) {
			setRevealFieldId( fieldId );
		}
	}, [] );

	const onFieldRevealed = useCallback( ( fieldId ) => {
		setRevealFieldId( ( current ) =>
			current === fieldId ? null : current
		);
	}, [] );

	if ( ! collectionId ) {
		return (
			<div { ...blockProps }>
				<InspectorControls>
					<PanelBody title={ __( 'Collection', 'cortext' ) }>
						<CollectionPicker onSelect={ selectCollection } />
					</PanelBody>
				</InspectorControls>
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
		<CollectionFieldsProvider collectionId={ collectionId }>
			<div { ...blockProps }>
				<CollectionToolbarControl
					collectionId={ collectionId }
					onSelect={ onSelectCollection }
					onFieldCreated={ onFieldCreated }
				/>
				<CollectionInspectorControls
					collectionId={ collectionId }
					view={ view }
					align={ align }
					onSelect={ onSelectCollection }
					onChangeView={ setView }
					onChangeAlign={ setAlign }
					onFieldCreated={ onFieldCreated }
				/>
				<CollectionDataViews
					collectionId={ collectionId }
					view={ view }
					onChangeView={ setView }
					revealFieldId={ revealFieldId }
					onFieldRevealed={ onFieldRevealed }
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
		</CollectionFieldsProvider>
	);
}
