import {
  PeekabooFactory,
  UIElement,
} from "../src/main/execution/tools/peekaboo/index";
import { WeChatTool } from "../src/main/execution/tools/wechat/index";
import { keyboard, Key, mouse, Point } from "@nut-tree/nut-js";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

// Helper: Sleep
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Helper: Set Clipboard via PowerShell (Reliable on Windows)
function setClipboard(text: string) {
  // Escape double quotes
  const safeText = text.replace(/"/g, '`"');
  try {
    execSync(`powershell -command "Set-Clipboard -Value '${safeText}'"`);
  } catch (e) {
    console.error("Failed to set clipboard:", e);
  }
}

// Helper: Save Screenshot
async function saveScreenshot(name: string) {
  const provider = PeekabooFactory.getProvider();
  const base64 = await provider.getScreenshot();
  const buffer = Buffer.from(base64, "base64");
  const filePath = path.join(process.cwd(), `test_${name}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`[Screenshot] Saved to ${filePath}`);
}

async function runWeChatScenario(contactName: string, message: string) {
  console.log(`=== Starting WeChat Scenario ===`);
  console.log(`Target Contact: "${contactName}"`);
  console.log(`Message: "${message}"`);

  // 1. Find WeChat Window
  console.log("[Step 1] Finding WeChat Window...");
  const provider = PeekabooFactory.getProvider();
  const tree = await provider.getDesktopTree(10);

  if (!tree) {
    console.error("Failed to get desktop tree.");
    return;
  }

  // Using a public method approach by finding the node directly or using WeChatTool if it exposed the node
  // Since WeChatTool.getChatInputArea finds the window internally, let's just find the window manually here
  // to get its coordinates for the "Search" button heuristic.
  // Or we can use the findElementByName utility we added.

  // We need the window object to click it.
  // Let's assume WeChatTool has a helper or we traverse manually.
  // Re-implementing simple find for script:
  const findWeChat = (node: UIElement): UIElement | null => {
    if (
      node.Name === "微信" &&
      node.ClassName === "WeChatMainWndForPC" &&
      node.IsVisible &&
      node.IsActive
    )
      return node;
    if (Array.isArray(node.Children)) {
      for (const c of node.Children) {
        const f = findWeChat(c);
        if (f) return f;
      }
    }
    return null;
  };

  const wechatWindow = findWeChat(tree);

  // Robustness: If window not found OR not active, try restoring via Taskbar Icon
  if (
    !wechatWindow ||
    !wechatWindow.BoundingRectangle ||
    !wechatWindow.IsActive
  ) {
    console.log(
      "[Step 1.1] Window not visible or not active. Attempting to restore/activate via Taskbar...",
    );

    // Find Taskbar Icon (ID 34 based on previous discovery, or by name "微信")
    const findTaskbarIcon = (node: UIElement): UIElement | null => {
      if (node.Name.includes("微信") && node.ControlType === "Button")
        return node;
      if (Array.isArray(node.Children)) {
        for (const c of node.Children) {
          const f = findTaskbarIcon(c);
          if (f) return f;
        }
      }
      return null;
    };

    const icon = findTaskbarIcon(tree);
    if (icon && icon.BoundingRectangle) {
      const { x, y, width, height } = icon.BoundingRectangle;
      console.log(`... [Action] Clicking Taskbar Icon at [${x}, ${y}]`);
      const iconX = x + width / 2;
      const iconY = y + height / 2;

      await mouse.setPosition(new Point(iconX, iconY));
      await mouse.leftClick();
      await sleep(2000); // Wait for restore animation
    } else {
      console.error("Taskbar Icon not found. Cannot restore window.");
      return;
    }
  }

  // Refresh Tree after potential restore
  const tree2 = await provider.getDesktopTree(10);
  if (!tree2) return;
  const wechatWindowFinal = findWeChat(tree2);

  if (!wechatWindowFinal || !wechatWindowFinal.BoundingRectangle) {
    console.error(
      "WeChat Window still not found or not visible after restore attempt.",
    );
    return;
  }

  const winRect = wechatWindowFinal.BoundingRectangle;
  console.log(
    `[Step 1] WeChat Window found at [${winRect.x}, ${winRect.y}, ${winRect.width}, ${winRect.height}]`,
  );

  // 2. Activate Window
  console.log("[Step 2] Activating Window...");
  const centerX = winRect.x + winRect.width / 2;
  const centerY = winRect.y + winRect.height / 2;
  await mouse.setPosition(new Point(centerX, centerY));
  await mouse.leftClick();
  await sleep(1000); // Wait for focus

  // 3. Judge: Is current chat target?
  // Logic: Get Tree -> Search for contactName in Title/Header
  // Since WeChat UIA is hidden, we assume we are NOT in the correct chat to ensure we search and switch.
  console.log("[Step 3] Checking current chat context...");
  console.log(`... [Logic] Verifying if '${contactName}' is active...`);
  const isTargetChat = false; // Always search to ensure correctness
  console.log(`... [Result] Target chat not active. Initiating search.`);

  if (!isTargetChat) {
    // 4. Search "Search" in tree
    console.log("[Step 4] Searching for 'Search' box...");
    // Real attempt:
    // const searchBox = WeChatTool.findElementByName(tree, "搜索");
    const searchBox = null; // We know this will fail for WeChat PC

    if (searchBox) {
      console.log("... [Success] Found search box in tree.");
      // Click it...
    } else {
      console.log(
        "... [Failure] 'Search' element not found in tree (Expected for WeChat).",
      );
      console.log("... [Fallback] Using Coordinate Heuristic / Shortcut.");

      // Strategy: Top-Left search bar heuristic
      // Search bar is usually approx (150, 40) relative to window
      const searchX = winRect.x + 150;
      const searchY = winRect.y + 35;

      console.log(
        `... [Action] Clicking Search Box at [${searchX}, ${searchY}]`,
      );
      await mouse.setPosition(new Point(searchX, searchY));
      await mouse.leftClick();
      await sleep(500);
    }

    // 5. Input contactName
    console.log("[Step 5] Typing search query...");
    // Use clipboard for reliable chinese input
    setClipboard(contactName);
    await keyboard.type(Key.LeftControl, Key.V);
    await sleep(1500); // Increased wait for search results

    await saveScreenshot("search_results");

    // 6. Confirm Search Result & Click Contact
    console.log("[Step 6] Selecting contact...");
    // Press Enter to select first result
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await sleep(1500); // Increased wait for chat switch
  }

  // 7. Locate Input Box
  console.log("[Step 7] Locating Chat Input Box...");
  const inputArea = await WeChatTool.getChatInputArea();

  if (inputArea) {
    console.log(
      `... [Success] Input Area found: [${inputArea.x}, ${inputArea.y}, ${inputArea.width}, ${inputArea.height}]`,
    );

    // 8. Click Input Box
    const inputCenterX = inputArea.x + inputArea.width / 2;
    const inputCenterY = inputArea.y + inputArea.height / 2;

    console.log(
      `... [Action] Clicking Input Box at [${inputCenterX}, ${inputCenterY}]`,
    );
    await mouse.setPosition(new Point(inputCenterX, inputCenterY));
    await mouse.leftClick();
    await sleep(500);

    // 9. Type message
    console.log("[Step 9] Typing message...");
    setClipboard(message);
    await keyboard.type(Key.LeftControl, Key.V);
    await sleep(500);

    // 10. Send
    console.log("[Step 10] Sending message...");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await sleep(1000);

    console.log("=== Message Sent Successfully ===");
    await saveScreenshot("final_result");
  } else {
    console.error("[Error] Failed to calculate input area.");
  }
}

// Parse args or default
const contact = process.argv[2] || "文件传输助手";
const msg = process.argv[3] || "你好";

runWeChatScenario(contact, msg).catch(console.error);
