import {
	relationTargetStatuses,
	withRelationTargetStatuses,
} from '../../../../src/components/relations/relationUtils';

const ada = { id: 12, title: { raw: 'Ada Lovelace' }, status: 'private' };
const alan = { id: 13, title: { raw: 'Alan Turing' }, status: 'private' };

describe( 'relationTargetStatuses', () => {
	it( 'collects statuses from relation and rollup references only', () => {
		expect(
			relationTargetStatuses( {
				'field-5': [ ada, { ...alan, status: 'crtxt_archived' } ],
				'field-6': [ 'red', 'blue' ],
				'field-7': 3,
			} )
		).toEqual( { 12: 'private', 13: 'crtxt_archived' } );
	} );
} );

describe( 'withRelationTargetStatuses', () => {
	it( 'returns the same object when there are no statuses', () => {
		const meta = { 'field-5': [ ada ] };

		expect( withRelationTargetStatuses( meta, {} ) ).toBe( meta );
	} );

	it( 'updates only the status of known targets', () => {
		const meta = {
			'field-5': [ ada, alan ],
			'field-6': [ 'red' ],
			'field-7': 3,
		};

		expect(
			withRelationTargetStatuses( meta, { 12: 'crtxt_archived' } )
		).toEqual( {
			'field-5': [ { ...ada, status: 'crtxt_archived' }, alan ],
			'field-6': [ 'red' ],
			'field-7': 3,
		} );
	} );

	it( 'keeps newer relation values and only patches their status', () => {
		const statusesFromEarlierArchive = { 12: 'crtxt_archived' };
		const savedLater = { 'field-5': [ alan ] };

		expect(
			withRelationTargetStatuses( savedLater, statusesFromEarlierArchive )
		).toEqual( savedLater );
	} );
} );
