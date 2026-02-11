
import { PeekabooFactory, UIElement } from '../src/main/execution/tools/peekaboo/index';
import { mouse, Point, screen, FileType } from "@nut-tree/nut-js";
import * as fs from 'fs';
import * as path from 'path';

// --- Mock LLM Service Interface ---
interface NavigationDecision {
    status: 'FOUND' | 'MOVING' | 'NOT_VISIBLE';
    direction?: { x: number, y: number }; // Vector to move
    message?: string;
}

class LLMNavigator {
    /**
     * Simulates (or implements) the VLM analysis.
     * In a real scenario, this sends the base64 image + current mouse coords to GPT-4o/Claude-3.5-Sonnet.
     */
    static async analyzeScreenshot(
        screenshotBase64: string, 
        mousePos: { x: number, y: number }, 
        targetDescription: string
    ): Promise<NavigationDecision> {
        
        console.log(`[LLM] Analyzing screenshot for target: "${targetDescription}" at mouse: (${mousePos.x}, ${mousePos.y})...`);
        
        // --- MOCK LOGIC FOR DEMONSTRATION ---
        // Assumption: We are looking for WeChat Input.
        // We pretend the target is at approx (960, 800) for a 1920x1080 screen, 
        // or we use the coordinates we found in previous turns (Window center-bottom).
        // WeChat Window found previously at: x: 276, y: 151, w: 910, h: 647
        // Target Input approx: x: 731, y: 748
        
        const targetX = 731;
        const targetY = 748;
        const threshold = 20; // pixels

        const dx = targetX - mousePos.x;
        const dy = targetY - mousePos.y;
        const distance = Math.sqrt(dx*dx + dy*dy);

        if (distance < threshold) {
            return { status: 'FOUND', message: "Target is right under the cursor." };
        }

        // Move a portion of the distance to simulate human-like iterative movement
        // e.g. move 50% of the way or a fixed step
        const stepSize = Math.min(distance, 100); // Max 100px per step to be safe
        const angle = Math.atan2(dy, dx);
        
        const moveX = Math.cos(angle) * stepSize;
        const moveY = Math.sin(angle) * stepSize;

        return {
            status: 'MOVING',
            direction: { x: moveX, y: moveY },
            message: `Target detected at distance ${Math.round(distance)}. Moving closer.`
        };
        // --- END MOCK LOGIC ---
    }
}

// --- Main Automation Script ---

async function humanLikeNavigation(appName: string, targetDesc: string) {
    console.log(`=== Starting Human-like Navigation Task ===`);
    console.log(`Target App: ${appName}`);
    console.log(`Target Element: ${targetDesc}`);

    const provider = PeekabooFactory.getProvider();

    // 1. Find the Application Window (Global Search)
    console.log(`\n[Step 1] Locating application window...`);
    const desktopTree = await provider.getDesktopTree(10);
    if (!desktopTree) throw new Error("Failed to get desktop tree");

    const findWindow = (node: UIElement): UIElement | null => {
        if (node.Name.includes(appName) && node.ControlType === "Window" && node.IsVisible) {
            return node;
        }
        if (Array.isArray(node.Children)) {
            for (const child of node.Children) {
                const found = findWindow(child);
                if (found) return found;
            }
        }
        return null;
    };

    const appWindow = findWindow(desktopTree);
    if (!appWindow || !appWindow.BoundingRectangle) {
        throw new Error(`Application window "${appName}" not found.`);
    }

    const winRect = appWindow.BoundingRectangle;
    console.log(`[Step 1] Window found: "${appWindow.Name}" at [${winRect.x}, ${winRect.y}, ${winRect.width}, ${winRect.height}]`);

    // 2. Activate Window (Human-like: Click title bar or center)
    console.log(`\n[Step 2] Activating window...`);
    // Click center of window to focus
    const centerX = winRect.x + winRect.width / 2;
    const centerY = winRect.y + winRect.height / 2;
    
    await mouse.setPosition(new Point(centerX, centerY));
    await mouse.leftClick();
    console.log(`[Step 2] Window clicked/activated.`);

    // 3. Navigation Loop (Iterative Approach)
    console.log(`\n[Step 3] Entering Navigation Loop...`);
    
    let maxSteps = 10;
    let found = false;

    while (maxSteps > 0 && !found) {
        maxSteps--;
        
        // A. Get Context (Screenshot + Mouse Position)
        const currentMouse = await mouse.getPosition();
        const screenshotBase64 = await provider.getScreenshot();
        
        // B. Consult "Brain" (LLM)
        const decision = await LLMNavigator.analyzeScreenshot(
            screenshotBase64, 
            { x: currentMouse.x, y: currentMouse.y }, 
            targetDesc
        );

        console.log(`[LLM Decision] ${decision.status}: ${decision.message}`);

        // C. Execute Action
        if (decision.status === 'FOUND') {
            found = true;
            console.log(`\n[Success] Target reached!`);
            // Optional: Highlight or click
            // await mouse.leftClick();
        } else if (decision.status === 'MOVING' && decision.direction) {
            // Human-like movement: smooth? or direct?
            // nut.js moves directly by default, let's just set target
            const targetPoint = new Point(
                currentMouse.x + decision.direction.x,
                currentMouse.y + decision.direction.y
            );
            
            // Move mouse
            await mouse.setPosition(targetPoint);
            
            // Wait a bit for UI to settle or "human" reaction time
            await new Promise(r => setTimeout(r, 500)); 
        } else {
            console.log(`[Failure] LLM lost track of target.`);
            break;
        }
    }

    if (!found) {
        console.log(`\n[Timeout] Failed to reach target within step limit.`);
    }
}

// Run the test
// Target: WeChat Input Box
humanLikeNavigation("微信", "Chat Input Box (Bottom area)").catch(console.error);
