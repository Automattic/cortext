import { useMemo, useCallback, useEffect } from '@wordpress/element';
import { useNavigate, useParams } from '@tanstack/react-router';

import {
	computeDocumentUri,
	parseIdFromUri,
	parseSplatUri,
} from '../../router/useResolveEntity';

/**
 * Active route and selection state for the sidebar, plus the navigation
 * helpers the component needs (`onSelect`, `goHome`).
 *
 * Also keeps the URL canonical. Once autosave gives the active page a slug
 * on its first titled save, `?p=/42` becomes `?p=/about-us-42` with
 * history.replace. The id stays authoritative while the visible URL catches
 * up with the title.
 *
 * @param {Object}  args
 * @param {Array}   args.pages    Loaded `crtxt_page` records, used for hint-free `onSelect` lookups and the canonical URL effect.
 * @param {?string} args.homePath Resolved workspace home path, or null while loading.
 */
export default function useSidebarNavigation( { pages, homePath } ) {
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const activeUri = params._splat ?? '';

	const { prefix: activePrefix, tail: activeTail } = useMemo(
		() => parseSplatUri( activeUri ),
		[ activeUri ]
	);
	const selectedId = useMemo(
		() =>
			activePrefix === 'page' || activePrefix === null
				? parseIdFromUri( activeTail )
				: null,
		[ activePrefix, activeTail ]
	);
	const selectedCollectionId = useMemo(
		() =>
			activePrefix === 'collection' ? parseIdFromUri( activeTail ) : null,
		[ activePrefix, activeTail ]
	);

	useEffect( () => {
		if ( selectedId === null ) {
			return;
		}
		const current = pages.find( ( p ) => p.id === selectedId );
		if ( ! current ) {
			return;
		}
		const canonical = computeDocumentUri( current );
		if ( canonical !== activeUri ) {
			navigate( {
				to: '/$',
				params: { _splat: canonical },
				replace: true,
			} );
		}
	}, [ selectedId, pages, activeUri, navigate ] );

	// Callers that just created a record pass it as `pageHint`. After
	// `await saveEntityRecord`, React has not re-rendered yet, so this
	// closure's `pages` does not contain the new id. The id alone is enough
	// for a usable URL; the slug prefix is cosmetic.
	const onSelect = useCallback(
		( id, pageHint ) => {
			if ( id === null || id === undefined ) {
				navigate( { to: '/' } );
				return;
			}
			const page = pageHint ??
				pages.find( ( p ) => p.id === id ) ?? { id };
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( page ) },
			} );
		},
		[ navigate, pages ]
	);

	const goHome = useCallback( () => {
		if ( ! homePath ) {
			return;
		}
		navigate( {
			to: '/$',
			params: { _splat: homePath },
		} );
	}, [ homePath, navigate ] );

	return {
		navigate,
		activeUri,
		selectedId,
		selectedCollectionId,
		onSelect,
		goHome,
	};
}
