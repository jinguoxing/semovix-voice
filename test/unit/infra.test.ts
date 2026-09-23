/**
 * 测试基建自检：验证 vitest 可加载原生依赖与路径别名。
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('test infrastructure', () => {
  it('loads better-sqlite3 native module and creates an in-memory db', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
    const row = db.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string };
    expect(row.v).toBe('hello');
    db.close();
  });
});
