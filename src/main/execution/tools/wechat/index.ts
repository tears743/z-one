
import { PeekabooFactory, UIElement } from '../peekaboo';

export interface WeChatInputArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SearchOptions {
    partialMatch?: boolean;
    caseSensitive?: boolean;
}

export class WeChatTool {
    /**
     * Finds the WeChat Main Window in the desktop tree
     */
    private static findWeChatWindow(node: UIElement): UIElement | null {
        if (node.Name === "微信" && node.ClassName === "WeChatMainWndForPC" && node.IsVisible) {
            return node;
        }
        if (Array.isArray(node.Children)) {
            for (const child of node.Children) {
                const found = this.findWeChatWindow(child);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Calculates the approximate area of the chat input box based on the main window position
     * Returns null if WeChat window is not found or not visible
     */
    static async getChatInputArea(): Promise<WeChatInputArea | null> {
        const provider = PeekabooFactory.getProvider();
        // Use a reasonable depth to find the main window quickly
        const tree = await provider.getDesktopTree(10);
        
        if (!tree) return null;

        const wechatWindow = this.findWeChatWindow(tree);
        
        if (wechatWindow && wechatWindow.BoundingRectangle) {
            const { x, y, width, height } = wechatWindow.BoundingRectangle;

            // Heuristic for Input Box (based on standard WeChat PC layout)
            // Left sidebar (icons): ~60px
            // Chat list: ~250px
            // Total left offset: ~310px
            // Input box height: ~120px from bottom
            
            const inputX = x + 310;
            const inputY = y + height - 120;
            const inputW = width - 310;
            const inputH = 120;

            // Sanity check
            if (inputW <= 0 || inputH <= 0) return null;

            return {
                x: inputX,
                y: inputY,
                width: inputW,
                height: inputH
            };
        }

        return null;
    }

    /**
     * General utility to find UI elements by name text
     */
    static findElementByName(root: UIElement, name: string, options: SearchOptions = {}): UIElement | null {
        const { partialMatch = false, caseSensitive = false } = options;
        
        const nodeName = caseSensitive ? root.Name : (root.Name || "").toLowerCase();
        const searchName = caseSensitive ? name : name.toLowerCase();

        const match = partialMatch ? nodeName.includes(searchName) : nodeName === searchName;

        if (match && root.IsVisible) {
            return root;
        }

        if (Array.isArray(root.Children)) {
            for (const child of root.Children) {
                const found = this.findElementByName(child, name, options);
                if (found) return found;
            }
        }

        return null;
    }

    /**
     * Check if text length satisfies a condition (e.g. for validation)
     * This is a utility function that might be used after extracting text
     */
    static checkTextLength(text: string, min: number, max: number): boolean {
        return text.length >= min && text.length <= max;
    }
}
