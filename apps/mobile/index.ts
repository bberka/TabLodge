import {registerRootComponent} from 'expo';
// Runs before the app, so the shared sync code finds the array methods it uses.
// eslint-disable-next-line import-x/no-unassigned-import
import './src/platform/polyfills';
import {defineBackgroundSync} from './src/library/background-sync';
import App from './app';

defineBackgroundSync();
registerRootComponent(App);
