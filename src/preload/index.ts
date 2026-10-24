import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('studio', { __hello: 'contentdeck' });
