import {defineConfig} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Isolated throwaway DB. Fake provider only points at an unused loopback port;
// accidental generation in a browser test cannot call real paid services.
const tmp=mkdtempSync(join(tmpdir(),'content-studio-e2e-'));
const port=process.env.PLAYWRIGHT_PORT||'4312';
const baseURL='http://127.0.0.1:'+port;
export default defineConfig({
 testDir:'./e2e',
 timeout:45000,
 expect:{timeout:15000},
 retries:process.env.CI?1:0,
 workers:1,
 reporter:process.env.CI?[['list'],['html',{open:'never',outputFolder:'playwright-report'}]]:[['list']],
 use:{baseURL,browserName:'chromium',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}}:{})},
 webServer:{
  command:'npm run start',
  url:baseURL+'/api/health',
  timeout:120000,
  reuseExistingServer:false,
  env:{
   ...process.env,
   HOST:'127.0.0.1',PORT:port,
   CONTENT_AI_API_KEY:'',CONTENT_AI_BASE_URL:'',CONTENT_AI_MODEL:'',
   CONTENT_STUDIO_DB_PATH:join(tmp,'studio.sqlite'),
   CONTENT_STUDIO_ALLOW_REMOTE:'',
   CONTENT_STUDIO_PAID_SMOKE_CONSENT:'',
   CONTENT_IMAGE_OPENAI_API_KEY:'playwright-do-not-send',
   CONTENT_IMAGE_OPENAI_BASE_URL:'http://127.0.0.1:43998/v1/',
   CONTENT_IMAGE_OPENAI_MODEL:'fixture-image-model',
   CONTENT_IMAGE_API_KEY:'',
   CONTENT_IMAGE_GEMINI_API_KEY:'',
   CONTENT_IMAGE_QWEN_API_KEY:'',
   CONTENT_IMAGE_REVIEW_API_KEY:'',
   CONTENT_ILLUSTRATION_PLANNER_API_KEY:'',
   ENABLE_SCENARIO:''
  }
 }
});
