import type {LicenceData} from './licence-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module -- Metro needs a static path to the generated file
export const licences = require('./licences.generated.json') as LicenceData;
