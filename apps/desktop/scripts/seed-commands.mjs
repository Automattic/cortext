// Seed commands are supplied one per line. Parse each line into an argument
// list so wp-cli can run without sh or cmd.exe.

// Keep quoted values, such as `--post_title="Hello world"`, in one argument.
export function splitArguments( line ) {
	const args = [];
	let current = '';
	let quote = null;
	let started = false;

	for ( const char of line ) {
		if ( quote ) {
			if ( char === quote ) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if ( char === '"' || char === "'" ) {
			quote = char;
			started = true;
			continue;
		}
		if ( /\s/.test( char ) ) {
			if ( started ) {
				args.push( current );
				current = '';
				started = false;
			}
			continue;
		}
		current += char;
		started = true;
	}

	if ( quote ) {
		throw new Error(
			`Unclosed ${
				quote === '"' ? 'double' : 'single'
			} quote in seed command: ${ line }`
		);
	}
	if ( started ) {
		args.push( current );
	}
	return args;
}

function commandLines( value ) {
	return String( value )
		.split( /\r?\n/ )
		.map( ( line ) => line.trim() )
		.filter( Boolean );
}

// Return each wp-cli seed command as an argument list.
export function snapshotSeedCommands( env = process.env ) {
	const override = env.CORTEXT_DESKTOP_SEED_COMMANDS;
	if ( override?.trim() ) {
		return commandLines( override ).map( splitArguments );
	}

	const seedArgs = env.CORTEXT_DESKTOP_SEED_ARGS?.trim();
	const commands = [
		[ 'cortext', 'seed', ...splitArguments( seedArgs || '' ) ],
	];
	const extra = env.CORTEXT_DESKTOP_EXTRA_SEED_COMMANDS;
	if ( extra?.trim() ) {
		commands.push( ...commandLines( extra ).map( splitArguments ) );
	}

	return commands;
}
