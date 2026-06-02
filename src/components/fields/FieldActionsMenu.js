import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Icon,
	Popover,
	privateApis as componentsPrivateApis,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { unlock } from '../../lock-unlock';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { chevronRight, cog, copy, pencil, trash } from '@wordpress/icons';

import ChangeFieldTypePopover from './ChangeFieldTypePopover';
import EditOptionsPopover from './EditOptionsPopover';
import FieldFormatPopover from './FieldFormatPopover';
import FormulaConfig from './FormulaConfig';
import FieldSettingsPopover from './FieldSettingsPopover';
import RenameFieldInline from './RenameFieldInline';
import {
	useCollectionFieldsContext,
	useMappedField,
} from '../CollectionFieldsContext';
import Infotip from '../Infotip';
import {
	useDeleteField,
	useDuplicateField,
	useUpdateFormulaExpression,
} from '../../hooks/useFieldMutations';

const { Menu } = unlock( componentsPrivateApis );

const TYPES_WITH_OPTIONS = new Set( [ 'select', 'multiselect' ] );
const FORMATTABLE_TYPES = new Set( [ 'number', 'date', 'datetime' ] );

// The server rejects these conversions, so do not offer them.
const UNCONVERTIBLE_SOURCE_TYPES = new Set( [
	'relation',
	'rollup',
	'formula',
] );

export default function FieldActionsMenu( {
	recordId,
	collectionId,
	field,
	className = 'cortext-field-actions',
	menuKey,
	triggerButton,
	triggerContent,
	renamingPrefix,
	closeMenuRef,
	onFieldOptionsSaved,
	onFieldFormatSaved,
	onOpenFormat,
	onRowsChanged,
	onCloseMenu,
	renderBetweenConfigAndLifecycle,
	renderLifecyclePrefix,
} ) {
	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ isMenuOpen, setIsMenuOpen ] = useState( false );
	const [ isFormatting, setIsFormatting ] = useState( false );
	const [ isEditingOptions, setIsEditingOptions ] = useState( false );
	const [ isEditingFormula, setIsEditingFormula ] = useState( false );
	const [ isEditingSettings, setIsEditingSettings ] = useState( false );
	const [ isChangingType, setIsChangingType ] = useState( false );
	const [ shouldFocusFormat, setShouldFocusFormat ] = useState( false );
	const [ confirmDelete, setConfirmDelete ] = useState( false );
	const formatItemRef = useRef( null );
	const closeTimerRef = useRef( null );
	const optionsAnchorRef = useRef( null );
	const duplicate = useDuplicateField( collectionId );
	const remove = useDeleteField( collectionId );
	const updateFormula = useUpdateFormulaExpression( collectionId );
	const { fields } = useCollectionFieldsContext();
	const mappedField = useMappedField( recordId );
	const activeField = useMemo( () => {
		const source = mappedField ?? field ?? null;
		if ( ! source || ! field ) {
			return source;
		}
		return {
			...source,
			...( field.cortextElements !== undefined
				? { cortextElements: field.cortextElements }
				: {} ),
			...( field.cortextFormat !== undefined
				? { cortextFormat: field.cortextFormat }
				: {} ),
		};
	}, [ field, mappedField ] );
	const label = activeField?.label || `#${ recordId }`;
	const description = activeField?.description?.trim() ?? '';
	const fieldType =
		activeField?.cortextType ??
		activeField?.cortextFieldType ??
		activeField?.type;
	const canFormat = FORMATTABLE_TYPES.has( fieldType );
	const supportsOptions = TYPES_WITH_OPTIONS.has( fieldType );
	const supportsFormula = fieldType === 'formula';
	const canChangeType =
		Boolean( fieldType ) && ! UNCONVERTIBLE_SOURCE_TYPES.has( fieldType );
	const initialOptions = useMemo(
		() => ( supportsOptions ? activeField?.cortextElements ?? [] : [] ),
		[ supportsOptions, activeField ]
	);
	const [ formulaError, setFormulaError ] = useState( '' );
	const dependentRollups = useMemo( () => {
		const fieldList = Array.isArray( fields ) ? fields : [];
		return fieldList.filter(
			( candidate ) =>
				candidate.cortextType === 'rollup' &&
				( candidate.rollupRelationFieldId === recordId ||
					candidate.rollupTargetFieldId === recordId )
		);
	}, [ fields, recordId ] );

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
			setShouldFocusFormat( false );
			closeTimerRef.current = null;
		}, 180 );
	}, [ cancelClose ] );
	const openFormat = useCallback(
		( focus = false ) => {
			cancelClose();
			onOpenFormat?.();
			setShouldFocusFormat( focus );
			setIsFormatting( true );
		},
		[ cancelClose, onOpenFormat ]
	);
	useEffect( () => () => cancelClose(), [ cancelClose ] );

	const closeFormat = useCallback( () => {
		cancelClose();
		setIsFormatting( false );
		setShouldFocusFormat( false );
	}, [ cancelClose ] );

	const closeMenu = useCallback( () => {
		cancelClose();
		setIsFormatting( false );
		setShouldFocusFormat( false );
		setIsMenuOpen( false );
		onCloseMenu?.();
	}, [ cancelClose, onCloseMenu ] );

	useEffect( () => {
		if ( ! closeMenuRef ) {
			return undefined;
		}
		closeMenuRef.current = closeMenu;
		return () => {
			if ( closeMenuRef.current === closeMenu ) {
				closeMenuRef.current = null;
			}
		};
	}, [ closeMenu, closeMenuRef ] );

	const closeFormatAndFocusTrigger = useCallback( () => {
		closeFormat();
		window.requestAnimationFrame( () => {
			formatItemRef.current?.focus();
		} );
	}, [ closeFormat ] );

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

	// tech-debt.md#td-wp-menu-popover-limitations: Format lives here; Calculate is injected by table
	// headers. Both are sibling popovers that act like submenus.
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

	// tech-debt.md#td-wp-menu-popover-limitations: Ariakit only sees clicks in this iframe. Editor chrome
	// clicks land in the parent document, so listen there too.
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

	const onDuplicate = useCallback( async () => {
		try {
			await duplicate.run( recordId );
			onRowsChanged?.();
		} catch {
			// surfaced via duplicate.error.
		}
	}, [ duplicate, onRowsChanged, recordId ] );

	const onConfirmDelete = useCallback( async () => {
		try {
			await remove.run( recordId );
			onRowsChanged?.();
		} finally {
			setConfirmDelete( false );
		}
	}, [ remove, onRowsChanged, recordId ] );

	const menuContext = {
		Menu,
		closeMenu,
		closeFormat,
		label,
		fieldType,
		scheduleClose,
		cancelClose,
		hideMenuOnInteractOutside,
	};

	if ( isRenaming ) {
		return (
			<span className={ className }>
				{ renamingPrefix ? (
					<span className="cortext-field-actions__renaming-prefix">
						{ renamingPrefix }
					</span>
				) : null }
				<RenameFieldInline
					recordId={ recordId }
					initialTitle={ label }
					onDone={ () => setIsRenaming( false ) }
				/>
			</span>
		);
	}

	return (
		<span className={ className } ref={ optionsAnchorRef }>
			<Menu
				key={ menuKey ?? `field-actions-${ recordId }-${ fieldType }` }
				open={ isMenuOpen }
				onOpenChange={ onMenuOpenChange }
			>
				<Menu.TriggerButton
					render={
						triggerButton ?? (
							<Button variant="tertiary" label={ label } />
						)
					}
				>
					{ triggerContent ?? label }
				</Menu.TriggerButton>
				{ description ? (
					<Infotip
						description={ description }
						label={ sprintf(
							/* translators: %s: field label */
							__( 'About %s', 'cortext' ),
							label
						) }
						placement="bottom"
					/>
				) : null }
				{ /* tech-debt.md#td-wp-menu-popover-limitations: portal avoids table-header text
				     transform leaking into the menu. */ }
				<Menu.Popover
					className="cortext-field-actions-popover"
					modal={ false }
					portal
					hideOnInteractOutside={ hideMenuOnInteractOutside }
					style={ { minWidth: '240px' } }
				>
					<Menu.Group>
						<Menu.Item
							prefix={ <Icon icon={ pencil } /> }
							onClick={ () => setIsRenaming( true ) }
						>
							<Menu.ItemLabel>
								{ __( 'Rename', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
						<Menu.Item
							prefix={ <Icon icon={ cog } /> }
							onClick={ () => setIsEditingSettings( true ) }
						>
							<Menu.ItemLabel>
								{ __( 'Field settings', 'cortext' ) }
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
									{ __( 'Format', 'cortext' ) }
								</Menu.ItemLabel>
							</Menu.Item>
						) : null }
						{ supportsOptions ? (
							<Menu.Item
								onClick={ () => setIsEditingOptions( true ) }
							>
								<Menu.ItemLabel>
									{ __( 'Manage choices', 'cortext' ) }
								</Menu.ItemLabel>
							</Menu.Item>
						) : null }
						{ supportsFormula ? (
							<Menu.Item
								onClick={ () => {
									setFormulaError( '' );
									setIsEditingFormula( true );
								} }
							>
								<Menu.ItemLabel>
									{ __( 'Edit formula', 'cortext' ) }
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
					{ renderBetweenConfigAndLifecycle ? (
						<>
							<Menu.Separator />
							{ renderBetweenConfigAndLifecycle( menuContext ) }
						</>
					) : null }
					<Menu.Separator />
					<Menu.Group>
						{ renderLifecyclePrefix?.( menuContext ) }
						<Menu.Item
							prefix={ <Icon icon={ copy } /> }
							onClick={ onDuplicate }
						>
							<Menu.ItemLabel>
								{ __( 'Duplicate', 'cortext' ) }
							</Menu.ItemLabel>
						</Menu.Item>
						{ /* tech-debt.md#td-wp-menu-popover-limitations: Menu.Item has no destructive
						     variant, so style Delete with a class. */ }
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
					field={ activeField }
					anchor={ formatItemRef.current }
					focusOnMount={ shouldFocusFormat ? 'firstElement' : false }
					onClose={ closeFormat }
					onCloseWithFocus={ closeFormatAndFocusTrigger }
					onSaved={ ( nextFormat ) => {
						onFieldFormatSaved?.( recordId, nextFormat );
						onRowsChanged?.();
					} }
					onMouseEnter={ () => openFormat() }
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
								.map( ( candidate ) => candidate.label )
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
			{ isEditingFormula && supportsFormula ? (
				<Popover
					anchor={ optionsAnchorRef.current }
					placement="bottom-start"
					onClose={ () => setIsEditingFormula( false ) }
					focusOnMount="firstElement"
					className="cortext-formula-popover-host"
				>
					<div className="cortext-data-view-toolbar-popover__content">
						<FormulaConfig
							initialExpression={
								activeField?.formulaExpression ?? ''
							}
							isBusy={ updateFormula.isBusy }
							errorMessage={
								formulaError || updateFormula.error?.message
							}
							backLabel={ __( 'Cancel', 'cortext' ) }
							submitLabel={ __( 'Save formula', 'cortext' ) }
							excludeRecordId={ recordId }
							onBack={ () => setIsEditingFormula( false ) }
							onError={ setFormulaError }
							onSubmit={ async ( expression ) => {
								setFormulaError( '' );
								await updateFormula.run( recordId, expression );
								setIsEditingFormula( false );
								onRowsChanged?.();
							} }
						/>
					</div>
				</Popover>
			) : null }
			{ isEditingSettings ? (
				<FieldSettingsPopover
					recordId={ recordId }
					anchor={ optionsAnchorRef.current }
					onFieldOptionsSaved={ onFieldOptionsSaved }
					onRowsChanged={ onRowsChanged }
					onClose={ () => setIsEditingSettings( false ) }
				/>
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
