import {
  PeekabooFactory,
  UIElement,
} from "../src/main/execution/tools/peekaboo/index";

function printTreeSummary(node: UIElement, depth: number = 0) {
  const indent = "  ".repeat(depth);
  const rect = node.BoundingRectangle
    ? `${node.BoundingRectangle.width}x${node.BoundingRectangle.height}`
    : "No Rect";
  const nameStr = node.Name ? `"${node.Name}"` : "<No Name>";
  const classStr = node.ClassName ? `[${node.ClassName}]` : "";
  console.log(
    `${indent}- [${node.ControlType}]${classStr} ${nameStr} (${rect})`,
  );

  if (node.Children && node.Children.length > 0) {
    // Only print first 3 children to avoid spamming console
    for (let i = 0; i < Math.min(node.Children.length, 3); i++) {
      printTreeSummary(node.Children[i], depth + 1);
    }
    if (node.Children.length > 3) {
      console.log(`${indent}  ... (${node.Children.length - 3} more children)`);
    }
  }
}

async function runTest() {
  console.log("Starting Peekaboo Windows Test...");
  const peekaboo = PeekabooFactory.getProvider();

  try {
    console.log("Fetching active window tree...");
    const startActive = Date.now();
    const treeActive = await peekaboo.getActiveWindowTree();
    const durationActive = Date.now() - startActive;

    console.log(`Active Window Fetch completed in ${durationActive}ms`);

    if (treeActive) {
      console.log("Active Window Tree Structure:");
      printTreeSummary(treeActive);
    } else {
      console.log("No active window tree found.");
    }

    console.log("\n-----------------------------------\n");

    console.log("Fetching Desktop tree...");
    const startDesktop = Date.now();
    // Use smaller depth for desktop to avoid huge JSON output
    const treeDesktop = await peekaboo.getDesktopTree(3);
    const durationDesktop = Date.now() - startDesktop;

    console.log(`Desktop Fetch completed in ${durationDesktop}ms`);

    if (treeDesktop) {
      console.log("Desktop Tree Structure (Root Only + Top Level Children):");

      // Look for Taskbar explicitly
      const taskbar = treeDesktop.Children?.find(
        (c) =>
          c.ClassName === "Shell_TrayWnd" ||
          c.Name === "任务栏" ||
          c.Name === "Taskbar",
      );
      if (taskbar) {
        console.log("\n*** FOUND TASKBAR ***");
        printTreeSummary(taskbar);
        console.log("*********************\n");
      } else {
        console.log("\n!!! TASKBAR NOT FOUND !!!\n");
      }

      // Just print root and first level to avoid huge output
      const rootSummary = {
        ...treeDesktop,
        Children: treeDesktop.Children?.slice(0, 10),
      };
      printTreeSummary(rootSummary as UIElement);
    } else {
      console.log("No desktop tree found.");
    }

    console.log("\n-----------------------------------\n");
    console.log("Taking screenshot...");
    const startScreenshot = Date.now();
    const screenshotBase64 = await peekaboo.getScreenshot();
    const durationScreenshot = Date.now() - startScreenshot;
    console.log(`Screenshot taken in ${durationScreenshot}ms`);
    console.log(`Screenshot length: ${screenshotBase64.length}`);
    if (screenshotBase64.length > 100) {
      console.log("Screenshot seems valid (length > 100)");
    } else {
      console.error("Screenshot is too short/empty!");
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTest();
