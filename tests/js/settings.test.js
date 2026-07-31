import {
	canManageCortextSettings,
	getCortextFeatures,
	getCortextExperiments,
	isExperimentEnabled,
	isPublicWebAffordancesEnabled,
	isWordPressAffordancesEnabled,
	syncCortextExperiments,
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

	it( 'reads experiment flags from cortextSettings', () => {
		window.cortextSettings = {
			experiments: {
				quickEditing: true,
				slowEditing: false,
			},
		};

		expect( getCortextExperiments() ).toEqual( {
			quickEditing: true,
			slowEditing: false,
		} );
		expect( isExperimentEnabled( 'quickEditing' ) ).toBe( true );
		expect( isExperimentEnabled( 'slowEditing' ) ).toBe( false );
		expect( isExperimentEnabled( 'missing' ) ).toBe( false );
	} );

	it( 'synchronizes experiment flags from the REST response', () => {
		const settings = {
			adminUrl: '/wp-admin/',
			experiments: { oldExperiment: true },
		};
		window.cortextSettings = settings;

		syncCortextExperiments( [
			{ id: 'quickEditing', enabled: true },
			{ id: 'slowEditing', enabled: false },
		] );

		expect( window.cortextSettings ).toBe( settings );
		expect( getCortextExperiments() ).toEqual( {
			quickEditing: true,
			slowEditing: false,
		} );
		expect( isExperimentEnabled( 'quickEditing' ) ).toBe( true );
		expect( isExperimentEnabled( 'oldExperiment' ) ).toBe( false );
		expect( window.cortextSettings.adminUrl ).toBe( '/wp-admin/' );
	} );

	it( 'defaults experiment and capability helpers to disabled', () => {
		expect( getCortextExperiments() ).toEqual( {} );
		expect( isExperimentEnabled( 'quickEditing' ) ).toBe( false );
		expect( canManageCortextSettings() ).toBe( false );
	} );

	it( 'reads manage options capability from cortextSettings', () => {
		window.cortextSettings = {
			capabilities: {
				manageOptions: true,
			},
		};

		expect( canManageCortextSettings() ).toBe( true );
	} );
} );
