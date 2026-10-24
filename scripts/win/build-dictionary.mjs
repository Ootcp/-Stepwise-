#!/usr/bin/env node
/**
 * Turn the published ECDICT database into the smaller one 拾级 reads.
 *
 *   node build-dictionary.mjs <stardict.db> <english-words.db>
 *
 * ECDICT ships every entry with its English definition and audio fields, which is 851 MB of
 * data the reader never uses. The app queries word, phonetic, translation, pos, tag and
 * frequency, so the copy it installs holds exactly those columns — the same shape the
 * development dictionary already has.
 *
 * The target file is written from scratch and is expected to be a temporary name; the caller
 * renames it into place once this exits with code 0.
 */

import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
	process.stderr.write("用法:node build-dictionary.mjs <stardict.db> <english-words.db>\n");
	process.exit(2);
}

const started = Date.now();
const dictionary = new DatabaseSync(resolve(target));
dictionary.exec("pragma journal_mode = off");
dictionary.exec("pragma synchronous = off");
dictionary.exec("pragma cache_size = -65536");
dictionary.exec(`attach database '${resolve(source).replaceAll("'", "''")}' as src`);

const total = dictionary.prepare("select count(*) as count from src.stardict").get().count;
process.stdout.write(`读取 ${total} 条词条…\n`);

dictionary.exec("begin");
dictionary.exec(
	"create table words (word text primary key, phonetic text, translation text, pos text, tag text, frq integer, exchange text)",
);
dictionary.exec("insert into words select word, phonetic, translation, pos, tag, frq, exchange from src.stardict where word is not null and trim(word) <> ''");
dictionary.exec("create index idx_frq on words (frq)");
dictionary.exec("commit");
dictionary.exec("vacuum");

const kept = dictionary.prepare("select count(*) as count from main.words").get().count;
dictionary.exec("detach database src");
dictionary.close();

const bytes = statSync(resolve(target)).size;
process.stdout.write(
	`写入 ${kept} 条,丢弃 ${total - kept} 条空词条,${(bytes / 1024 / 1024).toFixed(0)} MB,用时 ${((Date.now() - started) / 1000).toFixed(0)} 秒\n`,
);
