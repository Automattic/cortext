import {
	getCortextFeatures,
	isPublicWebAffordancesEnabled,
	isWordPressAffordancesEnabled,
} from '../../src/settings';

describe( 'settings', () => {
	afterEach( () => {
		delete window.cortextSettings;
	} );

	it( 'keeps feature flags enabled when settings are missing', () => {
		expect( getCortextFeatures() ).toEqual( {
			publicWebAffordances: true,
			wordpressAffordances: true,
		} );
		expect( isPublicWebAffordancesEnabled() ).toBe( true );
		expect( isWordPressAffordancesEnabled() ).toBe( true );
	} );

	it( 'reads disabled flags from cortextSettings', () => {
		window.cortextSettings = {
			features: {
				publicWebAffordances: false,
				wordpressAffordances: false,
			},
		};

		expect( getCortextFeatures() ).toEqual( {
			publicWebAffordances: false,
			wordpressAffordances: false,
		} );
		expect( isPublicWebAffordancesEnabled() ).toBe( false );
		expect( isWordPressAffordancesEnabled() ).toBe( false );
	} );

	it( 'keeps individual missing flags enabled', () => {
		window.cortextSettings = {
			features: {
				publicWebAffordances: false,
			},
		};

		expect( getCortextFeatures() ).toEqual( {
			publicWebAffordances: false,
			wordpressAffordances: true,
		} );
		expect( isWordPressAffordancesEnabled() ).toBe( true );
	} );
} );
