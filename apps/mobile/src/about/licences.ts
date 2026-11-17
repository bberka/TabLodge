import type {LicenceData} from './licence-data';

// Written by scripts/licences.mts before every bundle, and ignored by git. Metro needs a static path here.
// eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
export const licences = require('./licences.generated.json') as LicenceData;
