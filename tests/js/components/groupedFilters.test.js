import { filterSortAndPaginateWithGroups } from '../../../src/components/groupedFilters';
import { sortByDateRangeStart } from '../../../src/utils/dateRange';

const fields = [
	{
		id: 'title',
		type: 'text',
		label: 'Title',
		enableGlobalSearch: true,
		getValue: ( { item } ) => item.title,
	},
	{
		id: 'notes',
		type: 'text',
		label: 'Notes',
		enableGlobalSearch: true,
		getValue: ( { item } ) => item.notes,
	},
	{
		id: 'links',
		type: 'array',
		label: 'Links',
		getValue: ( { item } ) => item.links,
	},
	{
		id: 'score',
		type: 'integer',
		label: 'Score',
		getValue: ( { item } ) => item.score,
	},
];

describe( 'date range filters', () => {
	const dateFields = [
		{
			id: 'when',
			type: 'date',
			label: 'When',
			getValue: ( { item } ) => item.when,
		},
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			getValue: ( { item } ) => item.title,
		},
	];
	const rows = [
		{ id: 1, title: 'Spans the week', when: '2026-05-11/2026-05-31' },
		{ id: 2, title: 'Inside', when: '2026-05-20' },
		{ id: 3, title: 'Earlier', when: '2026-05-01/2026-05-17' },
		{ id: 4, title: 'Later', when: '2026-05-25' },
		{ id: 5, title: 'Empty', when: '' },
	];
	const ids = ( view ) =>
		filterSortAndPaginateWithGroups( rows, view, dateFields ).data.map(
			( row ) => row.id
		);

	it( 'matches ranges that overlap a between filter', () => {
		expect(
			ids( {
				filters: [
					{
						field: 'when',
						operator: 'between',
						value: [ '2026-05-18', '2026-05-24' ],
					},
				],
			} )
		).toEqual( [ 1, 2 ] );
	} );

	it( 'matches ranges covering an on day, alongside other filters', () => {
		expect(
			ids( {
				filters: [
					{ field: 'when', operator: 'on', value: '2026-05-15' },
					{ field: 'title', operator: 'contains', value: 'e' },
				],
			} )
		).toEqual( [ 1, 3 ] );
	} );

	it( 'sorts by start', () => {
		expect(
			filterSortAndPaginateWithGroups(
				rows.slice( 0, 4 ),
				{ sort: { field: 'when', direction: 'asc' } },
				dateFields.map( ( f ) =>
					f.id === 'when' ? { ...f, sort: sortByDateRangeStart } : f
				)
			).data.map( ( row ) => row.id )
		).toEqual( [ 3, 1, 2, 4 ] );
	} );
} );

describe( 'filterSortAndPaginateWithGroups', () => {
	it( 'applies OR groups in client mode instead of letting DataViews ignore them', () => {
		const result = filterSortAndPaginateWithGroups(
			[
				{ id: 1, title: 'Alpha', notes: 'draft', links: [] },
				{
					id: 2,
					title: 'Beta',
					notes: 'done',
					links: [ 'relation-b' ],
				},
				{ id: 3, title: 'Gamma', notes: 'done', links: [] },
			],
			{
				filters: [
					{
						relation: 'OR',
						filters: [
							{
								field: 'title',
								operator: 'contains',
								value: 'alp',
							},
							{
								field: 'links',
								operator: 'contains',
								value: 'relation-b',
							},
						],
					},
				],
			},
			fields
		);

		expect( result.data.map( ( row ) => row.id ) ).toEqual( [ 1, 2 ] );
	} );

	it( 'applies nested AND and OR groups before DataViews pagination', () => {
		const result = filterSortAndPaginateWithGroups(
			[
				{ id: 1, title: 'Alpha', notes: 'draft', score: 2 },
				{ id: 2, title: 'Beta', notes: 'done', score: 8 },
				{ id: 3, title: 'Gamma', notes: 'done', score: 12 },
			],
			{
				page: 1,
				perPage: 1,
				filters: [
					{
						relation: 'AND',
						filters: [
							{
								field: 'notes',
								operator: 'is',
								value: 'done',
							},
							{
								relation: 'OR',
								filters: [
									{
										field: 'score',
										operator: 'lessThan',
										value: 10,
									},
									{
										field: 'title',
										operator: 'is',
										value: 'Alpha',
									},
								],
							},
						],
					},
				],
			},
			fields
		);

		expect( result.data.map( ( row ) => row.id ) ).toEqual( [ 2 ] );
		expect( result.paginationInfo ).toEqual( {
			totalItems: 1,
			totalPages: 1,
		} );
	} );

	it( 'keeps DataViews search semantics after grouped filtering', () => {
		const result = filterSortAndPaginateWithGroups(
			[
				{ id: 1, title: 'Alpha', notes: 'keep' },
				{ id: 2, title: 'Beta', notes: 'keep' },
				{ id: 3, title: 'Gamma', notes: 'drop' },
			],
			{
				search: 'bet',
				filters: [
					{
						relation: 'OR',
						filters: [
							{
								field: 'notes',
								operator: 'is',
								value: 'keep',
							},
						],
					},
				],
			},
			fields
		);

		expect( result.data.map( ( row ) => row.id ) ).toEqual( [ 2 ] );
	} );
} );
