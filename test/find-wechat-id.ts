
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';

async function findWeChatId() {
    console.log("Fetching desktop tree (depth=50)...");
    const provider = PeekabooFactory.getProvider();
    const tree = await provider.getDesktopTree(50);
    
    if (!tree) {
        console.log("No tree returned.");
        return;
    }

    let currentId = 0;
    const matches: { id: number, name: string, rect: any }[] = [];

    const traverse = (node: UIElement) => {
        if (node.BoundingRectangle && node.IsVisible) {
            const { x, y, width, height } = node.BoundingRectangle;

            // Ensure coordinates are numbers (from index.ts logic)
            if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return;
            
            // Filter tiny elements (from index.ts logic)
            if (width < 5 || height < 5) return;

            // ID is assigned here in index.ts
            currentId++;
            
            // Check for match
            if (node.Name && (node.Name.includes("微信") || node.Name.toLowerCase().includes("wechat"))) {
                matches.push({
                    id: currentId,
                    name: node.Name,
                    rect: node.BoundingRectangle
                });
            }
        }
        
        // Children traversal
        if (Array.isArray(node.Children)) {
            node.Children.forEach(traverse);
        }
    };

    traverse(tree);

    console.log("\nFound matches:");
    matches.forEach(m => {
        console.log(`[ID: ${m.id}] Name: "${m.name}" | Rect: [${m.rect.x}, ${m.rect.y}, ${m.rect.width}, ${m.rect.height}]`);
    });
}

findWeChatId();
