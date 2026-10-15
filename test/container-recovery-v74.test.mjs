import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createBackup,verifyBackup,restoreBackup} from '../scripts/db-safety.mjs';
import {parseCommand,mountedAt,decidePrune,inventory,execute,
 verifyMaintenanceMount} from '../scripts/container-recovery-v74.mjs';
const name=n=>'content-studio-v74-2026-10-15T10-00-00-'+n.repeat(16)+'.sqlite';
const isolate=t=>{
 const root=mkdtempSync(join(tmpdir(),'cs-v74-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=join(root,'source.sqlite'),backups=join(root,'vault'),restore=join(root,'restore');
 mkdirSync(backups,{mode:0o700});mkdirSync(restore,{mode:0o700});
 const conn=new DatabaseSync(db);
 conn.exec("PRAGMA journal_mode=WAL; CREATE TABLE items(id TEXT PRIMARY KEY, data BLOB)");
 conn.prepare('INSERT INTO items VALUES (?,?)').run('one',Buffer.from([0,1,2,3]));
 conn.close();chmodSync(db,0o600);
 return {root,db,backups,restore};
};
test('V74 strict commands reject unsafe retention and paths',()=>{
 for(const bad of [[],['backup','--db=/private/db.sqlite'],
  ['restore','--backup=../../live.sqlite'],['prune','--keep=1','--apply=yes'],
  ['prune','--keep=2','--apply=maybe'],['prune','--keep=2'],
  ['backup','--backup=x'],['restore','--backup='+name('a'),'--backup='+name('b')]])
  assert.throws(()=>parseCommand(bad));
 assert.equal(parseCommand(['restore','--backup='+name('a')]).backup,name('a'));
});
test('V74 explicit Docker mountpoint validation, not a directory under rootfs',()=>{
 const fixture='46 12 8:2 / / rw - overlay overlay rw\n'+
  '47 46 8:3 / /app/backups rw - ext4 /dev/sda rw\n';
 assert.equal(mountedAt('/app/backups',fixture),true);
 assert.equal(mountedAt('/app/data',fixture),false);
});
test('V74 prune preview never removes archive and keeps newest N',()=>{
 const entries=['a','b','c'].map(ch=>({name:name(ch)}));
 const d=decidePrune(entries,2);
 assert.deepEqual(d.remove,[name('a')]);
 assert.deepEqual(d.retain,[name('b'),name('c')]);
});
test('V74 real WAL snapshot and copied database preserve blob contents',async t=>{
 const f=isolate(t),backup=join(f.backups,name('a')),target=join(f.restore,'content-studio.sqlite');
 const original=new DatabaseSync(f.db);
 original.exec("PRAGMA journal_mode=WAL");
 original.prepare('INSERT INTO items VALUES (?,?)').run('two',Buffer.from([9,8,7]));
 await createBackup(f.db,{outputPath:backup});
 const a=await verifyBackup(backup,{includeContentDigest:true});
 assert.equal(a.backupValid,true);
 assert.equal(a.manifestVerified,true);
 await restoreBackup(backup,target);
 const newDb=new DatabaseSync(target,{readOnly:true});
 assert.equal(Buffer.compare(Buffer.from(newDb.prepare("SELECT data FROM items WHERE id='two'").get().data),Buffer.from([9,8,7])),0);
 newDb.close();original.close();
});
test('V74 actual inventory verifies SQLite/manifests, rejects foreign files',async t=>{
 const f=isolate(t),file=join(f.backups,name('a'));
 await createBackup(f.db,{outputPath:file});
 assert.equal((await inventory(f.backups)).length,1);
 writeFileSync(join(f.backups,'unknown.txt'),'secret');
 await assert.rejects(()=>inventory(f.backups),/Unknown or incomplete/);
});
test('V74 tampered manifest or archive cannot be automatically pruned',async t=>{
 const f=isolate(t),file=join(f.backups,name('a'));
 await createBackup(f.db,{outputPath:file});
 writeFileSync(file+'.manifest.json','{}');
 await assert.rejects(()=>inventory(f.backups));
});
test('V74 backup filesystem operator requires a private real mount',async t=>{
 const f=isolate(t);
 await assert.rejects(()=>verifyMaintenanceMount(f.backups,{read:async()=>''}),/independent Docker mount/);
 const parent=join(f.root,'public');mkdirSync(parent,{mode:0o755});
 await assert.rejects(()=>verifyMaintenanceMount(parent,{read:async()=>''}),/owner-only/);
});
test('V74 refuse symlinked files in vault',async t=>{
 const f=isolate(t),n=name('a'),full=join(f.backups,n);
 await createBackup(f.db,{outputPath:full});
 symlinkSync(full,join(f.backups,name('b')));
 await assert.rejects(()=>inventory(f.backups));
});
test('V74 no retention deletion without confirmed apply yes',async t=>{
 const f=isolate(t),out=join(f.backups,name('a'));
 await createBackup(f.db,{outputPath:out});
 let removals=0;
 const args={operation:'prune',keep:'2',apply:'no'};
 const result=await execute(args,{dir:f.backups,mount:async()=>true,
  remove:async()=>{removals++}});
 assert.equal(result.applied,false);
 assert.equal(removals,0);
});
test('V74 restore safety refuses overwrite of new volume destination',async t=>{
 const f=isolate(t),out=join(f.backups,name('a'));
 await createBackup(f.db,{outputPath:out});
 writeFileSync(join(f.restore,'content-studio.sqlite'),'DO-NOT-OVERWRITE');
 await assert.rejects(()=>execute({operation:'restore',backup:name('a')},
  {dir:f.backups,restoreDir:f.restore,mount:async()=>true}));
 assert.equal(readFileSync(join(f.restore,'content-studio.sqlite'),'utf8'),'DO-NOT-OVERWRITE');
});
