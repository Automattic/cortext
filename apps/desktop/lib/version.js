// WordPress-style versions: "0.1.0", with no leading "v". Ignore prerelease
// suffixes for ordering; the numeric core decides what is newer.
function parseVersion( tag ) {
	const match = String( tag || '' )
		.trim()
		.replace( /^v/, '' )
		.match( /^(\d+)\.(\d+)\.(\d+)/ );
	return match
		? [ Number( match[ 1 ] ), Number( match[ 2 ] ), Number( match[ 3 ] ) ]
		: null;
}

function isNewer( candidate, current ) {
	for ( let i = 0; i < 3; i++ ) {
		if ( candidate[ i ] !== current[ i ] ) {
			return candidate[ i ] > current[ i ];
		}
	}
	return false;
}

module.exports = { parseVersion, isNewer };
