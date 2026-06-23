import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useRegistry, useSelect } from '@wordpress/data';
import { useEffect } from '@wordpress/element';
import { create, toHTMLString } from '@wordpress/rich-text';
import { useNavigate } from '@tanstack/react-router';

import { DOCUMENT_POST_TYPE } from '../../collections';
import { documentTitle } from '../../documents/title';
import { MENTION_ATTRIBUTE } from './constants';
import { retainMentionIconHydrator } from './icon';
import { handleMentionNavigationEvent } from './navigation';

const MENTION_PATTERN = /data-crtxt-mention=(["'])(\d+)\1/g;
const TARGET_QUERY = {
	context: 'edit',
	_fields: 'id,link,title',
};
const SNAPSHOT_ICON_ATTRIBUTES = [
	'data-crtxt-icon-emoji',
	'data-crtxt-icon-image',
	'data-crtxt-icon-wp',
	'data-crtxt-icon-color',
	'data-crtxt-icon-hydrated-for',
];
const SNAPSHOT_ICON_STYLE_PROPERTIES = [
	'--cortext-mention-icon-image',
	'--cortext-mention-icon-color',
	'--cortext-mention-icon-mask',
];

function targetForId( targets, id ) {
	if ( targets instanceof Map ) {
		return targets.get( id );
	}
	return targets?.[ id ];
}

export function collectMentionIdsFromHTML( html ) {
	if ( typeof html !== 'string' || ! html.includes( MENTION_ATTRIBUTE ) ) {
		return [];
	}

	const ids = new Set();
	for ( const match of html.matchAll( MENTION_PATTERN ) ) {
		ids.add( Number.parseInt( match[ 2 ], 10 ) );
	}
	return [ ...ids ].filter( ( id ) => id > 0 );
}

function collectBlocks( blocks, out = [] ) {
	blocks.forEach( ( block ) => {
		out.push( block );
		if ( Array.isArray( block.innerBlocks ) ) {
			collectBlocks( block.innerBlocks, out );
		}
	} );
	return out;
}

function serializeHTML( html ) {
	return toHTMLString( { value: create( { html } ) } );
}

function updateAttribute( element, name, value ) {
	if ( value ) {
		if ( element.getAttribute( name ) !== value ) {
			element.setAttribute( name, value );
			return true;
		}
		return false;
	}
	if ( element.hasAttribute( name ) ) {
		element.removeAttribute( name );
		return true;
	}
	return false;
}

function removeInlineStyleProperties( element, properties ) {
	let changed = false;
	properties.forEach( ( property ) => {
		if ( element.style.getPropertyValue( property ) ) {
			element.style.removeProperty( property );
			changed = true;
		}
	} );
	if ( changed && element.getAttribute( 'style' ) === '' ) {
		element.removeAttribute( 'style' );
	}
	return changed;
}

function sameOriginIframeDocument( iframe ) {
	try {
		return iframe.contentDocument;
	} catch {
		return null;
	}
}

const editorDocumentBindings = new WeakMap();

function setUpEditorDocumentBindings( rootDocument, navigate ) {
	const releases = new Map();
	const iframeListeners = new Map();

	function attachDocument( ownerDocument ) {
		if ( ! ownerDocument?.body || releases.has( ownerDocument ) ) {
			return;
		}
		const releaseIconHydrator = retainMentionIconHydrator( ownerDocument );
		const releaseNavigation = navigate
			? retainMentionNavigationHandler( ownerDocument, navigate )
			: () => {};
		releases.set( ownerDocument, () => {
			releaseIconHydrator();
			releaseNavigation();
		} );
	}

	function attachIframe( iframe ) {
		const iframeDocument = sameOriginIframeDocument( iframe );
		if ( iframeDocument?.body ) {
			attachDocument( iframeDocument );
		}
		if ( iframeListeners.has( iframe ) ) {
			return;
		}
		const onLoad = () => {
			const loadedDocument = sameOriginIframeDocument( iframe );
			if ( loadedDocument?.body ) {
				attachDocument( loadedDocument );
			}
		};
		iframe.addEventListener( 'load', onLoad );
		iframeListeners.set( iframe, onLoad );
	}

	function attachAll() {
		attachDocument( rootDocument );
		rootDocument.querySelectorAll( 'iframe' ).forEach( attachIframe );
	}

	attachAll();

	const MutationObserver = rootDocument.defaultView?.MutationObserver;
	const observer = MutationObserver
		? new MutationObserver( attachAll )
		: null;
	observer?.observe( rootDocument.body, {
		childList: true,
		subtree: true,
	} );

	return () => {
		observer?.disconnect();
		iframeListeners.forEach( ( listener, iframe ) => {
			iframe.removeEventListener( 'load', listener );
		} );
		releases.forEach( ( release ) => release() );
	};
}

// Canvas and RowEditor both mount CortextMentions, so this can run more than
// once on the same admin document. Ref-count the observer and navigation
// handler per document so a single set is installed and teardown waits for the
// last caller to release.
export function retainMentionIconHydratorsForEditorDocument(
	rootDocument = document,
	navigate = null
) {
	if ( ! rootDocument?.body ) {
		return () => {};
	}

	let binding = editorDocumentBindings.get( rootDocument );
	if ( ! binding ) {
		binding = {
			count: 0,
			release: setUpEditorDocumentBindings( rootDocument, navigate ),
		};
		editorDocumentBindings.set( rootDocument, binding );
	}

	binding.count += 1;
	let released = false;
	return () => {
		if ( released ) {
			return;
		}
		released = true;
		binding.count -= 1;
		if ( binding.count <= 0 ) {
			binding.release();
			editorDocumentBindings.delete( rootDocument );
		}
	};
}

function retainMentionNavigationHandler( ownerDocument, navigate ) {
	function onClick( event ) {
		handleMentionNavigationEvent( event, navigate );
	}

	ownerDocument.addEventListener( 'click', onClick, true );
	return () => {
		ownerDocument.removeEventListener( 'click', onClick, true );
	};
}

export function rewriteMentionSnapshots( html, targets ) {
	if ( typeof html !== 'string' || ! html.includes( MENTION_ATTRIBUTE ) ) {
		return { html, changed: false };
	}
	if ( typeof document === 'undefined' ) {
		return { html, changed: false };
	}

	const template = document.createElement( 'template' );
	template.innerHTML = html;
	let changed = false;

	template.content
		.querySelectorAll( `a[${ MENTION_ATTRIBUTE }]` )
		.forEach( ( anchor ) => {
			const id = Number.parseInt(
				anchor.getAttribute( MENTION_ATTRIBUTE ) ?? '',
				10
			);
			const target = targetForId( targets, id );
			if ( ! target?.title ) {
				return;
			}

			if ( anchor.textContent !== target.title ) {
				anchor.textContent = target.title;
				changed = true;
			}
			if (
				target.href &&
				anchor.getAttribute( 'href' ) !== target.href
			) {
				anchor.setAttribute( 'href', target.href );
				changed = true;
			}
			if ( updateAttribute( anchor, 'data-crtxt-path', '' ) ) {
				changed = true;
			}
			SNAPSHOT_ICON_ATTRIBUTES.forEach( ( name ) => {
				if ( updateAttribute( anchor, name, '' ) ) {
					changed = true;
				}
			} );
			if (
				removeInlineStyleProperties(
					anchor,
					SNAPSHOT_ICON_STYLE_PROPERTIES
				)
			) {
				changed = true;
			}
		} );

	if ( ! changed ) {
		return { html, changed: false };
	}

	return {
		html: serializeHTML( template.innerHTML ),
		changed: true,
	};
}

export default function CortextMentions() {
	const navigate = useNavigate();
	const registry = useRegistry();

	useEffect( () => {
		if ( typeof document === 'undefined' ) {
			return undefined;
		}
		return retainMentionIconHydratorsForEditorDocument(
			document,
			navigate
		);
	}, [ navigate ] );

	// Value-stable signature of the mention set plus each target's current
	// title and link. The selector runs on every store change but returns a
	// string, so the rewrite below only fires when a mention is added or
	// removed or a target is renamed, never on plain keystrokes.
	const signature = useSelect( ( select ) => {
		const mentionedIds = new Set();
		collectBlocks( select( blockEditorStore ).getBlocks() ).forEach(
			( block ) => {
				Object.values( block.attributes ?? {} ).forEach( ( value ) => {
					collectMentionIdsFromHTML( value ).forEach( ( id ) =>
						mentionedIds.add( id )
					);
				} );
			}
		);
		const core = select( coreStore );
		return [ ...mentionedIds ]
			.sort( ( a, b ) => a - b )
			.map( ( id ) => {
				const record = core.getEntityRecord(
					'postType',
					DOCUMENT_POST_TYPE,
					id,
					TARGET_QUERY
				);
				if ( ! record ) {
					return `${ id }:`;
				}
				const link = record.link ?? '';
				return `${ id }:${ documentTitle( record ) }:${ link }`;
			} )
			.join( '|' );
	}, [] );

	const { updateBlockAttributes, __unstableMarkNextChangeAsNotPersistent } =
		useDispatch( blockEditorStore );

	useEffect( () => {
		if ( ! signature ) {
			return;
		}

		const core = registry.select( coreStore );
		const blocks = collectBlocks(
			registry.select( blockEditorStore ).getBlocks()
		);
		const targets = new Map();
		blocks.forEach( ( block ) => {
			Object.values( block.attributes ?? {} ).forEach( ( value ) => {
				collectMentionIdsFromHTML( value ).forEach( ( id ) => {
					if ( targets.has( id ) ) {
						return;
					}
					const record = core.getEntityRecord(
						'postType',
						DOCUMENT_POST_TYPE,
						id,
						TARGET_QUERY
					);
					if ( record ) {
						targets.set( id, {
							title: documentTitle( record ),
							href: record.link,
						} );
					}
				} );
			} );
		} );

		if ( targets.size === 0 ) {
			return;
		}

		blocks.forEach( ( block ) => {
			const nextAttributes = {};
			Object.entries( block.attributes ?? {} ).forEach(
				( [ key, value ] ) => {
					const result = rewriteMentionSnapshots( value, targets );
					if ( result.changed ) {
						nextAttributes[ key ] = result.html;
					}
				}
			);

			if ( Object.keys( nextAttributes ).length > 0 ) {
				__unstableMarkNextChangeAsNotPersistent();
				updateBlockAttributes( block.clientId, nextAttributes );
			}
		} );
	}, [
		signature,
		registry,
		updateBlockAttributes,
		__unstableMarkNextChangeAsNotPersistent,
	] );

	return null;
}
