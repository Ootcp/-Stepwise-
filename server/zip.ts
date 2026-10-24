import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer for the generated .docx. A Word file is a ZIP of XML parts, and the
 * package format only needs stored/deflated entries — no folders, no ZIP64, no encryption.
 *
 * Everything is written in one pass and every local header carries its CRC and sizes (no
 * data descriptor), so any unzip tool can read the result without seeking.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

export function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	/** ASCII path inside the archive, e.g. `word/document.xml`. */
	name: string;
	data: Buffer;
}

/** Fixed DOS timestamp (1980-01-01 00:00) so identical input produces identical bytes. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export function createZip(entries: ZipEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		if (!/^[\x20-\x7e]+$/.test(entry.name)) throw new Error(`ZIP entry name must be ASCII: ${entry.name}`);
		const name = Buffer.from(entry.name, "ascii");
		const compressed = deflateRawSync(entry.data);
		const crc = crc32(entry.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + compressed.length;
	}

	const localBytes = Buffer.concat(locals);
	const centralBytes = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBytes.length, 12);
	end.writeUInt32LE(localBytes.length, 16);
	end.writeUInt16LE(0, 20);

	return Buffer.concat([localBytes, centralBytes, end]);
}
