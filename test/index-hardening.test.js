// The @3dtilesIndex1@ path against damaged or hostile archives: oversized
// entries, offsets outside the archive, wrong local headers, a bad index
// length — and the proof that one bad entry never breaks the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Archive3tz, blobSource } from '../src/index.js';
import { md5 } from '../src/index3tz.js';
import { make3tz, sampleFiles } from './helpers.js';

const text = bytes => new TextDecoder().decode( bytes );
const enc = new TextEncoder();
const bytesOf = f => ( typeof f.data === 'string' ? enc.encode( f.data ) : f.data );

// Force the index path: the central directory is "too large" to read.
const openByIndex = ( bytes, options = {} ) =>
	Archive3tz.open( blobSource( new Blob( [ bytes ] ) ), { maxDirectoryBytes: 10, tailBytes: 100, ...options } );

// Where the bytes of @3dtilesIndex1@ sit in an archive made by make3tz.
function indexData( bytes ) {

	const v = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const eocd = bytes.length - 22;
	const cdStart = v.getUint32( eocd + 16, true );
	const cdEnd = cdStart + v.getUint32( eocd + 12, true );
	let p = cdStart;
	let last = - 1;
	while ( p < cdEnd ) {

		last = p;
		p += 46 + v.getUint16( p + 28, true ) + v.getUint16( p + 30, true ) + v.getUint16( p + 32, true );

	}

	const offset = v.getUint32( last + 42, true );
	const start = offset + 30 + v.getUint16( offset + 26, true ) + v.getUint16( offset + 28, true );
	return { start, length: v.getUint32( last + 20, true ) };

}

// Where the 24-byte index record of `path` is (-1: no such record).
function indexRecord( bytes, path ) {

	const { start, length } = indexData( bytes );
	const key = md5( enc.encode( path.normalize( 'NFC' ) ) );
	for ( let i = 0; i + 24 <= length; i += 24 ) {

		if ( key.every( ( b, k ) => bytes[ start + i + k ] === b ) ) return start + i;

	}

	return - 1;

}

// The same archive, but the index record of `path` points at `newOffset`.
function rewriteIndexOffset( bytes, path, newOffset ) {

	const out = bytes.slice();
	const at = indexRecord( out, path );
	assert.ok( at >= 0, `${ path } has an index record` );
	new DataView( out.buffer ).setBigUint64( at + 16, BigInt( newOffset ), true );
	return out;

}

// The local-header offset the index gives for `path`.
function offsetOf( bytes, path ) {

	const at = indexRecord( bytes, path );
	assert.ok( at >= 0, `${ path } has an index record` );
	return Number( new DataView( bytes.buffer, bytes.byteOffset ).getBigUint64( at + 16, true ) );

}

test( 'index path: entries read normally, a missing path gives null', async () => {

	const files = sampleFiles( 5, 1500 );
	const archive = await openByIndex( make3tz( files ) );
	assert.equal( archive.info.lookup, 'index' );
	for ( const f of files ) assert.deepEqual( await archive.read( f.path ), bytesOf( f ), f.path );
	assert.equal( await archive.read( 'tiles/not-here.glb' ), null );

} );

test( 'index path: an entry over maxEntryBytes is refused before its data arrives', async () => {

	const source = blobSource( new Blob( [ make3tz( sampleFiles( 3, 5000 ) ) ] ) );
	const archive = await Archive3tz.open( source, { maxDirectoryBytes: 10, tailBytes: 100, maxEntryBytes: 1000 } );
	assert.equal( archive.info.lookup, 'index' );

	const before = source.stats();
	const error = await archive.read( 'tiles/1.glb' ).catch( e => e );
	assert.match( error.message, /^tiles\/1\.glb: its size is over the limit of 1000 bytes/, 'the error names the path' );
	const after = source.stats();
	assert.equal( after.requests - before.requests, 1, 'only the first, bounded request was made' );
	assert.ok( after.bytes - before.bytes <= 30 + 64 + 64 + 1000,
		`${ after.bytes - before.bytes } bytes came in for a 5000-byte entry: it never arrived whole` );

	// the archive is untouched by the failure
	assert.match( text( await archive.read( 'tileset.json' ) ), /"version":"1.1"/ );

} );

test( 'index path: a declared decompressed size over the limit is refused before inflating', async () => {

	const bomb = new Uint8Array( 2 * 1024 * 1024 ); // zeros: a few KB deflated
	const bytes = make3tz( [ { path: 'tileset.json', data: '{}' }, { path: 'bomb.glb', data: bomb, deflate: true } ] );
	const source = blobSource( new Blob( [ bytes ] ) );
	const archive = await Archive3tz.open( source, { maxDirectoryBytes: 10, tailBytes: 100, maxEntryBytes: 1024 * 1024 } );
	assert.equal( archive.info.lookup, 'index' );

	const before = source.stats().bytes;
	await assert.rejects( archive.read( 'bomb.glb' ), /bomb\.glb: its decompressed size is over the limit/ );
	assert.ok( source.stats().bytes - before < 200 * 1024, 'the 2 MB payload never inflated in memory' );
	assert.equal( text( await archive.read( 'tileset.json' ) ), '{}' );

} );

test( 'index path: a local header that lies about the decompressed size is stopped while inflating', async () => {

	const bomb = new Uint8Array( 2 * 1024 * 1024 );
	const good = make3tz( [ { path: 'tileset.json', data: '{}' }, { path: 'bomb.glb', data: bomb, deflate: true } ] );
	// the local header claims the entry inflates to 0 bytes; it does not
	const bytes = good.slice();
	new DataView( bytes.buffer ).setUint32( offsetOf( good, 'bomb.glb' ) + 22, 0, true );

	const archive = await openByIndex( bytes, { maxEntryBytes: 1024 * 1024 } );
	await assert.rejects( archive.read( 'bomb.glb' ), /bomb\.glb: its decompressed size is over the limit/ );
	assert.equal( text( await archive.read( 'tileset.json' ) ), '{}' );

} );

test( 'index path: an offset outside the archive is an error, not empty bytes', async () => {

	const files = sampleFiles( 3, 100 );
	const good = make3tz( files );
	for ( const bad of [ good.length + 1000, 2 ** 40 ] ) {

		const archive = await openByIndex( rewriteIndexOffset( good, 'tiles/1.glb', bad ) );
		await assert.rejects( archive.read( 'tiles/1.glb' ), /tiles\/1\.glb: the entry offset .* is outside the archive\./ );
		// the other entries of the same archive still read
		assert.deepEqual( await archive.read( 'tiles/0.glb' ), bytesOf( files[ 1 ] ) );
		assert.deepEqual( await archive.read( 'tiles/2.glb' ), bytesOf( files[ 3 ] ) );

	}

} );

test( 'index path: an offset that lands on data, not a local header, is an error', async () => {

	const files = sampleFiles( 3, 100 );
	const good = make3tz( files );
	// aim tiles/1.glb at the middle of the data of tiles/0.glb
	const bytes = rewriteIndexOffset( good, 'tiles/1.glb', offsetOf( good, 'tiles/0.glb' ) + 50 );
	const archive = await openByIndex( bytes );
	await assert.rejects( archive.read( 'tiles/1.glb' ), /tiles\/1\.glb: no local header at offset / );
	assert.deepEqual( await archive.read( 'tiles/0.glb' ), bytesOf( files[ 1 ] ), 'other entries still read' );

} );

test( 'index path: a local header whose name differs from the requested path is an error', async () => {

	const bytes = make3tz( [
		{ path: 'tileset.json', data: '{}' },
		{ path: 'tiles/0.glb', data: 'real', storedName: 'tiles/evil.glb' },
	] );
	const archive = await openByIndex( bytes );
	await assert.rejects( archive.read( 'tiles/0.glb' ), /Asked for tiles\/0\.glb, found tiles\/evil\.glb at offset / );
	assert.equal( text( await archive.read( 'tileset.json' ) ), '{}' );

} );

test( 'open: an index whose length is not a multiple of 24 fails at open', async () => {

	// 4 files: an index of 4 * 24 + 5 = 101 bytes, within the 5 * 24 bound
	const bytes = make3tz( sampleFiles( 3, 10 ), { indexExtraBytes: 5 } );
	await assert.rejects( openByIndex( bytes ), /not a multiple of 24/ );

} );

test( 'open: an index larger than its entries can need fails at open', async () => {

	// 4 files, 5 entries: an index of 4 * 24 + 48 = 144 bytes, a multiple of
	// 24 but over the 5 * 24 = 120 the entries could ever need
	const bytes = make3tz( sampleFiles( 3, 10 ), { indexExtraBytes: 48 } );
	await assert.rejects( openByIndex( bytes ), /@3dtilesIndex1@ is larger than its 5 entries need/ );

} );

test( 'a failed read leaves the archive fully usable, and fails the same way again', async () => {

	const files = sampleFiles( 3, 100 );
	const good = make3tz( files );
	const archive = await openByIndex( rewriteIndexOffset( good, 'tiles/1.glb', good.length + 1000 ) );

	assert.deepEqual( await archive.read( 'tiles/0.glb' ), bytesOf( files[ 1 ] ) );
	await assert.rejects( archive.read( 'tiles/1.glb' ), /outside the archive/ );
	assert.deepEqual( await archive.read( 'tiles/2.glb' ), bytesOf( files[ 3 ] ), 'reads after the failure work' );
	await assert.rejects( archive.read( 'tiles/1.glb' ), /outside the archive/, 'the failure is repeatable, no state kept' );
	assert.equal( archive.has( 'tiles/1.glb' ), true, 'the index itself is untouched' );

} );
