import {registerRootComponent} from 'expo';
// eslint-disable-next-line import-x/no-unassigned-import -- the polyfills are imported for their side effect
import './src/platform/polyfills';
import {defineBackgroundSync} from './src/library/background-sync';
import App from './app';

defineBackgroundSync();
registerRootComponent(App);
