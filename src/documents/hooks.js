import {
	createContext,
	useCallback,
	useContext,
	useMemo,
} from '@wordpress/element';
import { useDispatch } from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';

import {
	computeCollectionUri,
	computeDocumentUri,
} from '../router/useResolveEntity';
import { useFavorites } from '../hooks/useFavorites';
import { useRecents } from '../hooks/useRecents';
import { documentTitle } from './title';
import { iconForRecord } from './icons';
import { kindFromRecord } from './kinds';
import { getDescriptor } from './descriptors';
import { filterFavoritesByDeletedIds } from './favorites';

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
	pages,
	collections,
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
			pages,
			collections,
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename,
			onAfterTrash,
			onDuplicateNotice,
			onFavoritesError,
		} ),
		[
			pages,
			collections,
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
 * Selection and navigation helpers for sidebar rows. They hide the page versus
 * collection route differences from `DocumentRow`.
 *
 * @param {Object}  args
 * @param {?number} args.selectedId           Active page id, or `null`.
 * @param {?number} args.selectedCollectionId Active collection id, or `null`.
 * @return {{isSelected: Function, selectRecord: Function}} Memoised helpers.
 */
export function useDocumentSelection( { selectedId, selectedCollectionId } ) {
	const navigate = useNavigate();

	const isSelected = useCallback(
		( record ) => {
			const kind = kindFromRecord( record );
			if ( kind === 'collection' ) {
				return selectedCollectionId === record.id;
			}
			return selectedId === record.id;
		},
		[ selectedId, selectedCollectionId ]
	);

	const selectRecord = useCallback(
		( record ) => {
			const kind = kindFromRecord( record );
			const uri =
				kind === 'collection'
					? computeCollectionUri( record )
					: computeDocumentUri( record );
			navigate( { to: '/$', params: { _splat: uri } } );
		},
		[ navigate ]
	);

	return useMemo(
		() => ( { isSelected, selectRecord } ),
		[ isSelected, selectRecord ]
	);
}

/**
 * Favorites cleanup helper for trash flows. Callers pass the ids that were
 * removed, grouped by document kind.
 */
export function useTrashCascadeEffects() {
	return useMemo(
		() => ( {
			filterFavoritesAfterTrash( favorites, deletedIds ) {
				return filterFavoritesByDeletedIds( favorites, deletedIds );
			},
		} ),
		[]
	);
}

function descriptorFor( record ) {
	return getDescriptor( kindFromRecord( record ) );
}
