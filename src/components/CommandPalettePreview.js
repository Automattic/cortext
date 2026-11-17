/**
 * Renders a read-only preview of the highlighted document beside the command
 * list.
 */

import {
	BlockContextProvider,
	BlockPreview,
	privateApis as blockEditorPrivateApis,
} from '@wordpress/block-editor';
import { parse } from '@wordpress/blocks';
import { store as coreStore, useEntityRecord } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { dateI18n, getSettings as getDateSettings } from '@wordpress/date';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { collectionHint, documentTitle, listIconForRecord } from '../documents';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { unlock } from '../lock-unlock';
import { POST_TYPE } from './page-queries';
import { SkeletonLine } from './Skeleton';

// The public provider removes the theme and layout settings that the preview
// needs to match the canvas.
const { ExperimentalBlockEditorProvider } = unlock( blockEditorPrivateApis );

const PREVIEW_ICON_SIZE = 24;
// BlockPreview scales this viewport to fit the pane while preserving wide and
// multi-column layouts.
const PREVIEW_VIEWPORT_WIDTH = 640;
// Show only enough blocks to identify the document.
const MAX_PREVIEW_BLOCKS = 40;
const SKELETON_DELAY_MS = 120;
const SKELETON_LINE_WIDTHS = [ '92%', '84%', '96%', '61%', '88%', '73%' ];
const EMPTY_BLOCKS = [];
// Only the fields the pane reads. Asking for `content.raw` alone also spares
// the server from rendering the content.
const PREVIEW_RECORD_QUERY = {
	_fields: 'id,content.raw,featured_media,modified',
};

// The preview header replaces these blocks. Exclude the data view to avoid
// mounting the collection UI.
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
 * Loads the editor before parsing so custom blocks and editor settings are
 * available.
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
 * Removes blocks that should not appear in the preview, including nested
 * blocks.
 *
 * @param {Object[]} blocks Parsed blocks.
 * @return {Object[]} Filtered blocks.
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

// Pages and collections expose covers through `featured_media`; the `cover`
// REST field is available only on rows.
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
	// Memoize settings because the provider reapplies them when the object
	// changes. Preview mode disables editor shortcuts.
	const settings = useMemo(
		() => ( { ...getEditorSettings(), isPreviewMode: true } ),
		[ getEditorSettings ]
	);

	if ( blocks.length === 0 ) {
		return null;
	}

	// Pass the document context through the preview iframe for post-aware
	// blocks.
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

// `doc` is null when the selected command has no document preview. The outer
// pane remains mounted.
export default function CommandPalettePreview( { doc } ) {
	const docId = doc?.id ?? 0;
	const { module: editorModule, error: editorError } = useEditorModule();
	// The shell lists carry only a few fields, so fetch the preview fields when
	// a document is highlighted. Core-data skips the request when the store
	// already has them, for example for a document open in the canvas.
	const { currentRecord, hasResolved } = useSelect(
		( select ) => {
			if ( ! docId ) {
				return { currentRecord: null, hasResolved: false };
			}
			const args = [ 'postType', POST_TYPE, docId, PREVIEW_RECORD_QUERY ];
			const { getEntityRecord, hasFinishedResolution } =
				select( coreStore );
			return {
				currentRecord: getEntityRecord( ...args ) ?? null,
				hasResolved: hasFinishedResolution( 'getEntityRecord', args ),
			};
		},
		[ docId ]
	);
	const hasContent = typeof currentRecord?.content?.raw === 'string';
	const canRenderBody = Boolean( editorModule ) && hasContent;
	const hasFailed = Boolean( editorError ) || ( hasResolved && ! hasContent );
	const isLoading = Boolean( doc ) && ! canRenderBody && ! hasFailed;
	const showSkeleton = useDelayedFlag(
		isLoading,
		SKELETON_DELAY_MS,
		SKELETON_MIN_VISIBLE_MS
	);

	if ( ! doc ) {
		return null;
	}

	const hint = collectionHint( doc );
	const edited = editedLabel( currentRecord );
	const coverId = currentRecord?.featured_media ?? 0;
	const excerpt = doc.excerpt?.trim?.() ?? '';

	return (
		<div className="cortext-command-palette__preview-inner">
			{ coverId > 0 && <PreviewCover mediaId={ coverId } /> }
			<div className="cortext-command-palette__preview-header">
				{ /* Match the icon used in the result list. */ }
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
				{ /* Do not let the minimum skeleton duration cover loaded
					     content. */ }
				{ isLoading && showSkeleton && <PreviewSkeleton /> }
			</div>
		</div>
	);
}
