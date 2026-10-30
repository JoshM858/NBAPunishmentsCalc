// A tiny stand-in for Cloudflare KV that keeps its data in one JSON file, so the PC version can store the trade block.
// Same three calls the Worker code uses: get, put, list. Writes are queued and saved atomically.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createFileKV(file) {
  let data = {};
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  let queue = Promise.resolve();
  const save = () => {
    queue = queue.then(() => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data));
      renameSync(`${file}.tmp`, file);
    });
    return queue;
  };
  return {
    async get(key) {
      return key in data ? data[key] : null;
    },
    async put(key, value) {
      data[key] = String(value);
      await save();
    },
    async list({ prefix = '' } = {}) {
      return { keys: Object.keys(data).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}
