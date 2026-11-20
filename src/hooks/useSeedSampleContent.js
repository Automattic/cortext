import apiFetch from '@wordpress/api-fetch';
import { useCallback, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Seeds the optional sample content via REST and reloads once it lands.
 *
 * The reload lets EntityRoute pick up the freshly created pages and route to
 * the first document, and drops the empty-state CTA because the workspace is
 * no longer empty. The seed endpoint is idempotent, so a retry after a
 * partial failure reuses what already exists instead of duplicating it.
 *
 * @return {{seed: Function, isSeeding: boolean, error: string}} Seed handler and status.
 */
export default function useSeedSampleContent() {
	const [ isSeeding, setIsSeeding ] = useState( false );
	const [ error, setError ] = useState( '' );

	const seed = useCallback( async () => {
		if ( isSeeding ) {
			return;
		}

		setIsSeeding( true );
		setError( '' );

		try {
			await apiFetch( {
				path: '/cortext/v1/sample-content/seed',
				method: 'POST',
			} );
			window.location.reload();
		} catch ( err ) {
			setError(
				err?.message || __( "Couldn't add demo content.", 'cortext' )
			);
			setIsSeeding( false );
		}
	}, [ isSeeding ] );

	return { seed, isSeeding, error };
}
