import test from 'node:test';
import assert from 'node:assert/strict';
import {readUiTheme,saveUiTheme,isUiTheme,themeOption} from '../src/renderer/ui-theme';

function storage(initial:Record<string,string>={}){
 const values=new Map(Object.entries(initial));
 return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}};
}

test('外观默认使用宣纸主题，切换后保存并在下次读取时恢复',()=>{
 const values=storage();
 assert.equal(readUiTheme(values),'paper');
 assert.equal(saveUiTheme('cinema',values),true);
 assert.equal(readUiTheme(values),'cinema');
 assert.equal(saveUiTheme('neon',values),true);
 assert.equal(readUiTheme(values),'neon');
 assert.equal(saveUiTheme('arcade',values),true);
 assert.equal(readUiTheme(values),'arcade');
 assert.equal(saveUiTheme('paper',values),true);
 assert.equal(readUiTheme(values),'paper');
});

test('无效或损坏的主题记录回到默认，存储不可用不会让应用崩溃',()=>{
 for(const value of ['','unknown','PAPER','cinema ','null'])assert.equal(readUiTheme({getItem:()=>value}),'paper');
 assert.equal(isUiTheme('cinema'),true);
 assert.equal(isUiTheme('unknown'),false);
 assert.equal(saveUiTheme('unknown' as never,storage()),false);
 const broken={getItem:()=>{throw Error('unavailable')},setItem:()=>{throw Error('unavailable')}};
 assert.equal(readUiTheme(broken),'paper');
 assert.equal(saveUiTheme('cinema',broken),false);
 assert.equal(themeOption('neon').name,'流光');
});