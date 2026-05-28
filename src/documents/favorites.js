export function favoriteKey( favorite ) {
	return `favorite:${ Number( favorite.id ) }`;
}

/**
 * Stable favorites key for a record.
 *
 * @param {Object} record Document record.
 */
export function favoriteKeyForRecord( record ) {
	if ( ! record?.id ) {
		return null;
	}
	return favoriteKey( { id: record.id } );
}

/**
 * Build the `{ id }` shape `useFavorites().setFavorites` expects.
 *
 * @param {Object} record Document record.
 */
export function favoriteIdentForRecord( record ) {
	if ( ! record?.id ) {
		return null;
	}
	return { id: Number( record.id ) };
}

/**
 * Drop any favorites whose id appears in `deletedIds`. Every editable record
 * lives in `crtxt_document`, so a single id is enough to match.
 *
 * @param {Array}       favorites  Current favorites list.
 * @param {Set<number>} deletedIds Cascade ids to remove.
 * @return {Array} Filtered favorites list (same reference when nothing changed).
 */
export function filterFavoritesByDeletedIds( favorites, deletedIds ) {
	if ( ! Array.isArray( favorites ) || favorites.length === 0 ) {
		return favorites;
	}
	if ( ! deletedIds || deletedIds.size === 0 ) {
		return favorites;
	}
	const next = favorites.filter(
		( favorite ) => ! deletedIds.has( Number( favorite.id ) )
	);
	return next.length === favorites.length ? favorites : next;
}

/**
 * Run the favorites cleanup shared by every trash flow.
 *
 * @param {Object}      ctx             Descriptor context with `setFavorites` and `onFavoritesError`.
 * @param {Set<number>} deletedIds      Cascade ids to remove.
 * @param {string}      fallbackMessage Message used when the error has no own.
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
