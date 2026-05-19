/**
 * Small skeleton primitives shared by loading states across Cortext.
 *
 * The goal is to reserve the same space the real content will occupy so
 * that when data arrives there's no layout shift. All primitives render
 * an `aria-hidden` element with a low-cost opacity pulse that respects
 * `prefers-reduced-motion`.
 */

function toLength( value ) {
	if ( value === undefined || value === null ) {
		return undefined;
	}
	return typeof value === 'number' ? `${ value }px` : value;
}

function joinClassName( ...parts ) {
	return parts.filter( Boolean ).join( ' ' );
}

export function SkeletonBlock( {
	className,
	width,
	height,
	style,
	as: Tag = 'span',
	...rest
} ) {
	const finalStyle = { ...( style ?? {} ) };
	const w = toLength( width );
	const h = toLength( height );
	if ( w !== undefined ) {
		finalStyle.width = w;
	}
	if ( h !== undefined ) {
		finalStyle.height = h;
	}
	return (
		<Tag
			className={ joinClassName( 'cortext-skeleton', className ) }
			style={ finalStyle }
			aria-hidden="true"
			{ ...rest }
		/>
	);
}

// A horizontal bar; defaults to the title/label size. Width can be tuned
// per use to vary the rhythm of stacked lines.
export function SkeletonLine( { className, ...rest } ) {
	return (
		<SkeletonBlock
			className={ joinClassName( 'cortext-skeleton--line', className ) }
			{ ...rest }
		/>
	);
}

// Label + value pair used wherever a list of properties is rendered while
// loading (row peek, full-page document, inspector sidebars).
export function SkeletonFieldRow( { valueWidth, className } ) {
	return (
		<div
			className={ joinClassName( 'cortext-skeleton-field', className ) }
			aria-hidden="true"
		>
			<SkeletonLine className="cortext-skeleton-field__label" />
			<SkeletonLine
				className="cortext-skeleton-field__value"
				width={ valueWidth }
			/>
		</div>
	);
}

// Roughly table-shaped rows shown while useCollectionRows fetches the
// first page. Sized so the canvas pane stays the same height as it will
// be once rows arrive, instead of growing from zero.
export function CollectionRowsSkeleton( { rowCount = 8, columnCount = 4 } ) {
	const safeColumns = Math.max( 1, columnCount );
	return (
		<div className="cortext-collection-skeleton" aria-hidden="true">
			{ Array.from( { length: rowCount } ).map( ( _, rowIndex ) => (
				<div
					key={ rowIndex }
					className="cortext-collection-skeleton__row"
				>
					{ Array.from( { length: safeColumns } ).map(
						( __, colIndex ) => (
							<SkeletonLine
								key={ colIndex }
								className={ joinClassName(
									'cortext-collection-skeleton__cell',
									colIndex === 0
										? 'cortext-collection-skeleton__cell--first'
										: null
								) }
							/>
						)
					) }
				</div>
			) ) }
		</div>
	);
}

// Approximates the full-page editor's title-plus-content layout so the
// canvas area keeps its size while useResolveDocument and the editor
// mount. Cover and icon are intentionally omitted (most documents don't
// have them and reserving space for both would create the opposite shift).
export function DocumentSkeleton( { className } ) {
	return (
		<div
			className={ joinClassName(
				'cortext-document-skeleton',
				className
			) }
			aria-hidden="true"
		>
			<SkeletonLine className="cortext-document-skeleton__title" />
			<div className="cortext-document-skeleton__content">
				<SkeletonLine />
				<SkeletonLine className="cortext-document-skeleton__line--medium" />
				<SkeletonLine className="cortext-document-skeleton__line--short" />
				<SkeletonLine />
				<SkeletonLine className="cortext-document-skeleton__line--medium" />
			</div>
		</div>
	);
}
