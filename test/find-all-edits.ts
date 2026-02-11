
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';

async function findAllEditControls() {
    console.log("Fetching desktop tree (depth=50)...");
    const provider = PeekabooFactory.getProvider();
    const tree = await provider.getDesktopTree(50);
    
    if (!tree) return;

    let currentId = 0;
    const edits: { id: number, name: string, rect: any }[] = [];

    const traverse = (node: UIElement) => {
        if (node.BoundingRectangle && node.IsVisible) {
            const { x, y, width, height } = node.BoundingRectangle;
            if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return;
            if (width < 5 || height < 5) return;

            currentId++;
            
            if (node.ControlType === "Edit" || node.ControlType === "Document") {
                 edits.push({
                    id: currentId,
                    name: node.Name,
                    rect: node.BoundingRectangle
                });
            }
        }
        if (Array.isArray(node.Children)) node.Children.forEach(traverse);
    };

    traverse(tree);

    console.log(`\nFound ${edits.length} Edit/Document controls:`);
    edits.forEach(m => {
        console.log(`[ID: ${m.id}] Name: "${m.name}" | Rect: [${m.rect.x}, ${m.rect.y}, ${m.rect.width}, ${m.rect.height}]`);
    });
}

findAllEditControls();
