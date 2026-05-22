import {
	createContext,
	useCallback,
	useContext,
	useMemo,
} from '@wordpress/element';
import { useDispatch } from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';

import { useFavorites } from '../hooks/useFavorites';
import { useRecents } from '../hooks/useRecents';
import { documentTitle } from './title';
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
