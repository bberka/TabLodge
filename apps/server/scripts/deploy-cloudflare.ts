import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runFromCommandLine} from '../cloudflare-deploy/deploy.js';

runFromCommandLine(dirname(dirname(fileURLToPath(import.meta.url))));
