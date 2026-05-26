// Best-effort renderer for a Notion block tree. This is a preview, not
// an importer: unknown blocks fall back to a labelled placeholder, and
// embed-like blocks render as plain links. The rich-text path covers
// bold / italic / strikethrough / underline / code / link / mentions so
// inline annotations show up correctly in headings, paragraphs and list
// items.

import { __ } from '@wordpress/i18n';
import { Fragment } from '@wordpress/element';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
} from '@wordpress/components';

function renderRichText( fragments ) {
	if ( ! Array.isArray( fragments ) || fragments.length === 0 ) {
		return null;
	}
	return fragments.map( ( fragment, index ) => {
		const text =
			fragment?.plain_text ??
			fragment?.text?.content ??
			fragment?.mention?.plain_text ??
			'';
		if ( ! text ) {
			return null;
		}
		const annotations = fragment.annotations ?? {};
		let node = text;
		if ( annotations.code ) {
			node = <code>{ node }</code>;
		}
		if ( annotations.bold ) {
			node = <strong>{ node }</strong>;
		}
		if ( annotations.italic ) {
			node = <em>{ node }</em>;
		}
		if ( annotations.strikethrough ) {
			node = <s>{ node }</s>;
		}
		if ( annotations.underline ) {
			node = <u>{ node }</u>;
		}
		const href = fragment.href ?? fragment.text?.link?.url ?? null;
		if ( href ) {
			node = (
				<a href={ href } target="_blank" rel="noreferrer noopener">
					{ node }
				</a>
			);
		}
		return <Fragment key={ index }>{ node }</Fragment>;
	} );
}

function blockText( block ) {
	const data = block[ block.type ];
	return renderRichText( data?.rich_text ?? data?.title );
}

// Notion lists are flat siblings — one block per item. Group consecutive
// same-type list items so they render as a single <ul>/<ol>.
function groupListSiblings( blocks ) {
	const groups = [];
	let current = null;
	for ( const block of blocks ) {
		const isListItem =
			block.type === 'bulleted_list_item' ||
			block.type === 'numbered_list_item' ||
			block.type === 'to_do';
		if ( isListItem ) {
			if ( current && current.type === block.type ) {
				current.items.push( block );
			} else {
				current = { type: block.type, items: [ block ] };
				groups.push( current );
			}
		} else {
			current = null;
			groups.push( block );
		}
	}
	return groups;
}

function renderListGroup( group, depth ) {
	const Tag = group.type === 'numbered_list_item' ? 'ol' : 'ul';
	return (
		<Tag className="cortext-import-blocks__list">
			{ group.items.map( ( block ) => (
				<li key={ block.id }>
					{ group.type === 'to_do' && (
						<input
							type="checkbox"
							checked={ Boolean( block.to_do?.checked ) }
							readOnly
							aria-label={ __( 'Done', 'cortext' ) }
						/>
					) }{ ' ' }
					{ blockText( block ) }
					{ block.children && block.children.length > 0 && (
						<BlockTree
							blocks={ block.children }
							depth={ depth + 1 }
						/>
					) }
				</li>
			) ) }
		</Tag>
	);
}

function BlockTree( { blocks, depth = 0 } ) {
	if ( ! Array.isArray( blocks ) || blocks.length === 0 ) {
		return null;
	}
	const grouped = groupListSiblings( blocks );
	return (
		<div className="cortext-import-blocks__tree" data-depth={ depth }>
			{ grouped.map( ( node, index ) => {
				if (
					node.type === 'bulleted_list_item' ||
					node.type === 'numbered_list_item' ||
					node.type === 'to_do'
				) {
					return (
						<Fragment key={ `list-${ index }` }>
							{ renderListGroup( node, depth ) }
						</Fragment>
					);
				}
				return <Block key={ node.id } block={ node } depth={ depth } />;
			} ) }
		</div>
	);
}

function Block( { block, depth } ) {
	switch ( block.type ) {
		case 'paragraph':
			return (
				<p className="cortext-import-blocks__paragraph">
					{ blockText( block ) ?? ' ' }
				</p>
			);
		case 'heading_1':
			return <h2>{ blockText( block ) }</h2>;
		case 'heading_2':
			return <h3>{ blockText( block ) }</h3>;
		case 'heading_3':
			return <h4>{ blockText( block ) }</h4>;
		case 'quote':
			return (
				<blockquote className="cortext-import-blocks__quote">
					{ blockText( block ) }
				</blockquote>
			);
		case 'code': {
			const lang = block.code?.language ?? '';
			return (
				<pre className="cortext-import-blocks__code">
					<code data-lang={ lang }>{ blockText( block ) }</code>
				</pre>
			);
		}
		case 'callout': {
			const icon = block.callout?.icon;
			const glyph = icon?.type === 'emoji' ? icon.emoji : 'ℹ️';
			return (
				<aside className="cortext-import-blocks__callout">
					<span
						className="cortext-import-blocks__callout-icon"
						aria-hidden="true"
					>
						{ glyph }
					</span>
					<div>
						{ blockText( block ) }
						{ block.children?.length > 0 && (
							<BlockTree
								blocks={ block.children }
								depth={ depth + 1 }
							/>
						) }
					</div>
				</aside>
			);
		}
		case 'divider':
			return <hr className="cortext-import-blocks__divider" />;
		case 'image': {
			const data = block.image;
			const src =
				data?.type === 'external'
					? data.external?.url
					: data?.file?.url;
			const caption = renderRichText( data?.caption );
			if ( ! src ) {
				return <Unsupported type="image" reason="no-src" />;
			}
			return (
				<figure className="cortext-import-blocks__image">
					<img src={ src } alt="" loading="lazy" />
					{ caption && <figcaption>{ caption }</figcaption> }
				</figure>
			);
		}
		case 'bookmark':
		case 'embed':
		case 'link_preview': {
			const url = block[ block.type ]?.url ?? '';
			if ( ! url ) {
				return <Unsupported type={ block.type } reason="no-url" />;
			}
			return (
				<p className="cortext-import-blocks__link">
					<a href={ url } target="_blank" rel="noreferrer noopener">
						{ url }
					</a>
				</p>
			);
		}
		case 'toggle':
			return (
				<details className="cortext-import-blocks__toggle">
					<summary>{ blockText( block ) }</summary>
					{ block.children?.length > 0 && (
						<BlockTree
							blocks={ block.children }
							depth={ depth + 1 }
						/>
					) }
				</details>
			);
		case 'column_list':
			return (
				<div className="cortext-import-blocks__columns">
					{ ( block.children ?? [] ).map( ( col ) => (
						<div
							key={ col.id }
							className="cortext-import-blocks__column"
						>
							<BlockTree
								blocks={ col.children ?? [] }
								depth={ depth + 1 }
							/>
						</div>
					) ) }
				</div>
			);
		case 'child_page':
		case 'child_database':
		case 'link_to_page': {
			const label =
				block.child_page?.title ??
				block.child_database?.title ??
				__( '(internal link)', 'cortext' );
			return (
				<p className="cortext-import-blocks__internal-link">
					{ '→ ' }
					{ label }
				</p>
			);
		}
		case 'synced_block':
			if ( block.children?.length ) {
				return (
					<BlockTree blocks={ block.children } depth={ depth + 1 } />
				);
			}
			return <Unsupported type="synced_block" reason="no-source" />;
		default:
			return <Unsupported type={ block.type } />;
	}
}

function Unsupported( { type, reason } ) {
	return (
		<Text variant="muted" className="cortext-import-blocks__unsupported">
			{ reason
				? `[unsupported: ${ type } — ${ reason }]`
				: `[unsupported: ${ type }]` }
		</Text>
	);
}

export default function ImportPageBlocks( { blocks } ) {
	if ( ! blocks ) {
		return null;
	}
	if ( blocks.length === 0 ) {
		return (
			<Text variant="muted">
				{ __( 'This page has no content.', 'cortext' ) }
			</Text>
		);
	}
	return (
		<div className="cortext-import-blocks">
			<BlockTree blocks={ blocks } />
		</div>
	);
}
