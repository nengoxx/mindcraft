import { appRoot, loadConfig, appEnvironment } from './config.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const config = loadConfig();
process.chdir(appRoot);
Object.assign(process.env, appEnvironment(config));
await import(pathToFileURL(path.join(appRoot, 'main.js')).href);
