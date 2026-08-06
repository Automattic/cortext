/**
 * Read-only preview of the highlighted search result, next to the command
 * palette list. The body renders real blocks through BlockPreview so it looks
 * like the editor canvas.
 */

import {
	BlockContextProvider,
	BlockPreview,
	privateApis as blockEditorPrivateApis,
} from '@wordpress/block-editor';
import { parse } from '@wordpress/blocks';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { dateI18n, getSettings as getDateSettings } from '@wordpress/date';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { collectionHint, documentTitle, listIconForRecord } from '../documents';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { unlock } from '../lock-unlock';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from './page-queries';
import { SkeletonLine } from './Skeleton';

// The public BlockEditorProvider strips `__experimental` settings, which is
// where theme.json presets and the layout content width live. The preview
// needs them to match the canvas.
const { ExperimentalBlockEditorProvider } = unlock( blockEditorPrivateApis );

// A held arrow key repeats about every 30ms, so this collapses a sweep
// through the list into a single fetch while one deliberate press still feels
// immediate. Shorter than the search debounce, which has to wait for typing.
const PREVIEW_FETCH_DELAY_MS = 80;
const PREVIEW_ICON_SIZE = 24;
// The pane is narrower than this, so BlockPreview scales the page down a
// little. Keeping it wide leaves multi-column and wide-aligned blocks with
// the proportions they have on the canvas.
const PREVIEW_VIEWPORT_WIDTH = 640;
// A preview only has to show enough of a document to recognize it.
const MAX_PREVIEW_BLOCKS = 40;
const SKELETON_DELAY_MS = 120;
const SKELETON_LINE_WIDTHS = [ '92%', '84%', '96%', '61%', '88%', '73%' ];
const EMPTY_BLOCKS = [];

// The header blocks repeat the icon, cover and title the pane already shows,
// and the data view would mount the whole collection surface. Both come out
// of the parsed block list before it reaches BlockPreview.
const EXCLUDED_PREVIEW_BLOCKS = [
	'core/post-title',
	'cortext/document-cover',
	'cortext/document-icon',
	'cortext/document-properties',
	'cortext/data-view',
];

let editorModulePromise = null;

function loadEditorModule() {
	if ( ! editorModulePromise ) {
		editorModulePromise = import(
			/* webpackChunkName: "editor" */ './initEditor'
		);
	}
	return editorModulePromise;
}

/**
 * Resolves the editor chunk, which registers the blocks and owns the canvas
 * settings. The palette can open before any editor surface has mounted, and
 * parsing content without registered blocks would render a wall of
 * unsupported-block placeholders.
 *
 * @return {{module: ?Object, error: ?unknown}} Loaded module or load failure.
 */
function useEditorModule() {
	const [ state, setState ] = useState( { module: null, error: null } );

	useEffect( () => {
		let cancelled = false;
		loadEditorModule().then(
			( loaded ) => {
				if ( ! cancelled ) {
					setState( { module: loaded, error: null } );
				}
			},
			( error ) => {
				if ( ! cancelled ) {
					setState( { module: null, error } );
				}
			}
		);
		return () => {
			cancelled = true;
		};
	}, [] );

	return state;
}

/**
 * Drops the blocks the preview does not render, at every depth.
 *
 * @param {Object[]} blocks Parsed blocks.
 * @return {Object[]} Blocks safe to hand to BlockPreview.
 */
export function stripPreviewBlocks( blocks ) {
	return blocks
		.filter( ( block ) => ! EXCLUDED_PREVIEW_BLOCKS.includes( block.name ) )
		.map( ( block ) =>
			block.innerBlocks?.length
				? {
						...block,
						innerBlocks: stripPreviewBlocks( block.innerBlocks ),
				  }
				: block
		);
}

function editedLabel( record ) {
	const modified = record?.modified ?? record?.modified_gmt ?? '';
	if ( ! modified ) {
		return '';
	}
	return sprintf(
		/* translators: %s: date the document was last edited */
		__( 'Edited %s', 'cortext' ),
		dateI18n( getDateSettings().formats.date, modified )
	);
}

// Documents keep their cover in `featured_media`. The `cover` REST field
// would be handier, but it only ever reaches rows, so pages and collections
// would come up empty.
function PreviewCover( { mediaId } ) {
	const { record } = useEntityRecord( 'root', 'media', mediaId );
	const url =
		record?.media_details?.sizes?.large?.source_url ??
		record?.source_url ??
		'';

	if ( ! url ) {
		return null;
	}

	return (
		<img
			className="cortext-command-palette__preview-cover"
			src={ url }
			alt=""
		/>
	);
}

function PreviewSkeleton() {
	return (
		<div className="cortext-command-palette__preview-skeleton">
			{ SKELETON_LINE_WIDTHS.map( ( width, index ) => (
				<SkeletonLine key={ index } width={ width } />
			) ) }
		</div>
	);
}

function PreviewBody( { content, postId, getEditorSettings } ) {
	const blocks = useMemo(
		() =>
			stripPreviewBlocks( parse( content ) ).slice(
				0,
				MAX_PREVIEW_BLOCKS
			),
		[ content ]
	);
	// The provider re-applies settings whenever this object changes identity.
	// `isPreviewMode` keeps it from registering the editor's keyboard
	// shortcuts, which a read-only pane has no use for.
	const settings = useMemo(
		() => ( { ...getEditorSettings(), isPreviewMode: true } ),
		[ getEditorSettings ]
	);

	if ( blocks.length === 0 ) {
		return null;
	}

	// Cortext blocks and the core post-* blocks read the document they belong
	// to from block context, which reaches the preview iframe through the
	// portal.
	return (
		<ExperimentalBlockEditorProvider
			value={ EMPTY_BLOCKS }
			settings={ settings }
		>
			<BlockContextProvider value={ { postId, postType: POST_TYPE } }>
				<BlockPreview
					blocks={ blocks }
					viewportWidth={ PREVIEW_VIEWPORT_WIDTH }
				/>
			</BlockContextProvider>
		</ExperimentalBlockEditorProvider>
	);
}

export default function CommandPalettePreview( { doc } ) {
	const { module: editorModule, error: editorError } = useEditorModule();
	// The shell already subscribes to this query and it includes page and
	// collection content, so most previews come straight from it with no
	// request at all. Rows sit outside the query (see page-queries) and fall
	// through to the fetch below.
	// `usePooledEntityRecord` pools the same way but on a single id; here the
	// pool is read on every keypress and only the fetch is debounced.
	const { records: pooledDocuments } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const pooledRecord = useMemo(
		() =>
			( pooledDocuments ?? [] ).find(
				( entry ) => entry.id === doc.id
			) ?? null,
		[ pooledDocuments, doc.id ]
	);

	const debouncedId = useDebouncedValue( doc.id, PREVIEW_FETCH_DELAY_MS );
	const isSettled = debouncedId === doc.id;
	const { record: fetchedRecord, hasResolved } = useEntityRecord(
		'postType',
		POST_TYPE,
		debouncedId,
		{ enabled: isSettled && ! pooledRecord }
	);
	// Until the debounce catches up, the fetched record still describes the
	// previously highlighted document.
	const currentRecord = pooledRecord ?? ( isSettled ? fetchedRecord : null );
	const canRenderBody =
		Boolean( editorModule ) &&
		typeof currentRecord?.content?.raw === 'string';
	const hasFailed =
		Boolean( editorError ) ||
		( isSettled && ! pooledRecord && hasResolved && ! fetchedRecord );
	const isLoading = ! canRenderBody && ! hasFailed;
	const showSkeleton = useDelayedFlag(
		isLoading,
		SKELETON_DELAY_MS,
		SKELETON_MIN_VISIBLE_MS
	);

	const hint = collectionHint( doc );
	const edited = editedLabel( currentRecord );
	const coverId = currentRecord?.featured_media ?? 0;
	const excerpt = doc.excerpt?.trim?.() ?? '';

	return (
		<div className="cortext-command-palette__preview-inner">
			{ coverId > 0 && <PreviewCover mediaId={ coverId } /> }
			<div className="cortext-command-palette__preview-header">
				{ /* Same source as the list item, so one document never shows
				     two different glyphs on screen. */ }
				{ listIconForRecord( doc, PREVIEW_ICON_SIZE ) }
				<span className="cortext-command-palette__preview-title">
					{ documentTitle( doc ) }
				</span>
			</div>
			{ ( hint || edited ) && (
				<div className="cortext-command-palette__preview-meta">
					{ hint && <span>{ hint }</span> }
					{ edited && <span>{ edited }</span> }
				</div>
			) }
			<div className="cortext-command-palette__preview-content">
				{ canRenderBody && (
					<PreviewBody
						content={ currentRecord.content.raw }
						postId={ currentRecord.id }
						getEditorSettings={ editorModule.getEditorSettings }
					/>
				) }
				{ hasFailed && excerpt && (
					<p className="cortext-command-palette__preview-excerpt">
						{ excerpt }
					</p>
				) }
				{ /* `showSkeleton` stays true for a minimum duration once
				     raised, so hide it as soon as there is something real to
				     show instead. */ }
				{ isLoading && showSkeleton && <PreviewSkeleton /> }
			</div>
		</div>
	);
}
