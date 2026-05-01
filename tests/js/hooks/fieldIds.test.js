import {
	toRecordId,
	toDataViewId,
	toMetaFieldsString,
} from '../../../src/hooks/fieldIds';

describe( 'toRecordId', () => {
	it( 'returns the numeric ID for `field-<id>` keys', () => {
		expect( toRecordId( 'field-123' ) ).toBe( 123 );
		expect( toRecordId( 'field-1' ) ).toBe( 1 );
	} );

	it( 'returns null for system field IDs', () => {
		expect( toRecordId( 'created_at' ) ).toBeNull();
		expect( toRecordId( 'created_by' ) ).toBeNull();
		expect( toRecordId( 'modified_at' ) ).toBeNull();
		expect( toRecordId( 'modified_by' ) ).toBeNull();
	} );

	it( 'returns null for the title key', () => {
		expect( toRecordId( 'title' ) ).toBeNull();
	} );

	it( 'returns null for the ghost-column synthetic ID', () => {
		expect( toRecordId( '__add_field' ) ).toBeNull();
	} );

	it( 'returns null for malformed inputs', () => {
		expect( toRecordId( 'field-' ) ).toBeNull();
		expect( toRecordId( 'field-abc' ) ).toBeNull();
		expect( toRecordId( 'field-12.3' ) ).toBeNull();
		expect( toRecordId( 'something-else' ) ).toBeNull();
		expect( toRecordId( null ) ).toBeNull();
		expect( toRecordId( undefined ) ).toBeNull();
		expect( toRecordId( 123 ) ).toBeNull();
	} );
} );

describe( 'toDataViewId', () => {
	it( 'returns the `field-<id>` form for positive integers', () => {
		expect( toDataViewId( 1 ) ).toBe( 'field-1' );
		expect( toDataViewId( 999 ) ).toBe( 'field-999' );
	} );

	it( 'accepts numeric strings', () => {
		expect( toDataViewId( '42' ) ).toBe( 'field-42' );
	} );

	it( 'returns null for invalid IDs', () => {
		expect( toDataViewId( 0 ) ).toBeNull();
		expect( toDataViewId( -1 ) ).toBeNull();
		expect( toDataViewId( 'abc' ) ).toBeNull();
		expect( toDataViewId( null ) ).toBeNull();
		expect( toDataViewId( undefined ) ).toBeNull();
	} );
} );

describe( 'toMetaFieldsString', () => {
	it( 'returns a string copy of the numeric ID', () => {
		expect( toMetaFieldsString( 1 ) ).toBe( '1' );
		expect( toMetaFieldsString( 999 ) ).toBe( '999' );
		expect( toMetaFieldsString( '42' ) ).toBe( '42' );
	} );

	it( 'returns null for invalid IDs', () => {
		expect( toMetaFieldsString( 0 ) ).toBeNull();
		expect( toMetaFieldsString( -1 ) ).toBeNull();
		expect( toMetaFieldsString( 'abc' ) ).toBeNull();
		expect( toMetaFieldsString( null ) ).toBeNull();
	} );
} );

describe( 'round-trip', () => {
	it( 'converts numeric ID → DataView ID → numeric ID', () => {
		const recordId = 123;
		const dataViewId = toDataViewId( recordId );
		expect( toRecordId( dataViewId ) ).toBe( recordId );
	} );

	it( 'converts numeric ID → meta string → REST-compatible numeric', () => {
		const recordId = 456;
		const metaString = toMetaFieldsString( recordId );
		expect( Number( metaString ) ).toBe( recordId );
	} );
} );
