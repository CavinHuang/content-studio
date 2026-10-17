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
import { IllustrationTechnicalAudit } from '../src/illustration-technical-audit.mjs';
import { ImageQualityLedger } from '../src/image-quality-ledger.mjs';
import { ImageRoundtripReconciliation } from '../src/image-roundtrip-reconciliation.mjs';
import { DeliveryReadiness } from '../src/delivery-readiness.mjs';
import { WritingService } from '../src/writing.mjs';
import {CreatorServices,credentialKey} from '../src/creator-services.mjs';
import {XiaohongshuService} from '../src/xiaohongshu.mjs';
import {PublishingService} from '../src/publishing.mjs';
import {CreatorService} from '../src/creator.mjs';
import { defaultSources } from '../src/adapters.mjs';
import { join } from 'node:path';

// One locally persistent instance across App Router requests and dev hot reloads.
const key = Symbol.for('content-studio.next.core.v1');
export function createCore(path = process.env.CONTENT_STUDIO_DB_PATH || join(process.cwd(), 'data', 'content-studio.sqlite'),options={}) {
  const store = new Store(path);
  const services=new CreatorServices(store.db,{...options.services,key:options.key||credentialKey(path)});
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
  const technicalAudit = new IllustrationTechnicalAudit(illustrations, assets, deliveryQa);
  const qualityLedger = new ImageQualityLedger(store.db, illustrations, assets);
  const imageRoundtrip = new ImageRoundtripReconciliation(illustrations, editorial);
  const deliveryReadiness = new DeliveryReadiness({store,editorial,illustrations,qualityLedger,deliveryQa,imageRoundtrip,technicalAudit,queue});
  editorial.attachPrecision();
  const writing = new WritingService(store, editorial, precision, assets);
  const core={ store, services, sync, selected, verification, knowledge, precision, editorial, writing, assets, illustrations, queue, deliveryQa, technicalAudit, qualityLedger, imageRoundtrip, deliveryReadiness, defaultSources,
    close() { store.close(); } };
  const creator=new CreatorService(core);core.creator=creator;writing.creator=creator;illustrations.creator=creator;core.xhs=new XiaohongshuService(core);core.publishing=new PublishingService(core,options.publishing);return core;
}
const workspaceKey=Symbol.for('content-studio.workspace-cores');
export function getAuthorCore(accounts,author){const map=globalThis[workspaceKey]??=new Map();if(!map.has(author.workspaceId)){if(map.size>=100)throw Object.assign(new Error('当前作者空间容量已满'),{status:503});map.set(author.workspaceId,createCore(accounts.workspace(author),{key:accounts.key}))}return map.get(author.workspaceId)}
export function getCore() {
  if (!globalThis[key]) globalThis[key] = createCore();
  return globalThis[key];
}
