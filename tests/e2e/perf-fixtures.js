/**
 * Helpers shared by the UI perf specs. Collections are resolved by meta.slug,
 * not post_name, so the helper lists the small seed set and picks the matching
 * meta value.
 */

async function resolveCollectionAdminUrl( requestUtils, slug ) {
	const collections = await requestUtils.rest( {
		path: '/wp/v2/crtxt_collections',
		params: {
			context: 'edit',
			per_page: 100,
			status: 'private,publish,draft',
			_fields: 'id,meta',
		},
	} );

	const match = ( Array.isArray( collections ) ? collections : [] ).find(
		( entry ) => entry?.meta?.slug === slug
	);

	if ( ! match ) {
		throw new Error(
			`Could not find a collection with slug "${ slug }". Run \`wp cortext perf-seed --reset --force\` first.`
		);
	}

	return {
		id: match.id,
		adminQuery: `page=cortext&p=/collection/${ slug }-${ match.id }`,
	};
}

module.exports = { resolveCollectionAdminUrl };
