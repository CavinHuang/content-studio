import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage();
export const providerEnvironment = () => context.getStore()?.env || process.env;
export const providerFetch = (url, options) =>
  context.getStore()?.hub
    ? context.getStore().hub.request(url, options)
    : fetch(url, options);
export const providerStreamFetch = (url, options) =>
  context.getStore()?.hub
    ? context.getStore().hub.requestStream(url, options)
    : fetch(url, options);
export const runWithProviders = (hub, fn) =>
  context.run({ hub, env: hub.environment() }, fn);
export const currentProviderTask = (hub) => {
  const s = context.getStore();
  return s?.hub === hub ? s.task : null;
};
export const runWithProviderTask = (hub, task, fn) =>
  context.run({ hub, task }, () => {
    context.getStore().env = hub.environment();
    return fn();
  });

export const providerImageFetch = (url, options) =>
  context.getStore()?.hub
    ? context.getStore().hub.request(url, options, "image")
    : fetch(url, options);
