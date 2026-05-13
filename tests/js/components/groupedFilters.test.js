import { filterSortAndPaginateWithGroups } from '../../../src/components/groupedFilters';

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
