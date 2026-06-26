jest.mock( '@wordpress/hooks', () => ( {
	addFilter: jest.fn(),
} ) );

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '../../../src/components/fetchCortextLinkSuggestions', () => ( {
	fetchCortextLinkSuggestions: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { fetchCortextLinkSuggestions } from '../../../src/components/fetchCortextLinkSuggestions';
import { renderToString } from '@wordpress/element';
import { waitFor } from '@testing-library/react';
import {
	fetchMentionOptions,
	getMentionCompletion,
	getMentionOptionKeywords,
	getMentionOptionLabel,
	mentionCompleter,
	withCortextMentionCompleter,
} from '../../../src/components/mention/completer';
import {
	collectMentionIdsFromHTML,
	retainMentionIconHydratorsForEditorDocument,
	rewriteMentionSnapshots,
} from '../../../src/components/mention/CortextMentions';
import {
	hydrateMentionIcons,
	hydrateMentionWpIconMasks,
	mentionEmojiFromIcon,
	mentionIconForRecord,
	mentionWpIconMask,
	updateMentionSelectionState,
} from '../../../src/components/mention/icon';

describe( 'mention completer', () => {
	beforeEach( () => {
		fetchCortextLinkSuggestions.mockReset();
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( {} );
	} );

	it( 'maps Cortext link suggestions to document mention options', async () => {
		fetchCortextLinkSuggestions.mockResolvedValueOnce( [
			{ id: 7, title: 'Roadmap', url: '/roadmap-7' },
		] );

		const options = await fetchMentionOptions( 'road' );

		expect( fetchCortextLinkSuggestions ).toHaveBeenCalledWith( 'road', {
			perPage: 10,
		} );
		expect( options[ 0 ] ).toEqual(
			expect.objectContaining( {
				kind: 'document',
				key: 'document-7',
				label: 'Roadmap',
				value: expect.objectContaining( {
					id: 7,
					kind: 'document',
				} ),
			} )
		);
	} );

	it( 'does not fetch media while mapping mention options', async () => {
		fetchCortextLinkSuggestions.mockResolvedValueOnce( [
			{
				icon: '{"type":"image","id":42}',
				id: 7,
				title: 'Roadmap',
				url: '/roadmap-7',
			},
		] );

		const options = await fetchMentionOptions( 'road' );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( options[ 0 ].iconImageUrl ).toBeUndefined();
	} );

	it( 'saves a plain mention anchor for document completions', () => {
		const html = renderToString(
			getMentionCompletion( {
				kind: 'document',
				icon: '{"type":"emoji","value":"B"}',
				id: 9,
				path: 'brief-9',
				title: 'Brief',
				url: '/brief-9',
			} )
		);

		expect( html ).not.toContain( '&lt;a' );
		expect( html ).toContain( 'class="cortext-mention"' );
		expect( html ).toContain( 'data-crtxt-mention="9"' );
		expect( html ).toContain( 'href="/brief-9"' );
		expect( html ).not.toContain( 'data-crtxt-path' );
		expect( html ).not.toContain( 'data-crtxt-icon' );
		expect( html ).toContain( '>Brief</a>' );
		// A trailing space keeps the caret typeable right after the mention.
		expect( html ).toMatch( /<\/a>\s$/ );
		expect( html ).not.toContain( 'cortext-mention__label' );
	} );

	it( 'leaves icon snapshots out of saved completions', () => {
		const html = renderToString(
			getMentionCompletion( {
				kind: 'document',
				icon: '{"type":"wp","name":"chartBar","color":"purple"}',
				id: 9,
				path: 'brief-9',
				title: 'Brief',
				url: '/brief-9',
			} )
		);

		expect( html ).not.toContain( 'data-crtxt-icon-wp' );
		expect( html ).not.toContain( 'data-crtxt-icon-color' );
		expect( html ).not.toContain( '--cortext-mention-icon-color' );
		expect( html ).not.toContain( '--cortext-mention-icon-mask' );
		expect( html ).not.toContain( 'data:image/svg+xml' );
	} );

	it( 'provides labels and keywords for Gutenberg autocomplete items', () => {
		const option = {
			kind: 'document',
			title: 'Project Brief',
		};

		expect( getMentionOptionLabel( option ) ).toBe( 'Project Brief' );
		expect( getMentionOptionKeywords( option ) ).toEqual( [
			'Project',
			'Brief',
		] );
		expect( mentionCompleter.getOptionLabel ).toBe( getMentionOptionLabel );
		expect( mentionCompleter.getOptionKeywords ).toBe(
			getMentionOptionKeywords
		);
	} );

	it( 'replaces the default user @ completer with Cortext mentions', () => {
		const blockCompleter = { name: 'blocks', triggerPrefix: '/' };
		const userCompleter = { name: 'users', triggerPrefix: '@' };
		const linkCompleter = { name: 'links', triggerPrefix: '[[' };

		expect(
			withCortextMentionCompleter( [
				linkCompleter,
				userCompleter,
				blockCompleter,
			] )
		).toEqual( [ mentionCompleter, linkCompleter, blockCompleter ] );
	} );
} );

describe( 'mention icons', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( {} );
	} );

	it( 'extracts emoji icons from document icon metadata', () => {
		expect( mentionEmojiFromIcon( '{"type":"emoji","value":"B"}' ) ).toBe(
			'B'
		);
		expect( mentionEmojiFromIcon( '{"type":"wp","name":"bell"}' ) ).toBe(
			''
		);
		expect( mentionEmojiFromIcon( '{' ) ).toBe( '' );
	} );

	it( "prefers the record's icon before fallback icons", () => {
		expect(
			mentionIconForRecord( {
				meta: {
					cortext_document_icon: '{"type":"emoji","value":"A"}',
				},
				cortext_defines_trait: true,
			} )
		).toBe( '{"type":"emoji","value":"A"}' );
		expect( mentionIconForRecord( { cortext_defines_trait: true } ) ).toBe(
			'{"type":"wp","name":"collection"}'
		);
		expect( mentionIconForRecord( { crtxt_trait: [ 5 ] } ) ).toBe(
			'{"type":"wp","name":"listItem"}'
		);
		expect( mentionIconForRecord( {} ) ).toBe( '' );
	} );

	it( 'builds wp icon masks without currentColor in the data URI', () => {
		const mask = decodeURIComponent( mentionWpIconMask( 'collection' ) );

		expect( mask ).toContain( 'black' );
		expect( mask ).not.toContain( 'currentColor' );
	} );

	it( 'hydrates wp mention masks in the current document', () => {
		const anchor = document.createElement( 'a' );
		anchor.className = 'cortext-mention';
		anchor.setAttribute( 'data-crtxt-icon-wp', 'chartBar' );
		document.body.appendChild( anchor );

		hydrateMentionWpIconMasks( document );

		expect(
			anchor.style.getPropertyValue( '--cortext-mention-icon-mask' )
		).toContain( 'data:image/svg+xml' );
		anchor.remove();
	} );

	it( 'loads mention icons from the target record', async () => {
		apiFetch.mockResolvedValue( {
			id: 33,
			meta: {
				cortext_document_icon:
					'{"type":"wp","name":"chartBar","color":"purple"}',
			},
		} );
		const anchor = document.createElement( 'a' );
		anchor.className = 'cortext-mention';
		anchor.setAttribute( 'data-crtxt-mention', '33' );
		document.body.appendChild( anchor );

		await hydrateMentionIcons( document );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_documents/33?context=edit&_fields=id,meta,cortext_defines_trait,crtxt_trait',
		} );
		expect( anchor.getAttribute( 'data-crtxt-icon-wp' ) ).toBe(
			'chartBar'
		);
		expect( anchor.getAttribute( 'data-crtxt-icon-color' ) ).toBe(
			'purple'
		);
		expect(
			anchor.style.getPropertyValue( '--cortext-mention-icon-color' )
		).toBe( '#a855f7' );
		expect(
			anchor.style.getPropertyValue( '--cortext-mention-icon-mask' )
		).toContain( 'data:image/svg+xml' );
		expect( anchor.getAttribute( 'data-crtxt-icon-hydrated-for' ) ).toBe(
			'33'
		);
		anchor.remove();
	} );

	it( 'updates mentions inside the editor iframe from the mounted controller', async () => {
		apiFetch.mockResolvedValue( {
			id: 289,
			meta: {
				cortext_document_icon:
					'{"type":"wp","name":"chartBar","color":"purple"}',
			},
		} );
		const iframe = document.createElement( 'iframe' );
		document.body.appendChild( iframe );
		const iframeDocument = iframe.contentDocument;
		const anchor = iframeDocument.createElement( 'a' );
		anchor.className = 'cortext-mention';
		anchor.setAttribute( 'data-crtxt-mention', '289' );
		anchor.textContent = 'Rollup examples';
		iframeDocument.body.appendChild( anchor );

		const release = retainMentionIconHydratorsForEditorDocument( document );

		await waitFor( () => {
			expect( anchor.getAttribute( 'data-crtxt-icon-wp' ) ).toBe(
				'chartBar'
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_documents/289?context=edit&_fields=id,meta,cortext_defines_trait,crtxt_trait',
		} );
		expect( anchor.getAttribute( 'data-crtxt-icon-color' ) ).toBe(
			'purple'
		);

		release();
		iframe.remove();
	} );

	it( 'marks mentioned tokens that intersect the current text selection', () => {
		const paragraph = document.createElement( 'p' );
		const before = document.createTextNode( 'hola ' );
		const anchor = document.createElement( 'a' );
		const after = document.createTextNode( ' después' );
		anchor.className = 'cortext-mention';
		anchor.setAttribute( 'data-crtxt-mention', '289' );
		anchor.textContent = 'Rollup examples';
		paragraph.append( before, anchor, after );
		document.body.appendChild( paragraph );

		const range = document.createRange();
		range.setStart( before, 1 );
		range.setEnd( after, 4 );
		const selection = document.getSelection();
		selection.removeAllRanges();
		selection.addRange( range );

		updateMentionSelectionState( document );

		expect( anchor ).toHaveClass( 'is-cortext-mention-selected' );

		selection.removeAllRanges();
		updateMentionSelectionState( document );
		expect( anchor ).not.toHaveClass( 'is-cortext-mention-selected' );
		paragraph.remove();
	} );
} );

describe( 'mention snapshot rewrite helper', () => {
	it( 'collects distinct mention target ids', () => {
		const ids = collectMentionIdsFromHTML(
			'<a data-crtxt-mention="2">A</a><a data-crtxt-mention="2">A</a><a data-crtxt-mention="3">B</a>'
		);

		expect( ids ).toEqual( [ 2, 3 ] );
	} );

	it( 'updates old title and href snapshots', () => {
		const result = rewriteMentionSnapshots(
			'<span>See <a class="cortext-mention" data-crtxt-mention="2" data-crtxt-path="old-2" data-crtxt-icon-emoji="O" style="--cortext-mention-icon-color: #111;" href="/old">Old</a></span>',
			new Map( [
				[
					2,
					{
						title: 'Fresh',
						href: '/fresh-2',
						path: 'fresh-2',
						icon: '{"type":"emoji","value":"F"}',
					},
				],
			] )
		);

		expect( result.changed ).toBe( true );
		expect( result.html ).toContain( 'data-crtxt-mention="2"' );
		expect( result.html ).not.toContain( 'data-crtxt-icon' );
		expect( result.html ).not.toContain( 'data-crtxt-path' );
		expect( result.html ).not.toContain( 'style=' );
		expect( result.html ).toContain( 'href="/fresh-2"' );
		expect( result.html ).toContain( '>Fresh</a>' );
		expect( result.html ).not.toContain( 'cortext-mention__label' );
	} );

	it( 'leaves up-to-date or unresolved snapshots alone', () => {
		const html =
			'<a class="cortext-mention" data-crtxt-mention="2" href="/fresh-2">Fresh</a>';

		expect(
			rewriteMentionSnapshots(
				html,
				new Map( [ [ 2, { title: 'Fresh', href: '/fresh-2' } ] ] )
			)
		).toEqual( { html, changed: false } );

		expect( rewriteMentionSnapshots( html, new Map() ) ).toEqual( {
			html,
			changed: false,
		} );
	} );
} );
