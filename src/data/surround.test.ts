import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createDatabase } from './database.js';
import { defaultSurround } from '../audio/surround.js';

describe('surround persistence', () => {
  it('migrates existing bots without changing EQ and persists across database reopen', () => {
    const dir=mkdtempSync(join(tmpdir(),'surround-test-')), path=join(dir,'db');
    let db=createDatabase(path);
    try {
      db.saveBotInstance({id:'a',name:'bot',serverAddress:'localhost',serverPort:9987,nickname:'bot',defaultChannel:'',channelId:'',channelPassword:'',autoStart:false,serverProtocol:'',ts6ApiKey:'',serverPassword:''});
      const eq={enabled:true,preamp:-4,gains:[1,2,3,4,5,6,5,4,3,2]};db.saveEqualizer('a',eq);
      db.db.exec('ALTER TABLE bot_instances DROP COLUMN surround'); db.close(); db=createDatabase(path);
      expect(db.getSurround('a')).toEqual(defaultSurround()); expect(db.getEqualizer('a')).toEqual(eq);
      const value={enabled:true,strength:81,room:37};db.saveSurround('a',value);db.close();db=createDatabase(path);
      expect(db.getSurround('a')).toEqual(value);expect(db.getEqualizer('a')).toEqual(eq);
      expect(() => db.saveSurround('a',{...value,room:200})).toThrow();expect(db.getSurround('a')).toEqual(value);
      expect(() => db.saveSurround('missing',value)).toThrow('Bot not found');
      db.db.prepare('UPDATE bot_instances SET surround=? WHERE id=?').run('{broken','a');
      expect(db.getSurround('a')).toEqual(defaultSurround());
    } finally { db.close();rmSync(dir,{recursive:true,force:true}); }
  });
});
