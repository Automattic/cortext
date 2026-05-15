import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Parent collection summary attached to row documents.
 *
 * @typedef {Object} CortextDocumentCollection
 * @property {number} id    Collection post id.
 * @property {string} title Plain-text title (falls back to `(untitled)`).
 * @property {string} path  Splat path for the collection, e.g. `collection/projects-12`.
 */

/**
 * One Cortext document as returned by `/cortext/v1/documents`. Mirrors the
 * lightweight shape that recents and trash use, plus an optional excerpt for
 * search-style consumers.
 *
 * @typedef {Object} CortextDocument
 * @property {'page'|'row'}              kind         Document kind.
 * @property {number}                    id           Post id.
 * @property {string}                    title        Plain-text title.
 * @property {string}                    path         Splat path for navigation.
 * @property {string}                    [excerpt]    Short plain-text excerpt.
 * @property {string}                    [icon]       Icon JSON blob (pages only).
 * @property {CortextDocumentCollection} [collection] Parent collection summary (rows only).
 */

const DEFAULT_PER_PAGE = 20;

function readNumber( value, fallback ) {
	const parsed = Number( value );
	return Number.isFinite( parsed ) ? parsed : fallback;
}

/**
 * Fetches Cortext documents (pages and collection rows) through the unified
 * read service. State machine mirrors `useTrashedDocuments` so consumers can
 * reuse the same loading/empty/error patterns.
 *
 * @param {Object}          [options]
 * @param {string}          [options.search]  Free-text search string.
 * @param {'page'|'row'|''} [options.kind]    Filter to a specific document kind.
 * @param {number}          [options.page]    1-based page number.
 * @param {number}          [options.perPage] Page size, clamped server-side to 100.
 *
 * @return {{
 *   documents: CortextDocument[],
 *   total: number,
 *   isLoading: boolean,
 *   hasResolved: boolean,
 *   error: unknown,
 *   refresh: () => void,
 * }} Current documents plus loading state and a manual refresh trigger.
 */
export default function useDocuments( options = {} ) {
	const {
		search = '',
		kind = '',
		page = 1,
		perPage = DEFAULT_PER_PAGE,
	} = options;

	const [ state, setState ] = useState( {
		documents: [],
		total: 0,
		isLoading: false,
		hasResolved: false,
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const requestIdRef = useRef( 0 );

	const refresh = useCallback( () => {
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	const query = useMemo( () => {
		const params = new URLSearchParams();
		if ( search ) {
			params.set( 'search', search );
		}
		if ( kind ) {
			params.set( 'kind', kind );
		}
		if ( page > 1 ) {
			params.set( 'page', String( page ) );
		}
		if ( perPage !== DEFAULT_PER_PAGE ) {
			params.set( 'per_page', String( perPage ) );
		}
		const qs = params.toString();
		return qs ? `?${ qs }` : '';
	}, [ search, kind, page, perPage ] );

	useEffect( () => {
		const requestId = ++requestIdRef.current;

		setState( ( current ) => ( {
			...current,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		apiFetch( { path: `/cortext/v1/documents${ query }` } )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				const documents = Array.isArray( body?.documents )
					? body.documents
					: [];
				setState( {
					documents,
					total: readNumber( body?.total, documents.length ),
					isLoading: false,
					hasResolved: true,
					error: null,
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( ( current ) => ( {
					...current,
					isLoading: false,
					hasResolved: true,
					error,
				} ) );
			} );
	}, [ query, refreshKey ] );

	return { ...state, refresh };
}
