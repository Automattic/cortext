import { useCallback, useState } from '@wordpress/element';

export const SIDEBAR_SECTIONS_COLLAPSED_KEY =
	'cortext.sidebarSectionsCollapsed';

export const SIDEBAR_SECTION_DEFAULTS = {
	recents: true,
	favorites: false,
	pages: false,
	collections: false,
	trash: false,
};

export function normalizeSidebarSectionsCollapsed( value ) {
	let parsed = value;

	if ( typeof value === 'string' ) {
		try {
			parsed = JSON.parse( value );
		} catch {
			return { ...SIDEBAR_SECTION_DEFAULTS };
		}
	}

	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		return { ...SIDEBAR_SECTION_DEFAULTS };
	}

	return Object.entries( parsed ).reduce(
		( next, [ key, isCollapsed ] ) => {
			if ( typeof isCollapsed === 'boolean' ) {
				next[ key ] = isCollapsed;
			}
			return next;
		},
		{ ...SIDEBAR_SECTION_DEFAULTS }
	);
}

function readStoredSections() {
	try {
		return normalizeSidebarSectionsCollapsed(
			window.localStorage.getItem( SIDEBAR_SECTIONS_COLLAPSED_KEY )
		);
	} catch {
		return { ...SIDEBAR_SECTION_DEFAULTS };
	}
}

function persistSections( sections ) {
	try {
		window.localStorage.setItem(
			SIDEBAR_SECTIONS_COLLAPSED_KEY,
			JSON.stringify( sections )
		);
	} catch {
		// Storage can be denied; keep the in-memory choice for this session.
	}
}

export default function useSidebarSections() {
	const [ collapsedSections, setCollapsedSections ] =
		useState( readStoredSections );

	const setSectionCollapsed = useCallback( ( id, isCollapsed ) => {
		setCollapsedSections( ( current ) => {
			const next = {
				...SIDEBAR_SECTION_DEFAULTS,
				...current,
				[ id ]: Boolean( isCollapsed ),
			};
			persistSections( next );
			return next;
		} );
	}, [] );

	const toggleSection = useCallback( ( id ) => {
		setCollapsedSections( ( current ) => {
			const merged = { ...SIDEBAR_SECTION_DEFAULTS, ...current };
			const next = {
				...merged,
				[ id ]: ! Boolean( merged[ id ] ),
			};
			persistSections( next );
			return next;
		} );
	}, [] );

	const isSectionCollapsed = useCallback(
		( id ) =>
			Boolean(
				collapsedSections[ id ] ??
					SIDEBAR_SECTION_DEFAULTS[ id ] ??
					false
			),
		[ collapsedSections ]
	);

	return {
		collapsedSections,
		isSectionCollapsed,
		setSectionCollapsed,
		toggleSection,
	};
}
