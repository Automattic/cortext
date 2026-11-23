/**
 * Command palette actions on the document open in the canvas. Each one runs
 * the same document action as the sidebar menu, which goes through its
 * Cortext ability, and only shows up when it applies to the document and
 * the user is allowed to run it.
 */

import { Command } from 'cmdk';

import { useCommand } from '@wordpress/commands';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	box as archiveIcon,
	moveTo as moveIcon,
	pencil as renameIcon,
	plus as newIcon,
	trash as trashIcon,
} from '@wordpress/icons';
import { useNavigate, useParams } from '@tanstack/react-router';

import { DOCUMENT_POST_TYPE } from '../collections';
import {
	DocumentsProvider,
	documentTitle,
	listIconForRecord,
	useCreateDocument,
	useDocumentActions,
} from '../documents';
import { documentFeatures } from '../documents/capabilities';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { parseTarget } from '../router/entityRouteReducer';
import { computeDocumentUri } from '../router/useResolveEntity';
import { CommandIcon } from './CortextCommandMenu';

const CONTEXT = 'root';
const ACTIVE_STATUSES = [ 'draft', 'private', 'publish' ];
const ARCHIVED_STATUS = 'crtxt_archived';
// Prompt items are pinned by the palette filter, like search results, so
// they stay in the order they are listed.
const PROMPT_VALUE_PREFIX = 'document-prompt-';

function useOpenDocument() {
	const params = useParams( { strict: false } );
	const target = parseTarget( params._splat ?? '' );
	const id = target.kind === 'document' ? target.id : null;

	return useSelect(
		( select ) => {
			if ( ! id ) {
				return {};
			}
			const core = select( coreStore );
			const ref = { kind: 'postType', name: DOCUMENT_POST_TYPE, id };
			return {
				record: core.getEntityRecord(
					'postType',
					DOCUMENT_POST_TYPE,
					id
				),
				canUpdate: core.canUser( 'update', ref ),
				canDelete: core.canUser( 'delete', ref ),
			};
		},
		[ id ]
	);
}

// Closes the palette first, so the canvas is back by the time the action's
// snackbar reports the result.
function useRunFromPalette( focusCanvas ) {
	const { createErrorNotice } = useDispatch( 'core/notices' );

	return useCallback(
		async ( close, action ) => {
			close();
			focusCanvas();
			try {
				await action();
			} catch ( error ) {
				createErrorNotice(
					error?.message ??
						__( "Couldn't finish the action.", 'cortext' ),
					{ type: 'snackbar' }
				);
			}
		},
		[ createErrorNotice, focusCanvas ]
	);
}

function PromptItem( { value, icon, label, onSelect } ) {
	return (
		<Command.Item value={ promptValue( value ) } onSelect={ onSelect }>
			<div className="commands-command-menu__item has-icon">
				<CommandIcon icon={ icon } />
				<div className="commands-command-menu__item-main">
					<span className="commands-command-menu__item-label">
						{ label }
					</span>
				</div>
			</div>
		</Command.Item>
	);
}

function promptValue( value ) {
	return `${ PROMPT_VALUE_PREFIX }${ value }`;
}

function MoveDestinations( {
	record,
	search: typedSearch,
	onMove,
	selectValue,
} ) {
	const search = useDebouncedValue( typedSearch, 150 );
	const query = useMemo(
		() => ( {
			search,
			...( search ? { orderby: 'relevance' } : {} ),
			per_page: 20,
			status: ACTIVE_STATUSES,
			context: 'edit',
			cortext_no_trait: 1,
			cortext_no_collections: 1,
			exclude: [ record.id ],
		} ),
		[ search, record.id ]
	);
	const { records: fetched } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		query
	);
	// Keep the last results while the next search loads, so the list (and
	// the highlighted item Enter picks) doesn't empty between keystrokes.
	const lastFetched = useRef( null );
	if ( fetched ) {
		lastFetched.current = fetched;
	}
	const records = fetched ?? lastFetched.current;
	const destinations = useMemo(
		() => ( records ?? [] ).filter( ( page ) => page.id !== record.parent ),
		[ records, record.parent ]
	);
	const showTopLevel = record.parent > 0 && ! typedSearch;

	// New results take the highlight to the first one, so Enter picks the
	// best match instead of whatever was first before the search changed.
	useLayoutEffect( () => {
		if ( showTopLevel ) {
			selectValue( promptValue( 'top-level' ) );
		} else if ( destinations.length > 0 ) {
			selectValue( promptValue( destinations[ 0 ].id ) );
		}
	}, [ destinations, showTopLevel, selectValue ] );

	return (
		<>
			{ showTopLevel && (
				<PromptItem
					value="top-level"
					icon={ moveIcon }
					label={ __( 'Top level', 'cortext' ) }
					onSelect={ () => onMove( 0 ) }
				/>
			) }
			{ destinations.map( ( page ) => (
				<PromptItem
					key={ page.id }
					value={ `${ page.id }` }
					icon={ listIconForRecord( page ) }
					label={ documentTitle( page ) }
					onSelect={ () => onMove( page.id ) }
				/>
			) ) }
		</>
	);
}

// Asks for the title of a new document, creates it under `parent` (0 for the
// top level) and opens it.
function useNewDocumentPrompt( run, openPrompt ) {
	const navigate = useNavigate();
	const create = useCreateDocument();

	return useCallback(
		( parent ) =>
			openPrompt( {
				placeholder: __( 'Title of the new document', 'cortext' ),
				renderItems: ( { search, close } ) => {
					const newTitle = search.trim();
					return (
						<PromptItem
							value="create"
							icon={ newIcon }
							label={
								newTitle
									? sprintf(
											/* translators: %s: title of the new document */
											__( 'Create “%s”', 'cortext' ),
											newTitle
									  )
									: __(
											'Create an untitled document',
											'cortext'
									  )
							}
							onSelect={ () =>
								run( close, async () => {
									const created = await create( {
										...( newTitle
											? { title: newTitle }
											: {} ),
										...( parent ? { parent } : {} ),
									} );
									navigate( {
										to: '/$',
										params: {
											_splat: computeDocumentUri(
												created
											),
										},
									} );
								} )
							}
						/>
					);
				},
			} ),
		[ create, navigate, openPrompt, run ]
	);
}

function OpenDocumentCommands( { record, permissions, run, openPrompt } ) {
	const actions = useDocumentActions();
	const promptForNewDocument = useNewDocumentPrompt( run, openPrompt );
	const title = documentTitle( record );
	const features = documentFeatures( record );
	const isActive = ACTIVE_STATUSES.includes( record.status );
	const isArchived = record.status === ARCHIVED_STATUS;
	const isLocked = Boolean( record.cortext_frozen );

	useCommand( {
		name: 'cortext/action/new-document-inside',
		// Matched without the title, so searching for the open document
		// finds the document, not this action.
		searchLabel: __( 'Add a document inside', 'cortext' ),
		label: sprintf(
			/* translators: %s: title of the open document */
			__( 'Add a document inside %s…', 'cortext' ),
			title
		),
		context: CONTEXT,
		category: 'action',
		icon: newIcon,
		disabled:
			! permissions.canCreate || ! isActive || ! features.canCreateChild,
		callback: () => promptForNewDocument( record.id ),
	} );

	useCommand( {
		name: 'cortext/action/rename',
		label: __( 'Rename…', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: renameIcon,
		disabled: ! permissions.canUpdate || ! isActive || isLocked,
		callback: () =>
			openPrompt( {
				placeholder: __( 'New title', 'cortext' ),
				initialSearch: record.title?.raw ?? '',
				renderItems: ( { search, close } ) => {
					const newTitle = search.trim();
					if ( ! newTitle || newTitle === record.title?.raw ) {
						return null;
					}
					return (
						<PromptItem
							value="rename"
							icon={ renameIcon }
							label={ sprintf(
								/* translators: %s: new title of the document */
								__( 'Rename to “%s”', 'cortext' ),
								newTitle
							) }
							onSelect={ () =>
								run( close, () =>
									actions.rename( record, newTitle )
								)
							}
						/>
					);
				},
			} ),
	} );

	useCommand( {
		name: 'cortext/action/move',
		label: __( 'Move to…', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: moveIcon,
		disabled: ! permissions.canUpdate || ! isActive || ! features.hierarchy,
		callback: () =>
			openPrompt( {
				placeholder: __(
					'Search for a document to move it into',
					'cortext'
				),
				renderItems: ( { search, close, selectValue } ) => (
					<MoveDestinations
						record={ record }
						search={ search }
						selectValue={ selectValue }
						onMove={ ( parentId ) =>
							run( close, () => actions.move( record, parentId ) )
						}
					/>
				),
			} ),
	} );

	useCommand( {
		name: 'cortext/action/archive',
		label: __( 'Archive', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: archiveIcon,
		disabled: ! permissions.canUpdate || ! isActive,
		callback: ( { close } ) =>
			run( close, () => actions.archive( record ) ),
	} );

	useCommand( {
		name: 'cortext/action/unarchive',
		label: __( 'Unarchive', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: archiveIcon,
		disabled: ! permissions.canUpdate || ! isArchived,
		callback: ( { close } ) =>
			run( close, () => actions.unarchive( record ) ),
	} );

	useCommand( {
		name: 'cortext/action/trash',
		label: __( 'Move to Trash', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: trashIcon,
		disabled: ! permissions.canDelete || ! ( isActive || isArchived ),
		callback: ( { close } ) => run( close, () => actions.trash( record ) ),
	} );

	return null;
}

function NewDocumentCommand( { canCreate, run, openPrompt } ) {
	const promptForNewDocument = useNewDocumentPrompt( run, openPrompt );

	useCommand( {
		name: 'cortext/action/new-document',
		label: __( 'New document…', 'cortext' ),
		context: CONTEXT,
		category: 'action',
		icon: newIcon,
		disabled: ! canCreate,
		callback: () => promptForNewDocument( 0 ),
	} );

	return null;
}

export default function DocumentPaletteCommands( { focusCanvas, openPrompt } ) {
	const { record, canUpdate, canDelete } = useOpenDocument();
	const canCreate = useSelect(
		( select ) =>
			select( coreStore ).canUser( 'create', {
				kind: 'postType',
				name: DOCUMENT_POST_TYPE,
			} ),
		[]
	);
	const run = useRunFromPalette( focusCanvas );

	// The palette has no sidebar to hand focus back to, so the actions run
	// without the sidebar's callbacks, like the inspector's actions panel.
	return (
		<DocumentsProvider>
			<NewDocumentCommand
				canCreate={ Boolean( canCreate ) }
				run={ run }
				openPrompt={ openPrompt }
			/>
			{ record?.id && (
				<OpenDocumentCommands
					record={ record }
					permissions={ {
						canUpdate: Boolean( canUpdate ),
						canDelete: Boolean( canDelete ),
						canCreate: Boolean( canCreate ),
					} }
					run={ run }
					openPrompt={ openPrompt }
				/>
			) }
		</DocumentsProvider>
	);
}
