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
import { favoriteKey } from '../components/SidebarFavorites';
import { documentTitle } from './title';
import { favoriteIdentForRecord, favoriteKeyForRecord } from './favorites';
import { iconForRecord } from './icons';
import { kindFromRecord } from './kinds';
import { getDescriptor } from './descriptors';

/**
 * Sidebar-scoped context for document actions. The provider supplies the data
 * and callbacks descriptors need: pages/collections for trash cleanup,
 * navigation helpers, and UI notices.
 *
 * Components should use the hooks below instead of reading this context
 * directly.
 */
const DocumentsContext = createContext( null );

export function DocumentsProvider( {
	selectedCollectionId = null,
	expand,
	onSelect,
	onAutoRename,
	onAfterTrash,
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
			onAfterTrash,
			onDuplicateNotice,
			onFavoritesError,
		} ),
		[
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename,
			onAfterTrash,
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
 * Bind descriptor actions to the current dispatcher, navigation, and UI
 * callbacks. Returns async `rename`, `duplicate`, and `trash` functions.
 *
 * `duplicate` resolves to the created record; descriptors handle the usual
 * post-create selection or notice work themselves.
 */
export function useDocumentActions() {
	const docCtx = useDocumentsContext();
	const { saveEntityRecord, invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );
	const navigate = useNavigate();
	const { touchRecent } = useRecents();
	const { setFavorites } = useFavorites();

	const ctx = useMemo(
		() => ( {
			...docCtx,
			saveEntityRecord,
			invalidateResolution,
			receiveEntityRecords,
			navigate,
			touchRecent,
			setFavorites,
		} ),
		[
			docCtx,
			saveEntityRecord,
			invalidateResolution,
			receiveEntityRecords,
			navigate,
			touchRecent,
			setFavorites,
		]
	);

	const rename = useCallback(
		async ( record, title ) => {
			const descriptor = descriptorFor( record );
			if ( ! descriptor.rename ) {
				return;
			}
			return descriptor.rename( record, title, ctx );
		},
		[ ctx ]
	);

	const duplicate = useCallback(
		async ( record ) => {
			const descriptor = descriptorFor( record );
			if ( ! descriptor.duplicate ) {
				return undefined;
			}
			return descriptor.duplicate( record, ctx );
		},
		[ ctx ]
	);

	const trash = useCallback(
		async ( record ) => {
			const descriptor = descriptorFor( record );
			if ( ! descriptor.trash ) {
				return;
			}
			return descriptor.trash( record, ctx );
		},
		[ ctx ]
	);

	return useMemo(
		() => ( { rename, duplicate, trash } ),
		[ rename, duplicate, trash ]
	);
}

/**
 * Resolve the display bits for a record: kind, title, icon, and feature flags.
 * Components should prefer the feature flags over their own kind checks.
 *
 * @param {Object} record Document record (page, collection, or row).
 * @return {Object} `{ kind, title, icon, features }` display attributes.
 */
export function useDocumentRecord( record ) {
	const kind = kindFromRecord( record );
	const descriptor = getDescriptor( kind );
	const title = documentTitle( record );
	const icon = iconForRecord( record, kind );
	return {
		kind,
		title,
		icon,
		features: descriptor.features,
	};
}

/**
 * Toggle "favorite" on any document record. Hides the favorites bookkeeping
 * the sidebar and DataView were each doing inline: building the `{kind,id}`
 * ident, maintaining a key set, and rewriting the favorites list around it.
 *
 * Errors surface through `onError` so each caller can attach them to its own
 * notice. The hook clears the previous error before every attempt, so passing
 * `null` to the caller's setter is part of the contract.
 *
 * @param {Object}   [options]
 * @param {Function} [options.onError] Called with a message (or `null`) when a
 *                                     toggle attempt fails or is retried.
 * @return {{isFavorite: Function, toggle: Function, disabled: boolean}} Helpers
 *                                                                       bound
 *                                                                       to the
 *                                                                       current
 *                                                                       favorites
 *                                                                       state.
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
 * Selection and navigation helpers for sidebar rows. Pages and collections
 * each have their own selected-id prop; the active route can only ever set
 * one, so collapsing them into a single id is safe and keeps the comparison
 * record-agnostic. Navigation comes from the descriptor so kinds stay opaque.
 *
 * @param {Object}  args
 * @param {?number} args.selectedId           Active page id, or `null`.
 * @param {?number} args.selectedCollectionId Active collection id, or `null`.
 * @return {{isSelected: Function, selectRecord: Function}} Memoised helpers.
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
			const uri = descriptorFor( record ).uri?.( record );
			if ( ! uri ) {
				return;
			}
			navigate( { to: '/$', params: { _splat: uri } } );
		},
		[ navigate ]
	);

	return useMemo(
		() => ( { isSelected, selectRecord } ),
		[ isSelected, selectRecord ]
	);
}

function descriptorFor( record ) {
	return getDescriptor( kindFromRecord( record ) );
}
