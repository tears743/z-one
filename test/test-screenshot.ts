
import { PeekabooFactory } from '../src/main/execution/tools/peekaboo';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    console.log("Starting screenshot capture...");
    try {
        const provider = PeekabooFactory.getProvider();
        const base64Image = await provider.getScreenshot();
        
        const buffer = Buffer.from(base64Image, 'base64');
        const outputPath = path.join(process.cwd(), 'test_screenshot_depth5.jpg');
        
        fs.writeFileSync(outputPath, buffer);
        console.log(`Screenshot saved to: ${outputPath}`);
        console.log(`Image size: ${(buffer.length / 1024).toFixed(2)} KB`);
    } catch (error) {
        console.error("Error capturing screenshot:", error);
    }
}

main();
