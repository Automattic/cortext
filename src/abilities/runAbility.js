/**
 * Runs a Cortext ability through core's abilities client.
 *
 * Core ships `@wordpress/abilities` and `@wordpress/core-abilities` only as
 * script modules, declared as dynamic dependencies of the app bundle, so
 * they load the first time an action runs. `core-abilities` registers the
 * server abilities once its `ready` promise resolves.
 */
let client = null;

function loadClient() {
	if ( ! client ) {
		client = Promise.all( [
			// Resolved by the import map WordPress prints, not by the bundler.
			// eslint-disable-next-line import/no-unresolved
			import( /* webpackIgnore: true */ '@wordpress/abilities' ),
			// eslint-disable-next-line import/no-unresolved
			import( /* webpackIgnore: true */ '@wordpress/core-abilities' ),
		] )
			.then( async ( [ abilities, coreAbilities ] ) => {
				await coreAbilities.ready;
				return abilities;
			} )
			.catch( ( error ) => {
				client = null;
				throw error;
			} );
	}
	return client;
}

/**
 * @param {string} name  Ability name, such as `cortext/archive-document`.
 * @param {Object} input Ability input.
 * @return {Promise<*>} The ability's output.
 */
export async function runAbility( name, input ) {
	const { executeAbility } = await loadClient();
	return executeAbility( name, input );
}
