import apiFetch from '@wordpress/api-fetch';
import { isValidElement, renderToString } from '@wordpress/element';
import * as icons from '@wordpress/icons';
import { Icon } from '@wordpress/icons';

import { CORTEXT_GLYPHS } from '../cortextIcons';
import { ICON_COLOR_BY_NAME } from '../iconColors';
import { MENTION_ATTRIBUTE } from './constants';

const COLLECTION_ICON = JSON.stringify( { type: 'wp', name: 'collection' } );
const ROW_ICON = JSON.stringify( { type: 'wp', name: 'listItem' } );
const HYDRATED_FOR_ATTRIBUTE = 'data-crtxt-icon-hydrated-for';
const MENTION_SELECTED_CLASS = 'is-cortext-mention-selected';
const ICON_ATTRIBUTES = [
	'data-crtxt-icon-emoji',
	'data-crtxt-icon-image',
	'data-crtxt-icon-wp',
	'data-crtxt-icon-color',
];
const ICON_STYLE_PROPERTIES = [
	'--cortext-mention-icon-image',
	'--cortext-mention-icon-color',
	'--cortext-mention-icon-mask',
];
const wpIconMaskCache = new Map();
const mentionTargetIconCache = new Map();
const mentionIconHydrators = new WeakMap();

function updateAttribute( element, name, value ) {
	if ( value ) {
		if ( element.getAttribute( name ) === value ) {
			return false;
		}
		element.setAttribute( name, value );
		return true;
	}
	if ( element.hasAttribute( name ) ) {
		element.removeAttribute( name );
		return true;
	}
	return false;
}

function updateStyleProperty( element, property, value ) {
	if ( value ) {
		if ( element.style.getPropertyValue( property ) === value ) {
			return false;
		}
		element.style.setProperty( property, value );
		return true;
	}
	if ( element.style.getPropertyValue( property ) ) {
		element.style.removeProperty( property );
		return true;
	}
	return false;
}

function rangeIntersectsNode( range, node ) {
	try {
		return range.intersectsNode( node );
	} catch {
		return false;
	}
}

export function updateMentionSelectionState( ownerDocument = document ) {
	ownerDocument
		.querySelectorAll?.( `.cortext-mention.${ MENTION_SELECTED_CLASS }` )
		.forEach( ( anchor ) => {
			anchor.classList.remove( MENTION_SELECTED_CLASS );
		} );

	const selection = ownerDocument.getSelection?.();
	if ( ! selection || selection.isCollapsed || selection.rangeCount === 0 ) {
		return;
	}

	const ranges = Array.from( { length: selection.rangeCount }, ( _, index ) =>
		selection.getRangeAt( index )
	);
	ownerDocument
		.querySelectorAll?.( '.cortext-mention' )
		.forEach( ( anchor ) => {
			if (
				ranges.some( ( range ) => rangeIntersectsNode( range, anchor ) )
			) {
				anchor.classList.add( MENTION_SELECTED_CLASS );
			}
		} );
}

export function mentionIconForRecord( record ) {
	const icon = record?.icon ?? record?.meta?.cortext_document_icon ?? '';
	if ( icon ) {
		return icon;
	}
	if ( record?.cortext_defines_trait === true ) {
		return COLLECTION_ICON;
	}
	if ( Array.isArray( record?.crtxt_trait ) && record.crtxt_trait.length ) {
		return ROW_ICON;
	}
	return '';
}

export function parseMentionIcon( icon ) {
	if ( ! icon ) {
		return null;
	}

	try {
		const parsed = JSON.parse( icon );
		if (
			parsed?.type === 'emoji' &&
			typeof parsed.value === 'string' &&
			parsed.value !== ''
		) {
			return { type: 'emoji', value: parsed.value };
		}
		if (
			parsed?.type === 'image' &&
			Number.isInteger( parsed.id ) &&
			parsed.id > 0
		) {
			return { type: 'image', id: parsed.id };
		}
		if (
			parsed?.type === 'wp' &&
			typeof parsed.name === 'string' &&
			parsed.name !== ''
		) {
			const color =
				typeof parsed.color === 'string' &&
				ICON_COLOR_BY_NAME[ parsed.color ]
					? parsed.color
					: null;
			return { type: 'wp', name: parsed.name, color };
		}
	} catch {
		return null;
	}

	return null;
}

export function mentionEmojiFromIcon( icon ) {
	const parsed = parseMentionIcon( icon );
	return parsed?.type === 'emoji' ? parsed.value : '';
}

export function mentionIconImageId( icon ) {
	const parsed = parseMentionIcon( icon );
	return parsed?.type === 'image' ? parsed.id : 0;
}

export function mentionImageUrlFromMedia( media ) {
	return (
		media?.media_details?.sizes?.thumbnail?.source_url ??
		media?.source_url ??
		''
	);
}

export async function fetchMentionIconImageUrl( icon ) {
	const id = mentionIconImageId( icon );
	if ( ! id ) {
		return '';
	}

	try {
		const media = await apiFetch( {
			path: `/wp/v2/media/${ id }?context=edit&_fields=id,source_url,media_details`,
		} );
		return mentionImageUrlFromMedia( media );
	} catch {
		return '';
	}
}

function cssUrl( value ) {
	return `url("${ String( value ).replace( /["\\\n\r]/g, '\\$&' ) }")`;
}

export function mentionWpIconMask( name ) {
	if ( wpIconMaskCache.has( name ) ) {
		return wpIconMaskCache.get( name );
	}

	const glyph = CORTEXT_GLYPHS[ name ] ?? icons[ name ];
	if ( ! isValidElement( glyph ) ) {
		wpIconMaskCache.set( name, '' );
		return '';
	}
	const svg = renderToString( <Icon icon={ glyph } /> ).replaceAll(
		'currentColor',
		'black'
	);
	const mask = `url("data:image/svg+xml,${ encodeURIComponent( svg ) }")`;
	wpIconMaskCache.set( name, mask );
	return mask;
}

export function hydrateMentionWpIconMasks( root = document ) {
	root.querySelectorAll?.( '.cortext-mention[data-crtxt-icon-wp]' ).forEach(
		( anchor ) => {
			const name = anchor.getAttribute( 'data-crtxt-icon-wp' );
			if ( ! name ) {
				return;
			}
			const mask = mentionWpIconMask( name );
			if ( mask ) {
				updateStyleProperty(
					anchor,
					'--cortext-mention-icon-mask',
					mask
				);
			}
		}
	);
}

function mentionIdFromAnchor( anchor ) {
	const id = Number.parseInt(
		anchor?.getAttribute?.( MENTION_ATTRIBUTE ) ?? '',
		10
	);
	return id > 0 ? id : 0;
}

function fetchMentionTargetIcon( id ) {
	if ( ! id ) {
		return Promise.resolve( { icon: '', imageUrl: '' } );
	}

	if ( mentionTargetIconCache.has( id ) ) {
		return mentionTargetIconCache.get( id );
	}

	// Cache icon lookups for this session. A mention keeps the icon found on
	// first hydration; failed requests are dropped so a later mutation can retry.
	const promise = apiFetch( {
		path: `/wp/v2/crtxt_documents/${ id }?context=edit&_fields=id,meta,cortext_defines_trait,crtxt_trait`,
	} )
		.then( async ( record ) => {
			const icon = mentionIconForRecord( record );
			const imageUrl = await fetchMentionIconImageUrl( icon );
			return { icon, imageUrl };
		} )
		.catch( () => {
			mentionTargetIconCache.delete( id );
			return { icon: '', imageUrl: '' };
		} );

	mentionTargetIconCache.set( id, promise );
	return promise;
}

function mentionIconDomSnapshot( icon, imageUrl = '' ) {
	const { attributes, style } = mentionIconSnapshotAttributes(
		icon,
		imageUrl
	);
	const wpIconName = attributes[ 'data-crtxt-icon-wp' ];
	if ( wpIconName ) {
		const mask = mentionWpIconMask( wpIconName );
		if ( mask ) {
			style[ '--cortext-mention-icon-mask' ] = mask;
		}
	}
	return { attributes, style };
}

function mentionIconDomSnapshotMatches( anchor, icon, imageUrl = '' ) {
	const { attributes, style } = mentionIconDomSnapshot( icon, imageUrl );
	return (
		ICON_ATTRIBUTES.every(
			( name ) =>
				( anchor.getAttribute( name ) ?? '' ) ===
				( attributes[ name ] ?? '' )
		) &&
		ICON_STYLE_PROPERTIES.every(
			( property ) =>
				anchor.style.getPropertyValue( property ) ===
				( style[ property ] ?? '' )
		)
	);
}

function applyMentionIcon( anchor, icon, imageUrl = '' ) {
	const { attributes, style } = mentionIconDomSnapshot( icon, imageUrl );

	ICON_ATTRIBUTES.forEach( ( name ) => {
		updateAttribute( anchor, name, attributes[ name ] ?? '' );
	} );
	ICON_STYLE_PROPERTIES.forEach( ( property ) => {
		updateStyleProperty( anchor, property, style[ property ] ?? '' );
	} );
}

export async function hydrateMentionIcons( root = document ) {
	const anchors = [
		...( root.querySelectorAll?.(
			`.cortext-mention[${ MENTION_ATTRIBUTE }]`
		) ?? [] ),
	];

	hydrateMentionWpIconMasks( root );

	await Promise.all(
		anchors.map( async ( anchor ) => {
			const id = mentionIdFromAnchor( anchor );
			if ( ! id ) {
				return;
			}

			const { icon, imageUrl } = await fetchMentionTargetIcon( id );
			if (
				anchor.getAttribute( HYDRATED_FOR_ATTRIBUTE ) ===
					String( id ) &&
				mentionIconDomSnapshotMatches( anchor, icon, imageUrl )
			) {
				return;
			}

			applyMentionIcon( anchor, icon, imageUrl );
			updateAttribute( anchor, HYDRATED_FOR_ATTRIBUTE, String( id ) );
		} )
	);
}

export function retainMentionIconHydrator( ownerDocument ) {
	if ( ! ownerDocument ) {
		return () => {};
	}

	let entry = mentionIconHydrators.get( ownerDocument );
	if ( ! entry ) {
		const hydrate = () => {
			void hydrateMentionIcons( ownerDocument );
		};
		const view = ownerDocument.defaultView;
		let hydrateScheduled = false;
		// Batch editor mutation bursts into one hydrate per frame.
		const scheduleHydrate = () => {
			if ( hydrateScheduled ) {
				return;
			}
			hydrateScheduled = true;
			const run = () => {
				hydrateScheduled = false;
				hydrate();
			};
			if ( view?.requestAnimationFrame ) {
				view.requestAnimationFrame( run );
			} else {
				run();
			}
		};
		const updateSelection = () => {
			updateMentionSelectionState( ownerDocument );
		};
		const MutationObserver = view?.MutationObserver;
		const observer =
			MutationObserver && ownerDocument.body
				? new MutationObserver( ( mutations ) => {
						if (
							mutations.some(
								( mutation ) =>
									mutation.type === 'childList' ||
									mutation.target?.classList?.contains(
										'cortext-mention'
									)
							)
						) {
							scheduleHydrate();
						}
				  } )
				: null;

		hydrate();
		updateSelection();
		ownerDocument.addEventListener( 'selectionchange', updateSelection );
		ownerDocument.addEventListener( 'mouseup', updateSelection, true );
		ownerDocument.addEventListener( 'keyup', updateSelection, true );
		observer?.observe( ownerDocument.body, {
			attributes: true,
			attributeFilter: [ MENTION_ATTRIBUTE, ...ICON_ATTRIBUTES, 'style' ],
			childList: true,
			subtree: true,
		} );
		entry = { count: 0, observer, updateSelection };
		mentionIconHydrators.set( ownerDocument, entry );
	}

	entry.count += 1;
	return () => {
		entry.count -= 1;
		if ( entry.count <= 0 ) {
			entry.observer?.disconnect();
			ownerDocument.removeEventListener(
				'selectionchange',
				entry.updateSelection
			);
			ownerDocument.removeEventListener(
				'mouseup',
				entry.updateSelection,
				true
			);
			ownerDocument.removeEventListener(
				'keyup',
				entry.updateSelection,
				true
			);
			mentionIconHydrators.delete( ownerDocument );
		}
	};
}

export function mentionIconSnapshotAttributes( icon, imageUrl = '' ) {
	const parsed = parseMentionIcon( icon );
	const attributes = {};
	const style = {};

	if ( parsed?.type === 'emoji' ) {
		attributes[ 'data-crtxt-icon-emoji' ] = parsed.value;
		return { attributes, style };
	}
	if ( parsed?.type === 'image' && imageUrl ) {
		attributes[ 'data-crtxt-icon-image' ] = 'true';
		style[ '--cortext-mention-icon-image' ] = cssUrl( imageUrl );
		return { attributes, style };
	}
	if ( parsed?.type === 'wp' ) {
		const mask = mentionWpIconMask( parsed.name );
		if ( ! mask ) {
			return { attributes, style };
		}
		attributes[ 'data-crtxt-icon-wp' ] = parsed.name;
		if ( parsed.color ) {
			attributes[ 'data-crtxt-icon-color' ] = parsed.color;
			style[ '--cortext-mention-icon-color' ] =
				ICON_COLOR_BY_NAME[ parsed.color ];
		}
		return { attributes, style };
	}

	return { attributes, style };
}
