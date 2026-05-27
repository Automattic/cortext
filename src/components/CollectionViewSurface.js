import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	Notice,
	TextControl,
} from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { moreVertical, plus } from '@wordpress/icons';

import CollectionDataViews from './CollectionDataViews';
import { useCollectionFieldsContext } from './CollectionFieldsContext';
import { COVER_FIELD, TITLE_FIELD } from './CollectionDataViewFields';
import {
	addNamedView,
	applyViewRuntimeState,
	deleteActiveView,
	duplicateActiveView,
	getActiveViewEntry,
	getViewRuntimeState,
	getActiveView,
	moveActiveView,
	normalizeViewConfig,
	normalizeViewConfigForFields,
	prepareViewConfigForStorage,
	renameActiveView,
	setActiveView,
	updateActiveView,
	viewConfigsEqual,
} from './collectionViewConfig';

function ignoreRejected( result ) {
	Promise.resolve( result ).catch( () => {} );
}

export default function CollectionViewSurface( {
	collectionId,
	viewConfig,
	legacyView,
	onChangeViewConfig,
	saveError = null,
	renderViewControls = null,
	...dataViewProps
} ) {
	const normalizedViewConfig = useMemo(
		() => normalizeViewConfig( viewConfig, { legacyView } ),
		[ viewConfig, legacyView ]
	);
	const normalizedViewConfigJson = useMemo(
		() => JSON.stringify( normalizedViewConfig ),
		[ normalizedViewConfig ]
	);
	const rawViewConfigJson = useMemo(
		() =>
			JSON.stringify( {
				default_view: viewConfig?.default_view,
				default_layouts: viewConfig?.default_layouts,
				active_view: viewConfig?.active_view,
				view_list: viewConfig?.view_list,
			} ),
		[ viewConfig ]
	);
	const activeViewEntry = getActiveViewEntry( normalizedViewConfig );
	const storedActiveView = getActiveView( normalizedViewConfig );
	const [ runtimeViewState, setRuntimeViewState ] = useState( () =>
		getViewRuntimeState( storedActiveView )
	);
	const activeView = useMemo(
		() => applyViewRuntimeState( storedActiveView, runtimeViewState ),
		[ storedActiveView, runtimeViewState ]
	);
	const activeIndex = normalizedViewConfig.view_list.findIndex(
		( viewEntry ) => viewEntry.slug === normalizedViewConfig.active_view
	);
	const [ draftTitle, setDraftTitle ] = useState( activeViewEntry.title );
	const draftTitleRef = useRef( activeViewEntry.title );
	const lastCommittedTitleRef = useRef( activeViewEntry.title );

	const commitViewConfig = useCallback(
		( nextViewConfig ) => {
			const normalized = prepareViewConfigForStorage( nextViewConfig );
			return onChangeViewConfig?.( normalized );
		},
		[ onChangeViewConfig ]
	);

	useEffect( () => {
		setDraftTitle( activeViewEntry.title );
		draftTitleRef.current = activeViewEntry.title;
		lastCommittedTitleRef.current = activeViewEntry.title;
	}, [ activeViewEntry.slug, activeViewEntry.title ] );

	// Selecting a different view (tab, duplicate, delete, move) goes through
	// changeViewConfig and never touches runtimeViewState, so reset the
	// page to the stored view's default when the active view changes.
	useEffect( () => {
		setRuntimeViewState( getViewRuntimeState( storedActiveView ) );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ activeViewEntry.slug ] );

	useEffect( () => {
		if ( rawViewConfigJson === normalizedViewConfigJson ) {
			return;
		}
		ignoreRejected( commitViewConfig( normalizedViewConfig ) );
	}, [
		commitViewConfig,
		normalizedViewConfig,
		normalizedViewConfigJson,
		rawViewConfigJson,
	] );

	const { fields, isResolving, fieldsResolved } =
		useCollectionFieldsContext();
	const availableFields = useMemo(
		() => [ TITLE_FIELD, COVER_FIELD, ...fields ],
		[ fields ]
	);
	const fieldIds = useMemo(
		() => new Set( availableFields.map( ( field ) => field.id ) ),
		[ availableFields ]
	);
	useEffect( () => {
		if ( isResolving || ! fieldsResolved ) {
			return;
		}

		const nextViewConfig = normalizeViewConfigForFields(
			normalizedViewConfig,
			fieldIds,
			{
				ensureTitle: false,
				fields: availableFields,
				referenceIds: fieldIds,
			}
		);
		if ( JSON.stringify( nextViewConfig ) === normalizedViewConfigJson ) {
			return;
		}
		ignoreRejected( commitViewConfig( nextViewConfig ) );
	}, [
		availableFields,
		commitViewConfig,
		fieldIds,
		fieldsResolved,
		isResolving,
		normalizedViewConfig,
		normalizedViewConfigJson,
	] );

	const changeViewConfig = useCallback(
		( nextViewConfig ) => {
			const normalized = prepareViewConfigForStorage( nextViewConfig );
			if ( viewConfigsEqual( normalized, normalizedViewConfig ) ) {
				return;
			}
			ignoreRejected( commitViewConfig( normalized ) );
		},
		[ commitViewConfig, normalizedViewConfig ]
	);
	const changeActiveView = useCallback(
		( nextView ) => {
			setRuntimeViewState( getViewRuntimeState( nextView ) );
			changeViewConfig(
				updateActiveView( normalizedViewConfig, nextView )
			);
		},
		[ changeViewConfig, normalizedViewConfig ]
	);
	const commitRename = useCallback(
		( title ) => {
			const nextViewConfig = renameActiveView(
				normalizedViewConfig,
				title
			);
			const nextTitle = getActiveViewEntry( nextViewConfig ).title;
			if ( nextTitle === lastCommittedTitleRef.current ) {
				return;
			}
			lastCommittedTitleRef.current = nextTitle;
			changeViewConfig( nextViewConfig );
		},
		[ changeViewConfig, normalizedViewConfig ]
	);
	const renameView = useCallback(
		( onClose ) => {
			commitRename( draftTitleRef.current );
			onClose?.();
		},
		[ commitRename ]
	);
	const viewControls = renderViewControls?.( {
		view: activeView,
		onChangeView: changeActiveView,
	} );

	const viewToolbar = (
		<div className="cortext-collection-view-bar cortext-collection-view-toolbar">
			<div
				className="cortext-collection-view-bar__tabs"
				role="tablist"
				aria-label={ __( 'Collection views', 'cortext' ) }
			>
				{ normalizedViewConfig.view_list.map( ( viewEntry ) => {
					const isActive =
						viewEntry.slug === normalizedViewConfig.active_view;
					return (
						<Button
							key={ viewEntry.slug }
							className="cortext-collection-view-bar__tab"
							variant="tertiary"
							isPressed={ isActive }
							role="tab"
							aria-selected={ isActive }
							onClick={ () =>
								changeViewConfig(
									setActiveView(
										normalizedViewConfig,
										viewEntry.slug
									)
								)
							}
						>
							{ viewEntry.title }
						</Button>
					);
				} ) }
			</div>
			<Button
				className="cortext-collection-view-bar__icon"
				icon={ plus }
				label={ __( 'New view', 'cortext' ) }
				onClick={ () =>
					changeViewConfig( addNamedView( normalizedViewConfig ) )
				}
			/>
			<Dropdown
				contentClassName="cortext-collection-view-actions-popover"
				popoverProps={ { placement: 'bottom-end' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						className="cortext-collection-view-bar__icon"
						icon={ moreVertical }
						label={ sprintf(
							/* translators: %s: view name */
							__( 'Actions for %s', 'cortext' ),
							activeViewEntry.title
						) }
						onClick={ onToggle }
						isPressed={ isOpen }
						aria-expanded={ isOpen }
					/>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cortext-collection-view-actions">
						<TextControl
							label={ __( 'View name', 'cortext' ) }
							value={ draftTitle }
							onChange={ ( nextTitle ) => {
								draftTitleRef.current = nextTitle;
								setDraftTitle( nextTitle );
							} }
							onBlur={ ( event ) =>
								commitRename( event.currentTarget.value )
							}
							onKeyDown={ ( event ) => {
								if ( event.key === 'Enter' ) {
									renameView( onClose );
								}
							} }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
						<Button
							className="cortext-collection-view-actions__rename"
							variant="tertiary"
							onClick={ () => renameView( onClose ) }
						>
							{ __( 'Rename', 'cortext' ) }
						</Button>
						<MenuGroup>
							<MenuItem
								icon={ plus }
								onClick={ () => {
									changeViewConfig(
										addNamedView( normalizedViewConfig )
									);
									onClose();
								} }
							>
								{ __( 'New view', 'cortext' ) }
							</MenuItem>
							<MenuItem
								icon="admin-page"
								onClick={ () => {
									changeViewConfig(
										duplicateActiveView(
											normalizedViewConfig
										)
									);
									onClose();
								} }
							>
								{ __( 'Duplicate', 'cortext' ) }
							</MenuItem>
							<MenuItem
								icon="arrow-left-alt2"
								disabled={ activeIndex <= 0 }
								onClick={ () => {
									changeViewConfig(
										moveActiveView(
											normalizedViewConfig,
											-1
										)
									);
									onClose();
								} }
							>
								{ __( 'Move left', 'cortext' ) }
							</MenuItem>
							<MenuItem
								icon="arrow-right-alt2"
								disabled={
									activeIndex >=
									normalizedViewConfig.view_list.length - 1
								}
								onClick={ () => {
									changeViewConfig(
										moveActiveView(
											normalizedViewConfig,
											1
										)
									);
									onClose();
								} }
							>
								{ __( 'Move right', 'cortext' ) }
							</MenuItem>
							<MenuItem
								icon="trash"
								isDestructive
								disabled={
									normalizedViewConfig.view_list.length <= 1
								}
								onClick={ () => {
									changeViewConfig(
										deleteActiveView( normalizedViewConfig )
									);
									onClose();
								} }
							>
								{ __( 'Delete', 'cortext' ) }
							</MenuItem>
						</MenuGroup>
					</div>
				) }
			/>
		</div>
	);

	return (
		<div className="cortext-collection-view-surface">
			{ saveError ? (
				<Notice
					className="cortext-collection-view-surface__notice"
					status="error"
					isDismissible={ false }
				>
					{ saveError?.message ??
						__( "Couldn't save collection views.", 'cortext' ) }
				</Notice>
			) : null }
			{ viewControls }
			<CollectionDataViews
				collectionId={ collectionId }
				view={ activeView }
				viewKey={ activeViewEntry.slug }
				onChangeView={ changeActiveView }
				defaultLayouts={ normalizedViewConfig.default_layouts }
				header={ viewToolbar }
				{ ...dataViewProps }
			/>
		</div>
	);
}
