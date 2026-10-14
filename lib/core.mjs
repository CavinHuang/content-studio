import { Store } from '../src/store.mjs';
import { SyncEngine } from '../src/sync.mjs';
import { SelectedMirror } from '../src/selected.mjs';
import { VerificationService } from '../src/verification.mjs';
import { KnowledgeService } from '../src/knowledge.mjs';
import { PrecisionService } from '../src/precision.mjs';
import { EditorialService } from '../src/editorial.mjs';
import { AssetService } from '../src/assets.mjs';
import { IllustrationService } from '../src/illustrations.mjs';
import { IllustrationQueue } from '../src/illustration-queue.mjs';
import { IllustrationDeliveryQa } from '../src/illustration-delivery-qa.mjs';
import { defaultSources } from '../src/adapters.mjs';
import { join } from 'node:path';

// One locally persistent instance across App Router requests and dev hot reloads.
const key = Symbol.for('content-studio.next.core.v1');
export function createCore(path = process.env.CONTENT_STUDIO_DB_PATH || join(process.cwd(), 'data', 'content-studio.sqlite')) {
  const store = new Store(path);
  const sync = new SyncEngine(store);
  const selected = new SelectedMirror(store);
  const verification = new VerificationService(store);
  const knowledge = new KnowledgeService(store, verification);
  const precision = new PrecisionService(store, verification, knowledge);
  const editorial = new EditorialService(store, knowledge, precision);
  const assets = new AssetService(store);
  const illustrations = new IllustrationService(store, editorial, assets);
  const queue = new IllustrationQueue(store.db, illustrations);
  const deliveryQa = new IllustrationDeliveryQa(store, illustrations);
  editorial.attachPrecision();
  return { store, sync, selected, verification, knowledge, precision, editorial, assets, illustrations, queue, deliveryQa, defaultSources,
    close() { store.close(); } };
}
export function getCore() {
  if (!globalThis[key]) globalThis[key] = createCore();
  return globalThis[key];
}
