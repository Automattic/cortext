// Float Cortext's own blocks to the top of the `/` slash inserter. Gutenberg's
// block autocompleter orders results by frecency and search relevance, so core
// blocks (Columns, List, ...) outrank Cortext's collection blocks even when both
// match. We hook the `editor.Autocomplete.completers` filter (the supported way
// to extend autocompleters) and reorder the block completer's options so
// `cortext/*` entries lead, keeping Gutenberg's relative order within each group
// (Array.sort is stable).
//
// Scope: the slash menu only. The full inserter already lists the Collections
// category first (see collectionsBlockCategory.js). `useItems` is a semi-private
// shape, so we pass the completer through untouched if it ever changes.
import { addFilter } from '@wordpress/hooks';
import { useMemo } from '@wordpress/element';

const isCortextOption = ( option ) =>
	typeof option?.value?.name === 'string' &&
	option.value.name.startsWith( 'cortext/' );

export function prioritizeCortextOptions( options ) {
	return [ ...options ].sort(
		( a, b ) =>
			Number( isCortextOption( b ) ) - Number( isCortextOption( a ) )
	);
}

export function withCortextPriority( completers ) {
	return completers.map( ( completer ) => {
		if (
			completer?.name !== 'blocks' ||
			typeof completer.useItems !== 'function'
		) {
			return completer;
		}
		const { useItems } = completer;
		return {
			...completer,
			useItems( filterValue ) {
				const [ options ] = useItems( filterValue );
				const ordered = useMemo(
					() => prioritizeCortextOptions( options ),
					[ options ]
				);
				return [ ordered ];
			},
		};
	} );
}

addFilter(
	'editor.Autocomplete.completers',
	'cortext/prioritize-blocks-in-inserter',
	withCortextPriority
);
