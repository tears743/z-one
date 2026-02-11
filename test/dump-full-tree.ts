
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';
import * as fs from 'fs';
import * as path from 'path';

async function dumpFullTree() {
    console.log("Fetching desktop tree (depth=50)...");
    const provider = PeekabooFactory.getProvider();
    const tree = await provider.getDesktopTree(50);
    
    const outputPath = path.join(process.cwd(), 'test/full_tree_dump.json');
    fs.writeFileSync(outputPath, JSON.stringify(tree, null, 2));
    console.log(`Tree dumped to ${outputPath}`);
}

dumpFullTree();
