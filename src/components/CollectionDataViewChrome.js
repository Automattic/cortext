import {
	BaseControl,
	Button,
	CheckboxControl,
	Dropdown,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalDropdownContentWrapper as DropdownContentWrapper,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHStack as HStack,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalItem as Item,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalItemGroup as ItemGroup,
	RangeControl,
	SelectControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControl as ToggleGroupControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalToggleGroupControlOptionIcon as ToggleGroupControlOptionIcon,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
	Icon as WCIcon,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews/wp';
import { useMemo, useRef } from '@wordpress/element';
import { __, _n, _x, sprintf } from '@wordpress/i18n';
import {
	arrowDown,
	arrowUp,
	check,
	closeSmall,
	cog,
	trash,
} from '@wordpress/icons';

const DATAVIEWS_CONFIG_POPOVER_PROPS = {
	className: 'dataviews-config__popover',
	placement: 'bottom-end',
	offset: 9,
};

const GRID_PREVIEW_SIZES = [ 120, 170, 230, 290, 350, 430 ];
const GRID_DEFAULT_PREVIEW_SIZE = 230;
const PER_PAGE_SIZES = [ 10, 20, 50, 100 ];
const SORT_DIRECTIONS = [
	{
		value: 'asc',
		icon: arrowUp,
		label: __( 'Sort ascending', 'cortext' ),
	},
	{
		value: 'desc',
		icon: arrowDown,
		label: __( 'Sort descending', 'cortext' ),
	},
];

function useStablePopoverId( prefix ) {
	const idRef = useRef( null );
	if ( ! idRef.current ) {
		idRef.current = `${ prefix }-${ Math.random()
			.toString( 36 )
			.slice( 2 ) }`;
	}
	return idRef.current;
}

function isDefined( item ) {
	return item !== undefined && item !== null;
}

function getHideableFields( view, fields ) {
	const togglableFields = [
		view?.titleField,
		view?.mediaField,
		view?.descriptionField,
	].filter( Boolean );

	return fields.filter(
		( field ) =>
			! togglableFields.includes( field.id ) &&
			field.type !== 'media' &&
			field.enableHiding !== false
	);
}

function GridConfigFieldItem( { field, isVisible, onToggleVisibility } ) {
	return (
		<Item onClick={ field.enableHiding ? onToggleVisibility : undefined }>
			<HStack expanded={ false } justify="flex-start" spacing={ 2 }>
				<span style={ { height: 24, width: 24 } }>
					{ isVisible && <WCIcon icon={ check } /> }
				</span>
				<span className="dataviews-view-config__label">
					{ field.label }
				</span>
			</HStack>
		</Item>
	);
}

function GridPropertiesSection( { view, fields, onChangeView } ) {
	const regularFields = getHideableFields( view, fields );
	const titleField = fields.find( ( field ) => field.id === view.titleField );
	const previewField = fields.find(
		( field ) => field.id === view.mediaField
	);
	const descriptionField = fields.find(
		( field ) => field.id === view.descriptionField
	);
	const lockedFields = [
		{
			field: titleField,
			isVisibleFlag: 'showTitle',
		},
		{
			field: previewField,
			isVisibleFlag: 'showMedia',
		},
		{
			field: descriptionField,
			isVisibleFlag: 'showDescription',
		},
	].filter( ( { field } ) => isDefined( field ) );
	const visibleFieldIds = view.fields ?? [];
	const visibleRegularFieldsCount = regularFields.filter( ( field ) =>
		visibleFieldIds.includes( field.id )
	).length;
	const visibleLockedFields = lockedFields.filter(
		( { isVisibleFlag } ) => view[ isVisibleFlag ] ?? true
	);
	const totalVisibleFields =
		visibleLockedFields.length + visibleRegularFieldsCount;
	const isSingleVisibleLockedField =
		totalVisibleFields === 1 && visibleLockedFields.length === 1;

	if ( ! regularFields.length && ! lockedFields.length ) {
		return null;
	}

	return (
		<VStack className="dataviews-field-control">
			<BaseControl.VisualLabel>
				{ __( 'Properties', 'cortext' ) }
			</BaseControl.VisualLabel>
			<VStack className="dataviews-view-config__properties">
				<ItemGroup isBordered isSeparated size="medium">
					{ lockedFields.map( ( { field, isVisibleFlag } ) => {
						const isVisible = view[ isVisibleFlag ] ?? true;
						const fieldToRender =
							isSingleVisibleLockedField && isVisible
								? { ...field, enableHiding: false }
								: field;

						return (
							<GridConfigFieldItem
								key={ field.id }
								field={ fieldToRender }
								isVisible={ isVisible }
								onToggleVisibility={ () =>
									onChangeView( {
										...view,
										[ isVisibleFlag ]: ! isVisible,
									} )
								}
							/>
						);
					} ) }
					{ regularFields.map( ( field ) => {
						const isVisible = visibleFieldIds.includes( field.id );
						const fieldToRender =
							totalVisibleFields === 1 && isVisible
								? { ...field, enableHiding: false }
								: field;

						return (
							<GridConfigFieldItem
								key={ field.id }
								field={ fieldToRender }
								isVisible={ isVisible }
								onToggleVisibility={ () =>
									onChangeView( {
										...view,
										fields: isVisible
											? visibleFieldIds.filter(
													( fieldId ) =>
														fieldId !== field.id
											  )
											: [ ...visibleFieldIds, field.id ],
									} )
								}
							/>
						);
					} ) }
				</ItemGroup>
			</VStack>
		</VStack>
	);
}

function GridSortFieldControl( { view, fields, onChangeView } ) {
	const sortableFields = fields.filter(
		( field ) => field.enableSorting !== false
	);
	const orderOptions = sortableFields.map( ( field ) => ( {
		label: field.label,
		value: field.id,
	} ) );

	if ( orderOptions.length === 0 ) {
		return null;
	}

	return (
		<SelectControl
			__next40pxDefaultSize
			label={ __( 'Sort by', 'cortext' ) }
			value={ view.sort?.field }
			options={ orderOptions }
			onChange={ ( value ) =>
				onChangeView( {
					...view,
					sort: {
						direction: view?.sort?.direction || 'desc',
						field: value,
					},
					showLevels: false,
				} )
			}
		/>
	);
}

function GridSortDirectionControl( { view, fields, onChangeView } ) {
	const sortableFields = fields.filter(
		( field ) => field.enableSorting !== false
	);
	if ( sortableFields.length === 0 ) {
		return null;
	}

	let value = view.sort?.direction;
	if ( ! value && view.sort?.field ) {
		value = 'desc';
	}

	return (
		<ToggleGroupControl
			className="dataviews-view-config__sort-direction"
			__next40pxDefaultSize
			isBlock
			label={ __( 'Order', 'cortext' ) }
			value={ value }
			onChange={ ( newDirection ) => {
				if ( newDirection !== 'asc' && newDirection !== 'desc' ) {
					return;
				}
				onChangeView( {
					...view,
					sort: {
						direction: newDirection,
						field:
							view.sort?.field ||
							sortableFields.find(
								( field ) => field.enableSorting !== false
							)?.id ||
							'',
					},
					showLevels: false,
				} );
			} }
		>
			{ SORT_DIRECTIONS.map( ( direction ) => (
				<ToggleGroupControlOptionIcon
					key={ direction.value }
					value={ direction.value }
					icon={ direction.icon }
					label={ direction.label }
				/>
			) ) }
		</ToggleGroupControl>
	);
}

function GridPreviewSizeControl( { view, onChangeView } ) {
	const layoutPreviewSize =
		view.layout?.previewSize ?? GRID_DEFAULT_PREVIEW_SIZE;
	const previewSizeToUse =
		GRID_PREVIEW_SIZES.map( ( value, index ) => ( { value, index } ) )
			.filter( ( size ) => size.value <= layoutPreviewSize )
			.sort( ( a, b ) => b.value - a.value )[ 0 ]?.index ?? 0;
	const marks = GRID_PREVIEW_SIZES.map( ( _value, index ) => ( {
		value: index,
	} ) );

	return (
		<RangeControl
			__next40pxDefaultSize
			showTooltip={ false }
			label={ __( 'Preview size', 'cortext' ) }
			value={ previewSizeToUse }
			min={ 0 }
			max={ GRID_PREVIEW_SIZES.length - 1 }
			withInputField={ false }
			onChange={ ( value = 0 ) => {
				onChangeView( {
					...view,
					layout: {
						...view.layout,
						previewSize: GRID_PREVIEW_SIZES[ value ],
					},
				} );
			} }
			step={ 1 }
			marks={ marks }
		/>
	);
}

function GridItemsPerPageControl( { view, onChangeView } ) {
	if ( view.infiniteScrollEnabled ) {
		return null;
	}

	return (
		<ToggleGroupControl
			__next40pxDefaultSize
			isBlock
			label={ __( 'Items per page', 'cortext' ) }
			value={ view.perPage || 10 }
			disabled={ ! view?.sort?.field }
			onChange={ ( newItemsPerPage ) => {
				const perPage =
					typeof newItemsPerPage === 'number' ||
					newItemsPerPage === undefined
						? newItemsPerPage
						: parseInt( newItemsPerPage, 10 );
				onChangeView( {
					...view,
					perPage,
					page: 1,
				} );
			} }
		>
			{ PER_PAGE_SIZES.map( ( value ) => (
				<ToggleGroupControlOption
					key={ value }
					value={ value }
					label={ value.toString() }
				/>
			) ) }
		</ToggleGroupControl>
	);
}

function GridViewConfig( { view, fields, onChangeView } ) {
	const popoverId = useStablePopoverId( 'cortext-grid-view-config-dropdown' );

	if ( ! view || ! onChangeView ) {
		return <DataViews.ViewConfig />;
	}

	return (
		<Dropdown
			expandOnMobile
			popoverProps={ {
				...DATAVIEWS_CONFIG_POPOVER_PROPS,
				id: popoverId,
			} }
			renderToggle={ ( { onToggle, isOpen } ) => (
				<div className="dataviews-view-config__toggle-wrapper">
					<Button
						size="compact"
						icon={ cog }
						label={ _x(
							'View options',
							'View is used as a noun',
							'cortext'
						) }
						onClick={ onToggle }
						aria-expanded={ isOpen ? 'true' : 'false' }
						aria-controls={ popoverId }
					/>
				</div>
			) }
			renderContent={ () => (
				<DropdownContentWrapper
					paddingSize="medium"
					className="dataviews-config__popover-content-wrapper"
				>
					<VStack className="dataviews-view-config" spacing={ 6 }>
						<HStack
							justify="space-between"
							className="dataviews-view-config__header"
						>
							<Heading
								level={ 2 }
								className="dataviews-settings-section__title"
							>
								{ __( 'Appearance', 'cortext' ) }
							</Heading>
						</HStack>
						<VStack spacing={ 4 }>
							<HStack
								spacing={ 2 }
								className="dataviews-view-config__sort-controls"
							>
								<GridSortFieldControl
									view={ view }
									fields={ fields }
									onChangeView={ onChangeView }
								/>
								<GridSortDirectionControl
									view={ view }
									fields={ fields }
									onChangeView={ onChangeView }
								/>
							</HStack>
							<GridPreviewSizeControl
								view={ view }
								onChangeView={ onChangeView }
							/>
							<GridItemsPerPageControl
								view={ view }
								onChangeView={ onChangeView }
							/>
							<GridPropertiesSection
								view={ view }
								fields={ fields }
								onChangeView={ onChangeView }
							/>
						</VStack>
					</VStack>
				</DropdownContentWrapper>
			) }
		/>
	);
}

export function DataViewsChrome( { footer, view, fields = [], onChangeView } ) {
	return (
		<>
			<HStack
				alignment="top"
				justify="space-between"
				className="dataviews__view-actions"
				spacing={ 1 }
			>
				<HStack
					justify="start"
					expanded={ false }
					className="dataviews__search"
				>
					<DataViews.Search />
					<DataViews.FiltersToggle />
				</HStack>
				<HStack
					spacing={ 1 }
					expanded={ false }
					style={ { flexShrink: 0 } }
				>
					<DataViews.LayoutSwitcher />
					{ view?.type === 'grid' ? (
						<GridViewConfig
							view={ view }
							fields={ fields }
							onChangeView={ onChangeView }
						/>
					) : (
						<DataViews.ViewConfig />
					) }
				</HStack>
			</HStack>
			<DataViews.Filters className="dataviews-filters__container" />
			<DataViews.Layout />
			{ footer }
		</>
	);
}

export function DataViewsBulkSelectionControls( {
	className = 'dataviews-bulk-actions-footer__container',
	selectedIds,
	visibleIds,
	onClearSelection,
	onDeleteSelected,
	onToggleVisibleSelection,
} ) {
	const selectedSet = useMemo(
		() => new Set( selectedIds ),
		[ selectedIds ]
	);
	const selectedCount = selectedIds.length;
	const visibleCount = visibleIds.length;
	const selectedVisibleCount = visibleIds.filter( ( id ) =>
		selectedSet.has( id )
	).length;
	const allVisibleSelected =
		visibleCount > 0 && selectedVisibleCount === visibleCount;
	const hasVisibleSelection = selectedVisibleCount > 0;

	const countLabel =
		selectedCount > 0
			? sprintf(
					/* translators: %d: number of selected documents. */
					_n(
						'%d document selected',
						'%d documents selected',
						selectedCount,
						'cortext'
					),
					selectedCount
			  )
			: sprintf(
					/* translators: %d: number of visible documents. */
					_n(
						'%d document',
						'%d documents',
						visibleCount,
						'cortext'
					),
					visibleCount
			  );

	return (
		<HStack expanded={ false } className={ className } spacing={ 3 }>
			<CheckboxControl
				className="dataviews-view-table-selection-checkbox"
				__nextHasNoMarginBottom
				checked={ allVisibleSelected }
				indeterminate={ ! allVisibleSelected && hasVisibleSelection }
				onChange={ onToggleVisibleSelection }
				aria-label={
					allVisibleSelected
						? __( 'Deselect visible', 'cortext' )
						: __( 'Select visible', 'cortext' )
				}
			/>
			<span className="dataviews-bulk-actions-footer__item-count">
				{ countLabel }
			</span>
			<HStack
				className="dataviews-bulk-actions-footer__action-buttons"
				expanded={ false }
				spacing={ 1 }
			>
				{ selectedCount > 0 && (
					<Button
						icon={ trash }
						isDestructive
						label={ __( 'Move selected to Trash', 'cortext' ) }
						onClick={ onDeleteSelected }
						size="compact"
						showTooltip
						tooltipPosition="top"
					/>
				) }
				{ selectedCount > 0 && (
					<Button
						icon={ closeSmall }
						label={ __( 'Clear selection', 'cortext' ) }
						onClick={ onClearSelection }
						size="compact"
						showTooltip
						tooltipPosition="top"
					/>
				) }
			</HStack>
		</HStack>
	);
}

export function DataViewsSelectionFooter( {
	enabled,
	selectedIds,
	visibleIds,
	totalItems,
	totalPages,
	onClearSelection,
	onDeleteSelected,
	onToggleVisibleSelection,
} ) {
	const showBulkControls = enabled && totalItems > 0;
	const showPagination = totalItems > 0 && totalPages > 1;

	if ( ! showBulkControls && ! showPagination ) {
		return null;
	}

	return (
		<HStack expanded={ false } justify="end" className="dataviews-footer">
			{ showBulkControls ? (
				<DataViewsBulkSelectionControls
					selectedIds={ selectedIds }
					visibleIds={ visibleIds }
					onClearSelection={ onClearSelection }
					onDeleteSelected={ onDeleteSelected }
					onToggleVisibleSelection={ onToggleVisibleSelection }
				/>
			) : null }
			<DataViews.Pagination />
		</HStack>
	);
}

export function DataViewStateShell( { children, status } ) {
	return (
		<div className="cortext-data-view-shell">
			<div
				className={ `cortext-data-view cortext-data-view--${ status }` }
			>
				<div className="cortext-data-view__state">{ children }</div>
			</div>
		</div>
	);
}
