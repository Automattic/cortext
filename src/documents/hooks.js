import {
	createContext,
	useCallback,
	useContext,
	useMemo,
} from '@wordpress/element';
import { useDispatch } from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';

import { __ } from '@wordpress/i18n';

import { useFavorites } from '../hooks/useFavorites';
import { useRecents } from '../hooks/useRecents';
import { documentTitle } from './title';
import {
	favoriteKey,
	favoriteIdentForRecord,
	favoriteKeyForRecord,
} from './favorites';
import { iconForRecord, listIconForRecord } from './icons';
import { documentFeatures } from './capabilities';
import {
	nestedDocumentCountLabel,
	permanentDeleteDocumentConfirmation,
} from './labels';
import {
	renameDocument,
	duplicateDocument,
	trashDocument,
	restoreDocument,
	archiveDocument,
	unarchiveDocument,
	permanentlyDeleteDocument,
} from './actions';
import { computeDocumentUri } from '../router/useResolveEntity';
import { useActiveEditor } from '../components/ActiveEditorContext';

/**
 * Sidebar-scoped context for document actions. The provider supplies the data
 * and callbacks the actions need: navigation helpers, UI notices, and the
 * trash-cleanup error handler.
 */
const DocumentsContext = createContext( null );

export function DocumentsProvider( {
	selectedCollectionId = null,
	expand,
	onSelect,
	onAutoRename,
	captureLifecycleFocusIntent,
	cancelLifecycleFocusIntent,
	onAfterTrash,
	onAfterArchive,
	onDuplicateNotice,
	onFavoritesError,
	children,
} ) {
	const value = useMemo(
		() => ( {
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename,
			captureLifecycleFocusIntent,
			cancelLifecycleFocusIntent,
			onAfterTrash,
			onAfterArchive,
			onDuplicateNotice,
			onFavoritesError,
		} ),
		[
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename,
			captureLifecycleFocusIntent,
			cancelLifecycleFocusIntent,
			onAfterTrash,
			onAfterArchive,
			onDuplicateNotice,
			onFavoritesError,
		]
	);

	return (
		<DocumentsContext.Provider value={ value }>
			{ children }
		</DocumentsContext.Provider>
	);
}

function useDocumentsContext() {
	const ctx = useContext( DocumentsContext );
	if ( ! ctx ) {
		throw new Error(
			'Document hooks must be used inside <DocumentsProvider>'
		);
	}
	return ctx;
}

/**
 * Bind action functions to the current dispatcher, router, and UI callbacks.
 *
 * `duplicate` resolves to the created record and `permanentDelete` resolves
 * to the REST response (with the deleted ids) so callers can react to it.
 */
export function useDocumentActions() {
	const docCtx = useDocumentsContext();
	const { saveEntityRecord, invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );
	const { createSuccessNotice } = useDispatch( 'core/notices' );
	const navigate = useNavigate();
	const { touchRecent } = useRecents();
	const { setFavorites } = useFavorites();
	const { flushActiveEditor } = useActiveEditor();

	const ctx = useMemo(
		() => ( {
			...docCtx,
			saveEntityRecord,
			invalidateResolution,
			receiveEntityRecords,
			navigate,
			touchRecent,
			setFavorites,
			createSuccessNotice,
			flushActiveEditor,
		} ),
		[
			docCtx,
			saveEntityRecord,
			invalidateResolution,
			receiveEntityRecords,
			navigate,
			touchRecent,
			setFavorites,
			createSuccessNotice,
			flushActiveEditor,
		]
	);

	const rename = useCallback(
		async ( record, title ) => renameDocument( record, title, ctx ),
		[ ctx ]
	);

	const duplicate = useCallback(
		async ( record ) => duplicateDocument( record, ctx ),
		[ ctx ]
	);

	const trash = useCallback(
		async ( record ) => trashDocument( record, ctx ),
		[ ctx ]
	);

	const restore = useCallback(
		async ( record ) => restoreDocument( record, ctx ),
		[ ctx ]
	);

	const archive = useCallback(
		async ( record ) => archiveDocument( record, ctx ),
		[ ctx ]
	);

	const unarchive = useCallback(
		async ( record ) => unarchiveDocument( record, ctx ),
		[ ctx ]
	);

	const permanentDelete = useCallback(
		async ( record ) => permanentlyDeleteDocument( record, ctx ),
		[ ctx ]
	);

	return useMemo(
		() => ( {
			rename,
			duplicate,
			trash,
			restore,
			archive,
			unarchive,
			permanentDelete,
		} ),
		[
			rename,
			duplicate,
			trash,
			restore,
			archive,
			unarchive,
			permanentDelete,
		]
	);
}

/**
 * Display data for a record: title, icons, feature flags, and trash-list copy.
 *
 * @param {Object} record Document record.
 */
export function useDocumentRecord( record ) {
	return {
		title: documentTitle( record ),
		icon: iconForRecord( record ),
		listIcon: ( size ) => listIconForRecord( record, size ),
		features: documentFeatures( record ),
		nestedDocumentCountLabel: ( counts ) =>
			nestedDocumentCountLabel( counts ),
		permanentDeleteDocumentConfirmation: ( counts ) =>
			permanentDeleteDocumentConfirmation( record, counts ),
	};
}

/**
 * Toggle "favorite" on any document record.
 *
 * @param {Object}   [options]
 * @param {Function} [options.onError] Called with a message (or `null`) when a
 *                                     toggle attempt fails or is retried.
 */
export function useFavoriteToggle( { onError } = {} ) {
	const { favorites, isResolving, isUpdating, setFavorites } = useFavorites();

	const favoriteKeys = useMemo(
		() =>
			new Set( favorites.map( ( favorite ) => favoriteKey( favorite ) ) ),
		[ favorites ]
	);

	const disabled = isResolving || isUpdating;

	const isFavorite = useCallback(
		( record ) => {
			const key = favoriteKeyForRecord( record );
			return key !== null && favoriteKeys.has( key );
		},
		[ favoriteKeys ]
	);

	const toggle = useCallback(
		async ( record ) => {
			if ( disabled ) {
				return;
			}
			const ident = favoriteIdentForRecord( record );
			if ( ! ident ) {
				return;
			}
			const key = favoriteKey( ident );
			onError?.( null );
			try {
				await setFavorites( ( current ) => {
					const exists = current.some(
						( favorite ) => favoriteKey( favorite ) === key
					);
					return exists
						? current.filter(
								( favorite ) => favoriteKey( favorite ) !== key
						  )
						: [ ...current, ident ];
				} );
			} catch ( err ) {
				onError?.(
					err?.message ??
						__( 'Could not update favorites.', 'cortext' )
				);
			}
		},
		[ disabled, onError, setFavorites ]
	);

	return useMemo(
		() => ( { isFavorite, toggle, disabled } ),
		[ isFavorite, toggle, disabled ]
	);
}

/**
 * Selection and navigation helpers for sidebar rows.
 *
 * @param {Object}  args
 * @param {?number} args.selectedId           Active page id, or `null`.
 * @param {?number} args.selectedCollectionId Active collection id, or `null`.
 */
export function useDocumentSelection( { selectedId, selectedCollectionId } ) {
	const navigate = useNavigate();
	const selectedRecordId = selectedCollectionId ?? selectedId ?? null;

	const isSelected = useCallback(
		( record ) => record.id === selectedRecordId,
		[ selectedRecordId ]
	);

	const selectRecord = useCallback(
		( record ) => {
			if ( ! record?.id ) {
				return;
			}
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( record ) },
			} );
		},
		[ navigate ]
	);

	return useMemo(
		() => ( { isSelected, selectRecord } ),
		[ isSelected, selectRecord ]
	);
}
