/**
 * Groups document records by cascade root.
 *
 * Each marker identifies the document that triggered the status change. A
 * marked record stays hidden while that document is present. When the document
 * is missing, the record becomes a root so it can still be recovered.
 *
 * @param {Array}    documents  Document records to group.
 * @param {string[]} markerKeys Meta keys that may contain a cascade parent ID.
 * @return {{roots: Array, descendantCountById: Map}} Root records and descendant counts.
 */
export default function computeCascadeRoots( documents = [], markerKeys = [] ) {
	const all = Array.isArray( documents ) ? documents : [];
	const documentsById = new Map(
		all.map( ( document ) => [ document.id, document ] )
	);
	const childrenByMarker = new Map();

	const markerOf = ( document ) => {
		const meta = document.meta ?? {};
		for ( const markerKey of markerKeys ) {
			const marker = Number( meta[ markerKey ] ?? 0 );
			if ( marker > 0 ) {
				return marker;
			}
		}
		return 0;
	};

	all.forEach( ( document ) => {
		const marker = markerOf( document );
		if ( marker > 0 && documentsById.has( marker ) ) {
			if ( ! childrenByMarker.has( marker ) ) {
				childrenByMarker.set( marker, [] );
			}
			childrenByMarker.get( marker ).push( document );
		}
	} );

	const roots = all.filter( ( document ) => {
		const marker = markerOf( document );
		return marker === 0 || ! documentsById.has( marker );
	} );

	const descendantCountById = new Map();
	roots.forEach( ( root ) => {
		const counts = { total: 0 };
		const stack = [ ...( childrenByMarker.get( root.id ) ?? [] ) ];
		const visited = new Set();
		while ( stack.length ) {
			const node = stack.pop();
			if ( ! node || visited.has( node.id ) ) {
				continue;
			}
			visited.add( node.id );
			counts.total++;
			const children = childrenByMarker.get( node.id );
			if ( children ) {
				stack.push( ...children );
			}
		}
		descendantCountById.set( root.id, counts );
	} );

	return { roots, descendantCountById };
}
