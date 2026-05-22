import { favoriteKey } from '../components/SidebarFavorites';
import { kindFromRecord } from './kinds';

/**
 * Resolve the favorites key for a record. Favorites are stored as `{ kind, id }`
 * pairs, and this helper keeps sidebar rows from branching on post type.
 *
 * @param {Object} record Document record.
 * @return {?string} Stable favorite key, or `null` for unknown kinds.
 */
export function favoriteKeyForRecord( record ) {
	const kind = kindFromRecord( record );
	if ( ! kind ) {
		return null;
	}
	return favoriteKey( { kind, id: record.id } );
}

/**
 * Build the `{ kind, id }` shape `useFavorites().setFavorites` expects.
 *
 * @param {Object} record Document record.
 * @return {?{kind: string, id: number}} Favorite identifier, or `null` for
 *                                       records with no resolvable kind.
 */
export function favoriteIdentForRecord( record ) {
	const kind = kindFromRecord( record );
	if ( ! kind ) {
		return null;
	}
	return { kind, id: Number( record.id ) };
}

/**
 * Drop any favorites whose `(kind, id)` appears in `deletedIds`.
 *
 * `deletedIds` is a map keyed by document kind (`page`, `collection`, …),
 * each value a Set of numeric ids.
 *
 * Page and collection descriptors build those sets today. When the server
 * returns cascade ids, it can pass them through this same filter.
 *
 * @param {Array}                       favorites  Current favorites list.
 * @param {Object<string, Set<number>>} deletedIds Cascade ids keyed by kind.
 * @return {Array} Filtered favorites list (same reference when nothing changed).
 */
export function filterFavoritesByDeletedIds( favorites, deletedIds ) {
	if ( ! Array.isArray( favorites ) || favorites.length === 0 ) {
		return favorites;
	}
	if ( ! deletedIds ) {
		return favorites;
	}
	return favorites.filter( ( favorite ) => {
		const idsForKind = deletedIds[ favorite.kind ];
		if ( ! idsForKind ) {
			return true;
		}
		return ! idsForKind.has( Number( favorite.id ) );
	} );
}

/**
 * Run the favorites cleanup shared by every trash flow: filter out the
 * cascade ids and surface any setFavorites failure through `onFavoritesError`.
 *
 * @param {Object}                      ctx             Descriptor context with `setFavorites` and `onFavoritesError`.
 * @param {Object<string, Set<number>>} deletedIds      Cascade ids keyed by kind.
 * @param {string}                      fallbackMessage Message used when the error has no own.
 */
export async function cascadeFavorites( ctx, deletedIds, fallbackMessage ) {
	try {
		await ctx.setFavorites( ( current ) =>
			filterFavoritesByDeletedIds( current, deletedIds )
		);
	} catch ( err ) {
		ctx.onFavoritesError?.( err?.message ?? fallbackMessage );
	}
}
