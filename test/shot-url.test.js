import test from 'node:test';
import assert from 'node:assert/strict';
import { shotUrl } from '../tools/lib/shot-url.mjs';

test('a shot with no declared level produces the historic URL exactly', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'hero' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero',
  );
});

test('a declared level is appended', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'plate', level: 'ledge-02' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=plate&level=ledge-02',
  );
});

test('extra query is appended after the level', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'hero', level: 'a', extra: 'quality=low' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero&level=a&quality=low',
  );
});

test('shot and level names are encoded', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'a b', level: 'c&d' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=a%20b&level=c%26d',
  );
});

test('null and undefined levels are both treated as absent', () => {
  const bare = 'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero';
  assert.equal(shotUrl({ port: 5199, shot: 'hero', level: null }), bare);
  assert.equal(shotUrl({ port: 5199, shot: 'hero', level: undefined }), bare);
});
