import {registerRootComponent} from 'expo';
// Runs before the app, so the shared sync code finds the array methods it uses.
// eslint-disable-next-line import-x/no-unassigned-import
import './src/polyfills';
import App from './app';

registerRootComponent(App);
