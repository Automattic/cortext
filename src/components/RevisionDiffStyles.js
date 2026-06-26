import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useEffect } from '@wordpress/element';
import { addFilter, removeFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

import { unlock } from '../lock-unlock';

const { usePrivateStyleOverride = () => {} } = blockEditorPrivateApis
	? unlock( blockEditorPrivateApis )
	: {};

const FILTER_NAME = 'cortext/revisions/with-revision-diff-classes';

const REVISION_REMOVED_FILTER_SVG = `
<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 0 0"
	width="0"
	height="0"
	focusable="false"
	role="none"
	aria-hidden="true"
	style="visibility: hidden; position: absolute; left: -9999px; overflow: hidden;"
>
	<defs>
		<filter id="revision-removed-filter" x="0" y="0" width="100%" height="100%">
			<feColorMatrix type="matrix"
				values="0.5 0.3 0.2 0 0.15
				        0.2 0.2 0.1 0 0
				        0.2 0.2 0.1 0 0
				        0   0   0   0.8 0"/>
		</filter>
	</defs>
</svg>
`;

const REVISION_DIFF_STYLES = `
	.is-revision-added {
		box-shadow: inset 0 0 0 9999px color-mix(in srgb, currentColor 5%, #00a32a 15%), 0 0 0 4px color-mix(in srgb, currentColor 5%, #00a32a 15%);
	}
	.is-revision-removed,
	.revision-diff-removed {
		text-decoration: line-through;
		filter: url(#revision-removed-filter);
	}
	.is-revision-modified {
		outline: 2px solid color-mix(in srgb, currentColor 30%, #dba617 70%) !important;
		outline-offset: 2px;
	}
	.revision-diff-added {
		background-color: color-mix(in srgb, currentColor 5%, #00a32a 15%);
		text-decoration: none;
	}
	.revision-diff-format-added {
		text-decoration: underline wavy color-mix(in srgb, currentColor 30%, #00a32a 70%);
		text-decoration-thickness: 2px;
	}
	.revision-diff-format-removed {
		text-decoration: underline wavy color-mix(in srgb, currentColor 20%, #d63638 80%);
		text-decoration-thickness: 2px;
	}
	.revision-diff-format-changed {
		text-decoration: underline wavy color-mix(in srgb, currentColor 30%, #dba617 70%);
		text-decoration-thickness: 2px;
	}
`;

const DIFF_FORMAT_TYPES = [
	{
		name: 'revision/diff-removed',
		title: __( 'Removed', 'cortext' ),
		tagName: 'del',
		className: 'revision-diff-removed',
	},
	{
		name: 'revision/diff-added',
		title: __( 'Added', 'cortext' ),
		tagName: 'ins',
		className: 'revision-diff-added',
	},
	{
		name: 'revision/diff-format-added',
		title: __( 'Format added', 'cortext' ),
		tagName: 'span',
		className: 'revision-diff-format-added',
	},
	{
		name: 'revision/diff-format-removed',
		title: __( 'Format removed', 'cortext' ),
		tagName: 'span',
		className: 'revision-diff-format-removed',
	},
	{
		name: 'revision/diff-format-changed',
		title: __( 'Format changed', 'cortext' ),
		tagName: 'span',
		className: 'revision-diff-format-changed',
	},
];

function registerDiffFormatTypes() {
	const richText = globalThis?.wp?.richText;
	if ( ! richText?.registerFormatType ) {
		return;
	}
	DIFF_FORMAT_TYPES.forEach( ( formatType ) => {
		richText.registerFormatType( formatType.name, {
			...formatType,
			attributes: { title: 'title' },
			edit: () => null,
		} );
	} );
}

function unregisterDiffFormatTypes() {
	const richText = globalThis?.wp?.richText;
	if ( ! richText?.unregisterFormatType ) {
		return;
	}
	DIFF_FORMAT_TYPES.forEach( ( formatType ) => {
		richText.unregisterFormatType( formatType.name );
	} );
}

function withRevisionDiffClasses( BlockListBlock ) {
	return function CortextRevisionBlockListBlock( props ) {
		const diffStatus = props.block?.__revisionDiffStatus?.status;
		const className = [
			props.className,
			diffStatus === 'added' ? 'is-revision-added' : '',
			diffStatus === 'removed' ? 'is-revision-removed' : '',
			diffStatus === 'modified' ? 'is-revision-modified' : '',
		]
			.filter( Boolean )
			.join( ' ' );
		return <BlockListBlock { ...props } className={ className } />;
	};
}

let filterRegistrations = 0;
let formatRegistrations = 0;

function useRevisionDiffFilter() {
	useEffect( () => {
		if ( filterRegistrations === 0 ) {
			addFilter(
				'editor.BlockListBlock',
				FILTER_NAME,
				withRevisionDiffClasses
			);
		}
		++filterRegistrations;
		return () => {
			filterRegistrations = Math.max( 0, filterRegistrations - 1 );
			if ( filterRegistrations === 0 ) {
				removeFilter( 'editor.BlockListBlock', FILTER_NAME );
			}
		};
	}, [] );
}

export default function RevisionDiffStyles() {
	useRevisionDiffFilter();
	useEffect( () => {
		if ( formatRegistrations === 0 ) {
			registerDiffFormatTypes();
		}
		++formatRegistrations;
		return () => {
			formatRegistrations = Math.max( 0, formatRegistrations - 1 );
			if ( formatRegistrations === 0 ) {
				unregisterDiffFormatTypes();
			}
		};
	}, [] );

	const showDiff = useSelect(
		( select ) =>
			unlock( select( editorStore ) ).isShowingRevisionDiff?.() ?? false,
		[]
	);

	usePrivateStyleOverride( {
		css: showDiff ? REVISION_DIFF_STYLES : '',
	} );
	usePrivateStyleOverride( {
		assets: showDiff ? REVISION_REMOVED_FILTER_SVG : '',
		__unstableType: 'svgs',
	} );

	return null;
}
