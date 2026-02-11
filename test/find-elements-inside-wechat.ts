
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';

async function findElementsInsideWeChat() {
    console.log("Fetching desktop tree (depth=50)...");
    const provider = PeekabooFactory.getProvider();
    const tree = await provider.getDesktopTree(50);
    
    if (!tree) {
        console.log("No tree returned.");
        return;
    }

    // WeChat Window Bounds from previous dump
    const wechatRect = { x: 333, y: 351, width: 910, height: 647 };
    
    let currentId = 0;
    const elementsInside: { id: number, name: string, type: string, rect: any }[] = [];

    const traverse = (node: UIElement) => {
        if (node.BoundingRectangle && node.IsVisible) {
            const { x, y, width, height } = node.BoundingRectangle;

            if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return;
            if (width < 5 || height < 5) return;

            currentId++;

            // Check if element is inside WeChat window (and is NOT the window itself)
            // Allow some margin for error
            if (x >= wechatRect.x && y >= wechatRect.y && 
                (x + width) <= (wechatRect.x + wechatRect.width) && 
                (y + height) <= (wechatRect.y + wechatRect.height)) {
                
                // Exclude the main window itself (approx match)
                if (Math.abs(width - wechatRect.width) > 10 || Math.abs(height - wechatRect.height) > 10) {
                     elementsInside.push({
                        id: currentId,
                        name: node.Name,
                        type: node.ControlType,
                        rect: node.BoundingRectangle
                    });
                }
            }
        }
        
        if (Array.isArray(node.Children)) {
            node.Children.forEach(traverse);
        }
    };

    traverse(tree);

    console.log(`\nFound ${elementsInside.length} elements inside WeChat window bounds:`);
    // Print first 20 to avoid spam
    elementsInside.slice(0, 50).forEach(m => {
        console.log(`[ID: ${m.id}] Type: ${m.type} | Name: "${m.name}" | Rect: [${m.rect.x}, ${m.rect.y}, ${m.rect.width}, ${m.rect.height}]`);
    });
}

findElementsInsideWeChat();
