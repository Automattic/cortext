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
	SearchControl,
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
import { cog, link, plus, replace, table } from '@wordpress/icons';

import CanvasOwnerInspector, {
	useIsCanvasOwnerBlock,
} from '../../components/CanvasOwnerInspector';
import { useCanvasReadySignals } from '../../components/CanvasReadyContext';
import CollectionDataViews from '../../components/CollectionDataViews';
import AddFieldPopover from '../../components/fields/AddFieldPopover';
import { useEditorSurface } from '../../components/EditorSurfaceContext';
import {
	DOCUMENT_POST_TYPE,
	FULL_PAGE_COLLECTION_QUERY,
} from '../../collections';
import { useCreateCollectionDocument } from '../../documents';
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
import { DEFAULT_GRID_PREVIEW_SIZE } from '../../components/dataViewAdapter';
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
		layoutByType: {
			table: { density: 'compact' },
			grid: { previewSize: DEFAULT_GRID_PREVIEW_SIZE },
			list: {},
		},
		fieldsByType: {
			grid: [],
			list: [],
		},
		rowDetailMode: 'side',
	};
}

function CollectionPicker( { selectedId = '', onSelect } ) {
	// Every document that defines a schema (has `cortext_fields` meta).
	const { records, isResolving, hasResolved } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		FULL_PAGE_COLLECTION_QUERY
	);
	const [ query, setQuery ] = useState( '' );

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

	const collectionTitle = ( collection ) =>
		collection.title?.rendered ||
		collection.title?.raw ||
		`#${ collection.id }`;
	const needle = query.trim().toLowerCase();
	const matches = needle
		? ( records ?? [] ).filter( ( collection ) =>
				collectionTitle( collection ).toLowerCase().includes( needle )
		  )
		: records ?? [];

	return (
		<div className="cortext-collection-chooser">
			<SearchControl
				__nextHasNoMarginBottom
				className="cortext-collection-chooser__search"
				value={ query }
				onChange={ setQuery }
				placeholder={ __( 'Search collections', 'cortext' ) }
			/>
			{ matches.length === 0 ? (
				<p className="cortext-data-view-picker__empty">
					{ __( 'No collections match your search.', 'cortext' ) }
				</p>
			) : (
				matches.map( ( collection ) => {
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
							{ collectionTitle( collection ) }
						</Button>
					);
				} )
			) }
		</div>
	);
}

function CollectionCreator( { onCreate } ) {
	const [ title, setTitle ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( '' );
	const create = useCreateCollectionDocument();
	const canCreate = title.trim() && ! isSaving;

	// Nest the new collection under the current page so it appears beneath it
	// in the sidebar tree, matching how the user got here.
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
			const collection = await create( {
				title: title.trim(),
				status: 'private',
				...( ownerPageId ? { parent: ownerPageId } : {} ),
			} );
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

function CollectionToolbarControl( {
	collectionId,
	isOwner,
	onSelect,
	onFieldCreated,
} ) {
	const { collection, isResolving } = useCollectionFieldsContext();
	const { hasBlockInspector } = useEditorSurface();
	const { enableComplementaryArea } = useDispatch( interfaceStore );

	const isCollectionValid = ! isResolving && collectionId && collection;

	return (
		<BlockControls group="other">
			{ ! isOwner && (
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
			) }
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
			{ /* tech-debt.md#td-row-detail-toolbar-isolation: peek/modal hide the parent inspector
			     button until there is a row-scoped one. Owner blocks open
			     the document tab, where their panels are slotted. */ }
			{ ( hasBlockInspector || isOwner ) && (
				<ToolbarButton
					icon={ cog }
					label={ __( 'View settings', 'cortext' ) }
					onClick={ () =>
						enableComplementaryArea(
							'cortext',
							isOwner
								? 'cortext/document-inspector'
								: 'cortext/block-inspector'
						)
					}
				/>
			) }
		</BlockControls>
	);
}

function CollectionInspectorControls( {
	collectionId,
	view,
	align,
	isOwner,
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
	const activeLayoutType = view?.type ?? 'table';
	const activeLayout = {
		...( view?.layoutByType?.[ activeLayoutType ] ?? {} ),
		...( view?.layout ?? {} ),
	};
	const defaultDensity =
		activeLayoutType === 'table' ? 'compact' : 'balanced';
	const showDensityControl = [ 'table', 'grid' ].includes( activeLayoutType );

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

	// When the data-view owns a collection canvas, its panels move to the
	// document tab, it cannot switch collections, and Canvas owns the width.
	const Wrapper = isOwner ? CanvasOwnerInspector : InspectorControls;
	const fieldsPanelInitialOpen = isOwner;

	return (
		<Wrapper>
			{ ! isOwner && (
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
			) }
			<PanelBody
				title={ __( 'Fields', 'cortext' ) }
				initialOpen={ fieldsPanelInitialOpen }
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
						{ ! isOwner && (
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
						) }
						{ showDensityControl && (
							<SelectControl
								label={ __( 'Density', 'cortext' ) }
								value={ activeLayout.density ?? defaultDensity }
								options={ DENSITY_OPTIONS }
								onChange={ ( density ) =>
									onChangeView( {
										...view,
										layout: {
											...( view?.layout ?? {} ),
											density,
										},
										layoutByType: {
											...( view?.layoutByType ?? {} ),
											[ activeLayoutType ]: {
												...activeLayout,
												density,
											},
										},
									} )
								}
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
						) }
						<SelectControl
							label={ __( 'Per page', 'cortext' ) }
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
							label={ __( 'Detail view', 'cortext' ) }
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
		</Wrapper>
	);
}

export default function Edit( {
	attributes,
	clientId,
	context,
	setAttributes,
} ) {
	const { collectionId, view, align, intent } = attributes;
	const isOwner = useIsCanvasOwnerBlock(
		clientId,
		context?.postType,
		context?.postId
	);
	const { signalCollectionReady } = useCanvasReadySignals();
	const blockProps = useBlockProps( {
		className: isOwner ? 'is-document-owner' : undefined,
	} );
	const [ revealFieldId, setRevealFieldId ] = useState( null );

	const setView = useCallback(
		( next ) => setAttributes( { view: next } ),
		[ setAttributes ]
	);

	const setAlign = useCallback(
		( next ) => setAttributes( { align: next } ),
		[ setAttributes ]
	);

	// The inserter variations stamp a transient `intent` to open the placeholder
	// in create or link mode. Clear it once a collection is bound so resolved
	// blocks only persist `collectionId` + `view`; until then it rides in the
	// attributes and survives remounts (the canvas reconciles blocks on load),
	// keeping the chosen mode.
	const selectCollection = useCallback(
		( id ) =>
			setAttributes( {
				collectionId: id,
				view: createDefaultView(),
				intent: undefined,
			} ),
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

	const onCollectionReady = useCallback(
		( readyCollectionId ) => {
			if ( isOwner ) {
				signalCollectionReady?.( readyCollectionId );
			}
		},
		[ isOwner, signalCollectionReady ]
	);

	if ( ! collectionId ) {
		const isLinkMode = intent === 'link-existing';
		return (
			<div { ...blockProps }>
				<InspectorControls>
					<PanelBody title={ __( 'Collection', 'cortext' ) }>
						<CollectionPicker onSelect={ selectCollection } />
					</PanelBody>
				</InspectorControls>
				{ isLinkMode ? (
					<Placeholder
						icon={ link }
						label={ __( 'Link a collection', 'cortext' ) }
						instructions={ __(
							'Show an existing collection here.',
							'cortext'
						) }
					>
						<CollectionPicker onSelect={ selectCollection } />
					</Placeholder>
				) : (
					<Placeholder
						icon={ table }
						label={ __( 'New collection', 'cortext' ) }
						instructions={ __(
							'Name your collection to create it here.',
							'cortext'
						) }
					>
						<CollectionCreator
							onCreate={ ( collection ) =>
								selectCollection( collection.id )
							}
						/>
					</Placeholder>
				) }
			</div>
		);
	}

	return (
		<CollectionFieldsProvider collectionId={ collectionId }>
			<div { ...blockProps }>
				<CollectionToolbarControl
					collectionId={ collectionId }
					isOwner={ isOwner }
					onSelect={ onSelectCollection }
					onFieldCreated={ onFieldCreated }
				/>
				<CollectionInspectorControls
					collectionId={ collectionId }
					view={ view }
					align={ align }
					isOwner={ isOwner }
					onSelect={ onSelectCollection }
					onChangeView={ setView }
					onChangeAlign={ setAlign }
					onFieldCreated={ onFieldCreated }
				/>
				<CollectionDataViews
					collectionId={ collectionId }
					view={ view }
					onChangeView={ setView }
					onReady={ isOwner ? onCollectionReady : undefined }
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
							{ __( 'Could not load documents.', 'cortext' ) }
						</Notice>
					}
				/>
			</div>
		</CollectionFieldsProvider>
	);
}
