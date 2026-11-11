import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {load}=createRequire(import.meta.url)('js-yaml');
const releaseDirectory=process.env.RELEASE_DIRECTORY||'release';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const info=load(await readFile(`${releaseDirectory}/latest.yml`,'utf8'));
assert.equal(info.version,version,'latest.yml must match package.json');
const filename=`Hongguo-Manju-${version}-Windows-x64.exe`;
assert.equal(info.path,filename);assert.equal(info.files.length,1);assert.equal(info.files[0].url,filename);
const hash=createHash('sha512');let size=0;
for await(const chunk of createReadStream(`${releaseDirectory}/${filename}`)){hash.update(chunk);size+=chunk.length;}
const sha512=hash.digest('base64');assert.equal(info.sha512,sha512);assert.equal(info.files[0].sha512,sha512);
const config=load(await readFile(`${releaseDirectory}/win-unpacked/resources/app-update.yml`,'utf8'));
assert.equal(config.provider,'github');assert.equal(config.owner,'lhljpt-web');assert.equal(config.repo,'hongguo-manju-desktop');
assert.equal(config.token,undefined);assert.equal(config.url,undefined);
console.log(JSON.stringify({version,filename,bytes:size,sha512,provider:config.provider,repository:`${config.owner}/${config.repo}`,verified:true},null,2));
