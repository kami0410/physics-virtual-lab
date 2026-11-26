import { launch, HERE } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const b = await launch();
const C = pathToFileURL(path.join(HERE, 'cover.html')).href;
for (const [r, w, h, name] of [['43', 1440, 1080, '封面-4比3'], ['34', 1080, 1440, '封面-3比4']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(C + '?r=' + r);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(HERE, name + '.png') });
  await p.screenshot({ path: path.join(HERE, name + '.jpg'), type: 'jpeg', quality: 92 });
}
await b.close();
