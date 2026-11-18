// Cortext block types register from the shell entry, so core-data can parse
// any document it fetches, while their edit components and styles stay in the
// lazy `editor` chunk. Each registered `edit` looks up the real component
// here; `./edits` fills the map when that chunk loads. Blocks only render
// inside editor surfaces, and every one of them imports the chunk first.
const blockEdits = new Map();

export function setBlockEdits( edits ) {
	Object.entries( edits ).forEach( ( [ name, Edit ] ) => {
		blockEdits.set( name, Edit );
	} );
}

export function deferredEdit( name ) {
	function DeferredEdit( props ) {
		const Edit = blockEdits.get( name );
		return <Edit { ...props } />;
	}
	return DeferredEdit;
}
