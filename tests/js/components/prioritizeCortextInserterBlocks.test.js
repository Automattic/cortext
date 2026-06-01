/**
 * Tests for the slash-inserter reordering that floats Cortext's own blocks to
 * the top. The completer wrapping is a thin hook; the orderable logic lives in
 * `prioritizeCortextOptions`, which is what these tests pin down.
 */
import {
	prioritizeCortextOptions,
	withCortextPriority,
} from '../../../src/components/prioritizeCortextInserterBlocks';

const option = ( name ) => ( { value: { name } } );

describe( 'prioritizeCortextOptions', () => {
	it( 'floats cortext blocks ahead of core, preserving relative order', () => {
		const ordered = prioritizeCortextOptions( [
			option( 'core/columns' ),
			option( 'cortext/data-view' ),
			option( 'core/list' ),
			option( 'cortext/document-properties' ),
		] );

		expect( ordered.map( ( o ) => o.value.name ) ).toEqual( [
			'cortext/data-view',
			'cortext/document-properties',
			'core/columns',
			'core/list',
		] );
	} );

	it( 'leaves a list without cortext blocks untouched', () => {
		const ordered = prioritizeCortextOptions( [
			option( 'core/columns' ),
			option( 'core/list' ),
		] );

		expect( ordered.map( ( o ) => o.value.name ) ).toEqual( [
			'core/columns',
			'core/list',
		] );
	} );
} );

describe( 'withCortextPriority', () => {
	it( 'wraps only the block completer and passes others through', () => {
		const other = { name: 'users', useItems: () => [ [] ] };
		const blocks = { name: 'blocks', useItems: () => [ [] ] };

		const [ wrappedOther, wrappedBlocks ] = withCortextPriority( [
			other,
			blocks,
		] );

		expect( wrappedOther ).toBe( other );
		expect( wrappedBlocks ).not.toBe( blocks );
		expect( wrappedBlocks.name ).toBe( 'blocks' );
	} );
} );
