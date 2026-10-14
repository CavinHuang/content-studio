import {defineConfig} from '@playwright/test';
import existing from './playwright.config.mjs';

// Dedicated opt-in integration run: requires a real doocs/md container at
// 127.0.0.1:8800. Normal test:e2e remains self-contained and never pulls it.
export default defineConfig({
 ...existing,
 testDir:'./smoke',
 testMatch:['doocs-real-v51.spec.mjs','doocs-image-v52.spec.mjs'],
 retries:0,
 use:{...existing.use,trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:[['list']]
});
