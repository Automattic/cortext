/**
 * The collections a row shows as traits and as property groups.
 *
 * A row keeps its membership in archived and trashed collections so a restore
 * can bring it back, and in collections the user cannot read. None of those
 * show while the row lives somewhere else, but all of them stay in every
 * write. A row retired together with all of its collections still lists the
 * ones the user can read.
 *
 * @param {Array} collections Membership summaries from the traits endpoint.
 * @return {Array} Summaries to render.
 */
export function visibleTraits( collections ) {
	const readable = collections.filter(
		( collection ) => collection.readable !== false
	);
	const live = readable.filter(
		( collection ) => collection.active !== false
	);
	return live.length > 0 ? live : readable;
}
