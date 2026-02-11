
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';

async function findWeChatInput() {
    console.log("Fetching desktop tree (depth=50)...");
    const provider = PeekabooFactory.getProvider();
    const tree = await provider.getDesktopTree(50);
    
    if (!tree) {
        console.log("No tree returned.");
        return;
    }

    let currentId = 0;
    const matches: { id: number, name: string, controlType: string, rect: any }[] = [];

    const traverse = (node: UIElement) => {
        if (node.BoundingRectangle && node.IsVisible) {
            const { x, y, width, height } = node.BoundingRectangle;

            if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return;
            if (width < 5 || height < 5) return;

            currentId++;
            
            // Heuristics for WeChat Input Box:
            // 1. Name might be "输入" or empty
            // 2. ControlType is usually "Edit" or "Document"
            // 3. Usually inside a "Pane" or "Window" named "微信"
            
            // Check if it's an edit control
            if (node.ControlType === "Edit" || node.ControlType === "Document") {
                // Check ancestors? (Not easy in this recursion without passing context)
                // Just log all edit controls for now, maybe filter by name
                if (node.Name === "输入" || node.Name === "" || node.Name.includes("微信")) {
                     matches.push({
                        id: currentId,
                        name: node.Name,
                        controlType: node.ControlType,
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

    console.log("\nPotential Input Boxes:");
    matches.forEach(m => {
        console.log(`[ID: ${m.id}] Type: ${m.controlType} | Name: "${m.name}" | Rect: [${m.rect.x}, ${m.rect.y}, ${m.rect.width}, ${m.rect.height}]`);
    });
}

findWeChatInput();
