import { VintageStudioSuite } from './VintageStudioSuite.js';

export { VintageStudioSuite };

const mountContainer = document.getElementById('vst-suite-mount');
if (mountContainer) {
  new VintageStudioSuite(mountContainer, {
    initialModule: 'all'
  });
}
