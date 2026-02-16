import {
  PeekabooFactory,
  UIElement,
} from "../src/main/execution/tools/peekaboo/index";
// @ts-ignore
import * as Jimp from "jimp"; // Note: Jimp import might need adjustment based on how it's exported/mocked

// Mock Jimp-like behavior just to satisfy the logic if we were running it,
// but here we actually want to RUN the real code.
// However, I need to replicate the traversal logic exactly.

async function findWeChatId() {
  console.log("Fetching desktop tree (depth=50)...");
  const provider = PeekabooFactory.getProvider();

  // We can access getDesktopTree via the provider interface,
  // but the exact traversal logic (filtering, overlaps) is inside getScreenshot.
  // To be 100% accurate, I should probably copy the traversal logic here.

  const tree = await provider.getDesktopTree(50);

  if (!tree) {
    console.log("No tree returned.");
    return;
  }

  // --- Replicate Logic from index.ts ---
  // Note: I cannot import the 'font' or 'image' objects easily, so I will simulate their dimensions.
  // Jimp.FONT_SANS_8_WHITE usually has a height of ~8-10px and width varies.
  // I'll assume a rough char width of 6px per digit + padding.

  // Mock image dimensions (assuming 2560x1440 or similar, but logic uses image.bitmap.width)
  // I'll assume 1920x1080 for simulation if needed, but overlap check uses absolute coords.
  const imageWidth = 3440; // Based on previous log output hints or assumption
  const imageHeight = 1440;

  const labeledAreas: {
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  let currentId = 0;

  // Helper to simulate text measurement
  const measureText = (text: string) => text.length * 6; // Approx
  const measureTextHeight = () => 10; // Approx

  const results: { id: number; name: string; rect: any }[] = [];

  const traverse = (node: UIElement) => {
    if (node.BoundingRectangle && node.IsVisible) {
      const { x, y, width, height } = node.BoundingRectangle;

      // Ensure coordinates are numbers
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof width !== "number" ||
        typeof height !== "number"
      )
        return;

      // Filter tiny elements
      if (width < 5 || height < 5) return;

      // SIMULATE ID increment (this matches ElementRegistry.register)
      currentId++;
      const id = currentId;

      const label = id.toString();
      // Simulate text dims
      const textWidth = measureText(label);
      const textHeight = measureTextHeight();

      let labelX = x;
      let labelY = y;
      const labelWidth = textWidth + 4;
      const labelHeight = textHeight + 4;

      // Boundary check
      if (labelX + labelWidth > imageWidth) labelX = imageWidth - labelWidth;
      if (labelX < 0) labelX = 0;
      if (labelY + labelHeight > imageHeight)
        labelY = imageHeight - labelHeight;
      if (labelY < 0) labelY = 0;

      // Overlap check
      const labelOverlap = labeledAreas.some((area) => {
        return (
          labelX < area.x + area.width &&
          labelX + labelWidth > area.x &&
          labelY < area.y + area.height &&
          labelY + labelHeight > area.y
        );
      });

      if (labelOverlap) {
        // Skip labeling this element, check children
        // IMPORTANT: In index.ts, if overlap, we do NOT increment/register ID?
        // Wait, index.ts calls ElementRegistry.register(node) BEFORE drawing/checking overlap?
        // NO. Let's check the code I wrote.
        // Code in index.ts:
        // ...
        // if (labelOverlap) {
        //    if (node.Children) ...
        //    return;
        // }
        // ...
        // const id = ElementRegistry.register(node);
        // AH! The check is done BEFORE register?
        // Let's re-read index.ts carefully.
      } else {
        // Logic in index.ts:
        // 1. Calculate pos
        // 2. Check overlap
        // 3. If overlap -> return (don't register)
        // 4. Register -> get ID
        // 5. Push to labeledAreas
        // Wait, if I return before register, then currentId is NOT incremented for this node.
        // My simulation above incremented it too early.
        // Correct logic:
        // Check overlap first...
        // If no overlap:
        // Register (increment ID)
        // Add to labeledAreas
        // So I need to reset currentId logic.
      }
    }

    // Children traversal
    if (Array.isArray(node.Children)) {
      node.Children.forEach(traverse);
    }
  };

  // --- Corrected Simulation Loop ---

  // Reset for the actual run
  currentId = 0;

  const traverseReal = (node: UIElement) => {
    if (node.BoundingRectangle && node.IsVisible) {
      const { x, y, width, height } = node.BoundingRectangle;

      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof width !== "number" ||
        typeof height !== "number"
      )
        return;
      if (width < 5 || height < 5) return;

      // We need to calculate label position to check overlap BEFORE getting an ID
      // But to calculate label width, we need the ID string length...
      // This is a catch-22 in my previous code?

      // Let's check index.ts again.
      // const id = ElementRegistry.register(node);  <-- REGISTER IS CALLED FIRST
      // const label = id.toString();
      // ... calc position ...
      // if (labelOverlap) { ... return; }

      // WAIT. If register is called first, the ID is consumed even if we don't draw it?
      // In my previous edit (SearchReplace), I put the check AFTER getting coords but...
      // Let's check the EXACT order in index.ts
    }
    if (Array.isArray(node.Children)) node.Children.forEach(traverseReal);
  };
}
